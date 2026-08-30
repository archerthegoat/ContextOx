import {
	type CompiledQuery,
	compileQueryPlan,
	QueryCompilerError,
	type ReadOnlyQueryExecutionRequest,
	type ReadOnlyQueryExecutor,
} from "./compiler.ts";
import {
	ActorRefSchema,
	DateTimeSchema,
	type Freshness,
	isContract,
	type ResourceId,
	ResourceIdSchema,
} from "./contracts.ts";
import {
	type AnalysisPlanRef,
	createEvidenceEnvelope,
	type EvidenceEnvelope,
	type EvidencePolicyDecision,
	normalizeEvidenceEnvelope,
} from "./evidence.ts";
import { ANALYSIS_CONTRACT_VERSION, type ContextPackRef } from "./plan.ts";
import type { ExecutionContext, PreflightBlockReason, QueryPreflightResult } from "./preflight.ts";
import {
	createBlockedResultEnvelope,
	createResultEnvelope,
	minimizeResult,
	normalizeResultEnvelope,
	type ResultCandidate,
	type ResultEnvelope,
	type ResultErrorCode,
	type ResultLineage,
	type ResultMinimizationPolicy,
} from "./results.ts";

export type RuntimeFailureCode = ResultErrorCode | "dependency_failed";

export type RuntimeStepKind = "query" | "knowledge" | "transform" | "hybrid";

export type RuntimeStepStatus = "complete" | "partial" | "blocked" | "clarification_required" | "skipped";

export interface RuntimeBudgetUsage {
	readonly steps: number;
	readonly rows: number;
	readonly bytes: number;
}

export interface RuntimeRemainingBudget {
	readonly maxRows: number;
	readonly maxBytes: number;
	readonly maxSteps: number;
}

export interface RuntimeStepInvocation {
	readonly runId: ResourceId;
	readonly stepId: ResourceId;
	readonly signal: AbortSignal;
	readonly context: ExecutionContext;
	readonly used: RuntimeBudgetUsage;
	readonly remaining: RuntimeRemainingBudget;
}

export interface RuntimeStepOutput {
	readonly result: unknown;
	readonly evidence?: unknown;
}

export interface RuntimeStep {
	readonly stepId: ResourceId;
	readonly kind: RuntimeStepKind;
	readonly required: boolean;
	readonly dependsOn: readonly ResourceId[];
	readonly execute: (invocation: RuntimeStepInvocation) => Promise<RuntimeStepOutput>;
}

export interface RuntimeStepRecord {
	readonly stepId: ResourceId;
	readonly kind: RuntimeStepKind;
	readonly required: boolean;
	readonly status: RuntimeStepStatus;
	readonly result?: ResultEnvelope;
	readonly evidence?: EvidenceEnvelope;
	readonly error?: RuntimeFailureCode;
}

export interface RuntimeRunRequest {
	readonly context: ExecutionContext;
	readonly steps: readonly RuntimeStep[];
	readonly deadlineAt?: string;
	readonly now?: () => number;
}

export interface RuntimeRunResult {
	readonly contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
	readonly runId: ResourceId;
	readonly status: "complete" | "partial" | "blocked" | "clarification_required";
	readonly records: readonly RuntimeStepRecord[];
	readonly completedStepIds: readonly ResourceId[];
	readonly failedStepIds: readonly ResourceId[];
	readonly skippedStepIds: readonly ResourceId[];
	readonly used: RuntimeBudgetUsage;
}

export class RuntimeStepError extends Error {
	readonly code: RuntimeFailureCode;

	constructor(code: RuntimeFailureCode) {
		super(code);
		this.name = "RuntimeStepError";
		this.code = code;
	}
}

export interface FixtureQueryCase {
	readonly queryDigest: string;
	readonly candidate: ResultCandidate;
}

export interface FixtureQueryExecutorOptions {
	readonly cases: readonly FixtureQueryCase[];
	readonly delayMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isAbortSignal(value: unknown): value is AbortSignal {
	return (
		isRecord(value) &&
		typeof value.aborted === "boolean" &&
		typeof value.addEventListener === "function" &&
		typeof value.removeEventListener === "function"
	);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isCandidateShape(value: unknown): value is ResultCandidate {
	if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return false;
	if (typeof value.rowCount !== "number") return false;
	return value.columns.every(isRecord) && value.rows.every(Array.isArray);
}

function validateRuntimeRequest(request: RuntimeRunRequest): void {
	if (!isRecord(request) || !isRecord(request.context) || !Array.isArray(request.steps)) {
		throw new RuntimeStepError("invalid_contract");
	}
	if (!isRecord(request.context.budget) || typeof request.context.policyEvaluator?.evaluate !== "function") {
		throw new RuntimeStepError("invalid_contract");
	}
	if (!isContract(ResourceIdSchema, request.context.runId)) throw new RuntimeStepError("invalid_contract");
	if (!isContract(ActorRefSchema, request.context.actor)) throw new RuntimeStepError("invalid_contract");
	if (!isContract(DateTimeSchema, request.context.asOf)) throw new RuntimeStepError("invalid_contract");
	if (!isPositiveInteger(request.context.budget.maxSteps)) throw new RuntimeStepError("invalid_contract");
	if (!isPositiveInteger(request.context.budget.maxRows)) throw new RuntimeStepError("invalid_contract");
	if (!isPositiveInteger(request.context.budget.maxBytes)) throw new RuntimeStepError("invalid_contract");
	if (request.context.signal !== undefined && !isAbortSignal(request.context.signal)) {
		throw new RuntimeStepError("invalid_contract");
	}
	if (request.deadlineAt !== undefined) {
		if (!isContract(DateTimeSchema, request.deadlineAt) || !Number.isFinite(Date.parse(request.deadlineAt))) {
			throw new RuntimeStepError("invalid_contract");
		}
	}
	if (request.now !== undefined && !Number.isFinite(request.now())) {
		throw new RuntimeStepError("invalid_contract");
	}
}

function normalizeRuntimeSteps(values: readonly RuntimeStep[]): RuntimeStep[] {
	if (values.length === 0) throw new RuntimeStepError("invalid_contract");
	const byId = new Map<ResourceId, RuntimeStep>();
	for (const value of values) {
		if (
			!isContract(ResourceIdSchema, value.stepId) ||
			(value.kind !== "query" &&
				value.kind !== "knowledge" &&
				value.kind !== "transform" &&
				value.kind !== "hybrid") ||
			typeof value.required !== "boolean" ||
			!Array.isArray(value.dependsOn) ||
			typeof value.execute !== "function"
		) {
			throw new RuntimeStepError("invalid_contract");
		}
		if (byId.has(value.stepId)) throw new RuntimeStepError("invalid_contract");
		const dependsOn = [...value.dependsOn].sort(compareStrings);
		if (dependsOn.length !== value.dependsOn.length || dependsOn.includes(value.stepId)) {
			throw new RuntimeStepError("invalid_contract");
		}
		byId.set(value.stepId, {
			stepId: value.stepId,
			kind: value.kind,
			required: value.required,
			dependsOn,
			execute: value.execute,
		});
	}
	for (const step of byId.values()) {
		for (const dependency of step.dependsOn) {
			if (!byId.has(dependency)) throw new RuntimeStepError("invalid_contract");
		}
	}

	const pending = new Map(byId);
	const ordered: RuntimeStep[] = [];
	while (pending.size > 0) {
		const ready = [...pending.values()]
			.filter((step) => step.dependsOn.every((dependency) => !pending.has(dependency)))
			.sort((left, right) => compareStrings(left.stepId, right.stepId));
		if (ready.length === 0) throw new RuntimeStepError("invalid_contract");
		for (const step of ready) {
			ordered.push(step);
			pending.delete(step.stepId);
		}
	}
	return ordered;
}

function cloneCandidate(candidate: ResultCandidate): ResultCandidate {
	return {
		columns: candidate.columns.map((column) => ({
			columnId: column.columnId,
			label: column.label,
			dataType: column.dataType,
			nullable: column.nullable,
			...(column.source === undefined
				? {}
				: { source: { tableId: column.source.tableId, columnId: column.source.columnId } }),
		})),
		rows: candidate.rows.map((row) => [...row]),
		rowCount: candidate.rowCount,
	};
}

function waitWithAbort(signal: AbortSignal, delayMs: number): Promise<void> {
	if (signal.aborted) return Promise.reject(new RuntimeStepError("cancelled"));
	if (delayMs === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			if (signal.aborted) reject(new RuntimeStepError("cancelled"));
			else resolve();
		}, delayMs);
		const onAbort = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(new RuntimeStepError("cancelled"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export class FixtureQueryExecutor implements ReadOnlyQueryExecutor<ResultCandidate> {
	private readonly cases: ReadonlyMap<string, ResultCandidate>;
	private readonly delayMs: number;
	private closed = false;
	private _activeExecutions = 0;
	private _executeCount = 0;
	private readonly activeControllers = new Set<AbortController>();

	constructor(options: FixtureQueryExecutorOptions) {
		if (!Array.isArray(options.cases) || options.cases.length === 0) {
			throw new RuntimeStepError("invalid_contract");
		}
		const entries = new Map<string, ResultCandidate>();
		for (const fixtureCase of options.cases) {
			if (
				!isRecord(fixtureCase) ||
				typeof fixtureCase.queryDigest !== "string" ||
				!isCandidateShape(fixtureCase.candidate)
			) {
				throw new RuntimeStepError("invalid_contract");
			}
			if (entries.has(fixtureCase.queryDigest)) throw new RuntimeStepError("invalid_contract");
			entries.set(fixtureCase.queryDigest, cloneCandidate(fixtureCase.candidate));
		}
		if (options.delayMs !== undefined && (!Number.isInteger(options.delayMs) || options.delayMs < 0)) {
			throw new RuntimeStepError("invalid_contract");
		}
		this.cases = entries;
		this.delayMs = options.delayMs ?? 0;
	}

	get activeExecutions(): number {
		return this._activeExecutions;
	}

	get executeCount(): number {
		return this._executeCount;
	}

	get isDisposed(): boolean {
		return this.closed;
	}

	dispose(): void {
		this.closed = true;
		for (const controller of this.activeControllers) controller.abort();
	}

	async execute(request: ReadOnlyQueryExecutionRequest): Promise<ResultCandidate> {
		if (this.closed) throw new RuntimeStepError("executor_failed");
		if (request.compiledQuery.readOnly !== true || request.compiledQuery.dialect !== "fixture-sql") {
			throw new RuntimeStepError("query_unsupported");
		}
		const candidate = this.cases.get(request.compiledQuery.queryDigest);
		if (candidate === undefined) throw new RuntimeStepError("executor_failed");
		this._executeCount += 1;
		this._activeExecutions += 1;
		const controller = new AbortController();
		const parent = request.context.signal;
		const onParentAbort = () => controller.abort();
		if (parent !== undefined) {
			if (parent.aborted) controller.abort();
			else parent.addEventListener("abort", onParentAbort, { once: true });
		}
		this.activeControllers.add(controller);
		try {
			await waitWithAbort(controller.signal, this.delayMs);
			return cloneCandidate(candidate);
		} finally {
			this.activeControllers.delete(controller);
			if (parent !== undefined) parent.removeEventListener("abort", onParentAbort);
			this._activeExecutions -= 1;
		}
	}
}

function mapMinimizationError(code: "invalid_candidate" | "privacy_blocked" | "budget_exceeded"): ResultErrorCode {
	if (code === "privacy_blocked") return "privacy_blocked";
	if (code === "budget_exceeded") return "budget_exceeded";
	return "invalid_result";
}

function mapRuntimeError(code: RuntimeFailureCode): ResultErrorCode {
	if (code === "dependency_failed") return "executor_failed";
	if (code === "invalid_contract") return "invalid_contract";
	if (code === "invalid_result") return "invalid_result";
	if (code === "privacy_blocked") return "privacy_blocked";
	if (code === "query_unsupported") return "query_unsupported";
	if (code === "permission_denied") return "permission_denied";
	if (code === "unknown_permission") return "unknown_permission";
	if (code === "freshness_expired") return "freshness_expired";
	if (code === "budget_exceeded") return "budget_exceeded";
	if (code === "cancelled") return "cancelled";
	if (code === "deadline_exceeded") return "deadline_exceeded";
	if (code === "evidence_failed") return "evidence_failed";
	return "executor_failed";
}

function mapPreflightError(code: PreflightBlockReason): ResultErrorCode {
	if (code === "cancelled") return "cancelled";
	if (code === "budget_exceeded") return "budget_exceeded";
	if (code === "permission_denied") return "permission_denied";
	if (code === "unknown_permission") return "unknown_permission";
	if (code === "freshness_expired") return "freshness_expired";
	return "invalid_contract";
}

function mapCompilerError(error: QueryCompilerError): ResultErrorCode {
	if (error.code === "cancelled") return "cancelled";
	if (error.code === "budget_exceeded") return "budget_exceeded";
	if (error.code === "unsupported_dialect" || error.code === "unsupported_relationship") {
		return "query_unsupported";
	}
	return "invalid_contract";
}

export interface FixtureQueryStepDefinition {
	readonly stepId: ResourceId;
	readonly required: boolean;
	readonly dependsOn: readonly ResourceId[];
	readonly compiledQuery: CompiledQuery;
	readonly executor: ReadOnlyQueryExecutor<ResultCandidate>;
	readonly lineage: ResultLineage;
	readonly freshness: Freshness;
	readonly minimization: ResultMinimizationPolicy;
	readonly planRef: AnalysisPlanRef;
	readonly contextPack: ContextPackRef;
	readonly policyDecisions: readonly EvidencePolicyDecision[];
	readonly resultId: ResourceId;
	readonly evidenceId: ResourceId;
	readonly resultVersion?: string;
	readonly evidenceVersion?: string;
}

export function createFixtureQueryStep(definition: FixtureQueryStepDefinition): RuntimeStep {
	return {
		stepId: definition.stepId,
		kind: "query",
		required: definition.required,
		dependsOn: definition.dependsOn,
		execute: async (invocation) => {
			const base = {
				resultId: definition.resultId,
				resultVersion: definition.resultVersion ?? "1.0.0",
				runId: invocation.runId,
				stepId: definition.stepId,
				lineage: definition.lineage,
				asOf: definition.compiledQuery.asOf,
				freshness: definition.freshness,
			};
			let candidate: ResultCandidate;
			try {
				candidate = await definition.executor.execute({
					compiledQuery: definition.compiledQuery,
					context: invocation.context,
				});
			} catch (error) {
				const code = error instanceof RuntimeStepError ? error.code : "executor_failed";
				return { result: createBlockedResultEnvelope({ ...base, error: mapRuntimeError(code) }) };
			}
			let result: ResultEnvelope;
			try {
				const minimized = minimizeResult(candidate, definition.minimization);
				if (minimized.status === "blocked") {
					return {
						result: createBlockedResultEnvelope({
							...base,
							error: mapMinimizationError(minimized.reason),
						}),
					};
				}
				result = createResultEnvelope({ ...base, minimized });
			} catch {
				return { result: createBlockedResultEnvelope({ ...base, error: "invalid_result" }) };
			}
			try {
				const evidence = createEvidenceEnvelope({
					evidenceId: definition.evidenceId,
					evidenceVersion: definition.evidenceVersion ?? "1.0.0",
					planRef: definition.planRef,
					contextPack: definition.contextPack,
					result,
					compiledQuery: definition.compiledQuery,
					policyDecisions: definition.policyDecisions,
				});
				return { result, evidence };
			} catch {
				return { result: createBlockedResultEnvelope({ ...base, error: "evidence_failed" }) };
			}
		},
	};
}

export interface PreflightedFixtureQueryStepDefinition extends Omit<FixtureQueryStepDefinition, "compiledQuery"> {
	readonly preflight: QueryPreflightResult;
}

export function createPreflightedFixtureQueryStep(definition: PreflightedFixtureQueryStepDefinition): RuntimeStep {
	return {
		stepId: definition.stepId,
		kind: "query",
		required: definition.required,
		dependsOn: definition.dependsOn,
		execute: async (invocation) => {
			const base = {
				resultId: definition.resultId,
				resultVersion: definition.resultVersion ?? "1.0.0",
				runId: invocation.runId,
				stepId: definition.stepId,
				lineage: definition.lineage,
				asOf: definition.preflight.status === "ready" ? invocation.context.asOf : definition.freshness.asOf,
				freshness: definition.freshness,
			};
			if (definition.preflight.status !== "ready") {
				return {
					result: createBlockedResultEnvelope({ ...base, error: mapPreflightError(definition.preflight.reason) }),
				};
			}
			let compiledQuery: CompiledQuery;
			try {
				compiledQuery = compileQueryPlan(definition.preflight, invocation.context);
			} catch (error) {
				const code = error instanceof QueryCompilerError ? mapCompilerError(error) : "invalid_contract";
				return { result: createBlockedResultEnvelope({ ...base, error: code }) };
			}
			return createFixtureQueryStep({ ...definition, compiledQuery }).execute(invocation);
		},
	};
}

function resultBytes(result: ResultEnvelope): number {
	const serialized = JSON.stringify(result.rows);
	if (serialized === undefined) throw new RuntimeStepError("invalid_result");
	return Buffer.byteLength(serialized, "utf8");
}

function sameLineage(left: ResultLineage, right: ResultLineage): boolean {
	return (
		left.source.sourceId === right.source.sourceId &&
		left.source.version === right.source.version &&
		left.snapshot.id === right.snapshot.id &&
		left.snapshot.version === right.snapshot.version &&
		left.binding.id === right.binding.id &&
		left.binding.version === right.binding.version &&
		left.executionSpec.id === right.executionSpec.id &&
		left.executionSpec.version === right.executionSpec.version
	);
}

function sameFreshness(left: Freshness, right: Freshness): boolean {
	return (
		left.asOf === right.asOf &&
		left.checkedAt === right.checkedAt &&
		left.status === right.status &&
		left.maxAgeSeconds === right.maxAgeSeconds
	);
}

function normalizeStepOutput(
	value: unknown,
	runId: ResourceId,
	stepId: ResourceId,
): { readonly result: ResultEnvelope; readonly evidence?: EvidenceEnvelope } {
	if (!isRecord(value) || !("result" in value)) throw new RuntimeStepError("invalid_contract");
	const result = normalizeResultEnvelope(value.result);
	if (result.runId !== runId || result.stepId !== stepId) throw new RuntimeStepError("invalid_contract");
	if (result.status === "blocked" || result.status === "clarification_required") {
		if (value.evidence !== undefined) throw new RuntimeStepError("invalid_contract");
		return { result };
	}
	if (!result.canEvidence || value.evidence === undefined) throw new RuntimeStepError("evidence_failed");
	const evidence = normalizeEvidenceEnvelope(value.evidence);
	if (
		evidence.runId !== runId ||
		evidence.stepId !== stepId ||
		evidence.result.resultId !== result.resultId ||
		evidence.result.resultVersion !== result.resultVersion ||
		evidence.asOf !== result.asOf ||
		!sameFreshness(evidence.freshness, result.freshness) ||
		!sameLineage(evidence.lineage, result.lineage)
	) {
		throw new RuntimeStepError("evidence_failed");
	}
	if (result.status === "complete" && evidence.status !== "complete") {
		throw new RuntimeStepError("evidence_failed");
	}
	if (result.status === "partial" && evidence.status !== "partial") {
		throw new RuntimeStepError("evidence_failed");
	}
	return { result, evidence };
}

function makeRecord(
	step: RuntimeStep,
	status: RuntimeStepStatus,
	error?: RuntimeFailureCode,
	output?: { readonly result: ResultEnvelope; readonly evidence?: EvidenceEnvelope },
): RuntimeStepRecord {
	return {
		stepId: step.stepId,
		kind: step.kind,
		required: step.required,
		status,
		...(output?.result === undefined ? {} : { result: output.result }),
		...(output?.evidence === undefined ? {} : { evidence: output.evidence }),
		...(error === undefined ? {} : { error }),
	};
}

function statusForFailure(code: RuntimeFailureCode): RuntimeStepStatus {
	return code === "dependency_failed" ? "skipped" : "blocked";
}

function createRuntimeSignal(
	parent: AbortSignal | undefined,
	deadlineMs: number | undefined,
): { readonly signal: AbortSignal; readonly deadlineTriggered: () => boolean; readonly dispose: () => void } {
	const controller = new AbortController();
	let deadlineTriggered = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const onParentAbort = () => controller.abort();
	if (parent !== undefined) {
		if (parent.aborted) controller.abort();
		else parent.addEventListener("abort", onParentAbort, { once: true });
	}
	if (deadlineMs !== undefined) {
		const delay = deadlineMs - Date.now();
		if (delay <= 0) {
			deadlineTriggered = true;
			controller.abort();
		} else {
			timer = setTimeout(
				() => {
					deadlineTriggered = true;
					controller.abort();
				},
				Math.min(delay, 2_147_483_647),
			);
		}
	}
	return {
		signal: controller.signal,
		deadlineTriggered: () => deadlineTriggered,
		dispose: () => {
			if (timer !== undefined) clearTimeout(timer);
			if (parent !== undefined) parent.removeEventListener("abort", onParentAbort);
		},
	};
}

function runStatus(records: readonly RuntimeStepRecord[]): RuntimeRunResult["status"] {
	const completed = records.some((record) => record.status === "complete" || record.status === "partial");
	const hasClarification = records.some((record) => record.status === "clarification_required");
	const hasFailure = records.some((record) => record.status !== "complete");
	if (!hasFailure) return "complete";
	if (completed) return "partial";
	if (hasClarification) return "clarification_required";
	return "blocked";
}

export async function runSerialAnalysis(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
	validateRuntimeRequest(request);
	const steps = normalizeRuntimeSteps(request.steps);
	const now = request.now ?? Date.now;
	const deadlineMs = request.deadlineAt === undefined ? undefined : Date.parse(request.deadlineAt);
	const signalState = createRuntimeSignal(request.context.signal, deadlineMs);
	const context: ExecutionContext = { ...request.context, signal: signalState.signal };
	const records: RuntimeStepRecord[] = [];
	const byId = new Map<ResourceId, RuntimeStepRecord>();
	let used: RuntimeBudgetUsage = { steps: 0, rows: 0, bytes: 0 };

	const addRecord = (record: RuntimeStepRecord): void => {
		records.push(record);
		byId.set(record.stepId, record);
	};
	const markRemaining = (startIndex: number, code: RuntimeFailureCode): void => {
		for (let index = startIndex; index < steps.length; index += 1) {
			const step = steps[index];
			if (step !== undefined && !byId.has(step.stepId)) addRecord(makeRecord(step, statusForFailure(code), code));
		}
	};

	try {
		for (let index = 0; index < steps.length; index += 1) {
			const step = steps[index];
			if (step === undefined) continue;
			const deadlineExceeded = deadlineMs !== undefined && now() >= deadlineMs;
			if (signalState.signal.aborted || deadlineExceeded) {
				const code: RuntimeFailureCode =
					signalState.deadlineTriggered() || deadlineExceeded ? "deadline_exceeded" : "cancelled";
				addRecord(makeRecord(step, "blocked", code));
				markRemaining(index + 1, code);
				break;
			}
			if (used.steps >= request.context.budget.maxSteps) {
				addRecord(makeRecord(step, "skipped", "budget_exceeded"));
				markRemaining(index + 1, "budget_exceeded");
				break;
			}
			if (step.dependsOn.some((dependency) => byId.get(dependency)?.status !== "complete")) {
				addRecord(makeRecord(step, "skipped", "dependency_failed"));
				continue;
			}
			used = { ...used, steps: used.steps + 1 };
			const remaining: RuntimeRemainingBudget = {
				maxRows: request.context.budget.maxRows - used.rows,
				maxBytes: request.context.budget.maxBytes - used.bytes,
				maxSteps: request.context.budget.maxSteps - used.steps,
			};
			if (remaining.maxRows < 1 || remaining.maxBytes < 1) {
				addRecord(makeRecord(step, "blocked", "budget_exceeded"));
				continue;
			}
			let rawOutput: unknown;
			try {
				rawOutput = await step.execute({
					runId: request.context.runId,
					stepId: step.stepId,
					signal: signalState.signal,
					context,
					used,
					remaining,
				});
			} catch (error) {
				const code: RuntimeFailureCode =
					signalState.deadlineTriggered() || (deadlineMs !== undefined && now() >= deadlineMs)
						? "deadline_exceeded"
						: signalState.signal.aborted
							? "cancelled"
							: error instanceof RuntimeStepError
								? error.code
								: "executor_failed";
				addRecord(makeRecord(step, statusForFailure(code), code));
				continue;
			}
			if (signalState.deadlineTriggered() || (deadlineMs !== undefined && now() >= deadlineMs)) {
				addRecord(makeRecord(step, "blocked", "deadline_exceeded"));
				continue;
			}
			if (signalState.signal.aborted) {
				addRecord(makeRecord(step, "blocked", "cancelled"));
				continue;
			}
			let output: { readonly result: ResultEnvelope; readonly evidence?: EvidenceEnvelope };
			try {
				output = normalizeStepOutput(rawOutput, request.context.runId, step.stepId);
			} catch (error) {
				const code = error instanceof RuntimeStepError ? error.code : "invalid_contract";
				addRecord(makeRecord(step, statusForFailure(code), code));
				continue;
			}
			if (output.result.status === "blocked" || output.result.status === "clarification_required") {
				const resultError = output.result.errors[0]?.code ?? "invalid_contract";
				addRecord(makeRecord(step, output.result.status, resultError));
				continue;
			}
			const bytes = resultBytes(output.result);
			if (
				output.result.returnedCount > remaining.maxRows ||
				bytes > remaining.maxBytes ||
				output.result.returnedCount < 0
			) {
				addRecord(makeRecord(step, "blocked", "budget_exceeded"));
				continue;
			}
			used = { steps: used.steps, rows: used.rows + output.result.returnedCount, bytes: used.bytes + bytes };
			addRecord(makeRecord(step, output.result.status, undefined, output));
		}
		if (records.length < steps.length) {
			const code: RuntimeFailureCode = signalState.deadlineTriggered() ? "deadline_exceeded" : "cancelled";
			markRemaining(0, code);
		}
	} finally {
		signalState.dispose();
	}

	const completedStepIds = records
		.filter((record) => record.status === "complete" || record.status === "partial")
		.map((record) => record.stepId);
	const failedStepIds = records
		.filter((record) => record.status === "blocked" || record.status === "clarification_required")
		.map((record) => record.stepId);
	const skippedStepIds = records.filter((record) => record.status === "skipped").map((record) => record.stepId);
	return {
		contractVersion: ANALYSIS_CONTRACT_VERSION,
		runId: request.context.runId,
		status: runStatus(records),
		records,
		completedStepIds,
		failedStepIds,
		skippedStepIds,
		used,
	};
}
