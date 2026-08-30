import {
	DateTimeSchema,
	isContract,
	type ResourceId,
	ResourceIdSchema,
	type SourceType,
	SourceTypeSchema,
	type VersionId,
	VersionIdSchema,
} from "./contracts.ts";
import {
	digestRuntimeText,
	type RuntimeHost,
	type RuntimeHostFailureCode,
	RuntimeHostFailureCodeSchema,
	type RuntimeHostStartRequest,
	RuntimeHostStartRequestSchema,
	type RuntimeHostStatus,
	type RuntimeRunSnapshot,
} from "./runtime-host.ts";
import type {
	ControlledToolFailureCode,
	ControlledToolInvocationRequest,
	ControlledToolInvocationResult,
	ControlledToolRegistry,
} from "./tool-registry.ts";

export const LOOP_CONTROLLER_CONTRACT_VERSION = "loop.v1" as const;

export interface LoopControllerStartRequest extends RuntimeHostStartRequest {
	readonly deadlineAt?: string;
}

export interface LoopToolInvocation {
	readonly invocationId: ResourceId;
	readonly runId: ResourceId;
	readonly ownerId: ResourceId;
	readonly workspaceId: ResourceId;
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly sourceType: SourceType;
	readonly input: unknown;
}

export interface LoopToolResultSummary {
	readonly status: "complete" | "partial" | "blocked";
	readonly rows: number;
	readonly bytes: number;
	readonly evidenceReady: boolean;
	readonly reason?: ControlledToolFailureCode;
	readonly resultDigest?: string;
}

export interface LoopTurnContext {
	readonly contractVersion: typeof LOOP_CONTROLLER_CONTRACT_VERSION;
	readonly runId: ResourceId;
	readonly ownerId: ResourceId;
	readonly workspaceId: ResourceId;
	readonly turn: number;
	readonly retries: number;
	readonly phase: "planning" | "executing";
	readonly signal: AbortSignal;
	readonly lastToolResult?: LoopToolResultSummary;
	readonly clarificationDigest?: string;
}

export type LoopDecision =
	| {
			readonly type: "clarification_required";
			readonly questionDigest: string;
	  }
	| {
			readonly type: "tool_call";
			readonly planDigest?: string;
			readonly invocation: LoopToolInvocation;
	  }
	| {
			readonly type: "complete";
			readonly planDigest?: string;
			readonly resultReady: boolean;
			readonly evidenceReady: boolean;
	  }
	| {
			readonly type: "partial";
			readonly planDigest?: string;
			readonly resultReady: boolean;
			readonly evidenceReady: boolean;
			readonly reason: RuntimeHostFailureCode;
	  }
	| {
			readonly type: "blocked";
			readonly reason: RuntimeHostFailureCode;
	  };

export interface LoopDriver {
	decide(context: LoopTurnContext): Promise<unknown>;
}

export interface LoopControllerOptions {
	readonly host: RuntimeHost;
	readonly registry: ControlledToolRegistry;
	readonly driver: LoopDriver;
	readonly maxTurns: number;
	readonly maxRetries?: number;
	readonly retryableReasons?: readonly ControlledToolFailureCode[];
	readonly signal?: AbortSignal;
	readonly now?: () => number;
}

export interface LoopControllerResult {
	readonly contractVersion: typeof LOOP_CONTROLLER_CONTRACT_VERSION;
	readonly runId: ResourceId;
	readonly status: RuntimeHostStatus;
	readonly snapshot: RuntimeRunSnapshot;
	readonly turns: number;
	readonly retries: number;
	readonly clarificationDigest?: string;
	readonly lastToolResult?: LoopToolResultSummary;
}

export type LoopControllerErrorCode = "invalid_options" | "invalid_contract" | "invalid_state" | "invalid_clock";

export class LoopControllerError extends Error {
	readonly code: LoopControllerErrorCode;

	constructor(code: LoopControllerErrorCode, message: string = code) {
		super(message);
		this.name = "LoopControllerError";
		this.code = code;
	}
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const CONTROLLED_TOOL_FAILURE_CODES: ReadonlySet<string> = new Set([
	"invalid_invocation",
	"tool_not_registered",
	"tool_version_mismatch",
	"tool_not_read_only",
	"invalid_tool_input",
	"unsafe_tool_request",
	"source_type_not_allowed",
	"authorization_denied",
	"authorization_unknown",
	"budget_exceeded",
	"cancelled",
	"timeout_exceeded",
	"duplicate_invocation",
	"executor_failed",
	"invalid_tool_result",
	"evidence_required",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAbortSignal(value: unknown): value is AbortSignal {
	return (
		isRecord(value) &&
		typeof value.aborted === "boolean" &&
		typeof value.addEventListener === "function" &&
		typeof value.removeEventListener === "function"
	);
}

function isDigest(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isDateTime(value: unknown): value is string {
	return typeof value === "string" && isContract(DateTimeSchema, value) && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function isNonNegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function isControlledToolFailureCode(value: unknown): value is ControlledToolFailureCode {
	return typeof value === "string" && CONTROLLED_TOOL_FAILURE_CODES.has(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function isTerminalStatus(status: RuntimeHostStatus): boolean {
	return status === "complete" || status === "partial" || status === "blocked";
}

function serialize(value: unknown): string | undefined {
	try {
		const result = JSON.stringify(value);
		return result === undefined ? undefined : result;
	} catch {
		return undefined;
	}
}

function cloneToolSummary(summary: LoopToolResultSummary): LoopToolResultSummary {
	return {
		status: summary.status,
		rows: summary.rows,
		bytes: summary.bytes,
		evidenceReady: summary.evidenceReady,
		...(summary.reason === undefined ? {} : { reason: summary.reason }),
		...(summary.resultDigest === undefined ? {} : { resultDigest: summary.resultDigest }),
	};
}

function normalizeStartRequest(value: unknown): LoopControllerStartRequest {
	if (!isRecord(value)) throw new LoopControllerError("invalid_contract");
	const { deadlineAt, ...runtimeRequest } = value;
	if (!isContract(RuntimeHostStartRequestSchema, runtimeRequest)) {
		throw new LoopControllerError("invalid_contract");
	}
	if (deadlineAt !== undefined && !isDateTime(deadlineAt)) {
		throw new LoopControllerError("invalid_contract");
	}
	return {
		runId: runtimeRequest.runId,
		ownerId: runtimeRequest.ownerId,
		workspaceId: runtimeRequest.workspaceId,
		question: runtimeRequest.question,
		budget: {
			maxSteps: runtimeRequest.budget.maxSteps,
			maxRows: runtimeRequest.budget.maxRows,
			maxBytes: runtimeRequest.budget.maxBytes,
		},
		...(deadlineAt === undefined ? {} : { deadlineAt }),
	};
}

function normalizeInvocation(value: unknown): LoopToolInvocation | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"invocationId",
			"runId",
			"ownerId",
			"workspaceId",
			"toolId",
			"version",
			"sourceType",
			"input",
		]) ||
		!isContract(ResourceIdSchema, value.invocationId) ||
		!isContract(ResourceIdSchema, value.runId) ||
		!isContract(ResourceIdSchema, value.ownerId) ||
		!isContract(ResourceIdSchema, value.workspaceId) ||
		!isContract(ResourceIdSchema, value.toolId) ||
		!isContract(VersionIdSchema, value.version) ||
		!isContract(SourceTypeSchema, value.sourceType)
	) {
		return undefined;
	}
	return {
		invocationId: value.invocationId,
		runId: value.runId,
		ownerId: value.ownerId,
		workspaceId: value.workspaceId,
		toolId: value.toolId,
		version: value.version,
		sourceType: value.sourceType,
		input: value.input,
	};
}

function normalizeDecision(value: unknown): LoopDecision | undefined {
	if (!isRecord(value) || typeof value.type !== "string") return undefined;
	if (value.type === "clarification_required") {
		return hasOnlyKeys(value, ["type", "questionDigest"]) && isDigest(value.questionDigest)
			? { type: value.type, questionDigest: value.questionDigest }
			: undefined;
	}
	if (value.type === "tool_call") {
		if (!hasOnlyKeys(value, ["type", "planDigest", "invocation"])) return undefined;
		if (value.planDigest !== undefined && !isDigest(value.planDigest)) return undefined;
		const invocation = normalizeInvocation(value.invocation);
		if (invocation === undefined) return undefined;
		return value.planDigest === undefined
			? { type: value.type, invocation }
			: { type: value.type, planDigest: value.planDigest, invocation };
	}
	if (value.type === "complete") {
		if (
			!hasOnlyKeys(value, ["type", "planDigest", "resultReady", "evidenceReady"]) ||
			(value.planDigest !== undefined && !isDigest(value.planDigest)) ||
			typeof value.resultReady !== "boolean" ||
			typeof value.evidenceReady !== "boolean"
		) {
			return undefined;
		}
		return value.planDigest === undefined
			? { type: value.type, resultReady: value.resultReady, evidenceReady: value.evidenceReady }
			: {
					type: value.type,
					planDigest: value.planDigest,
					resultReady: value.resultReady,
					evidenceReady: value.evidenceReady,
				};
	}
	if (value.type === "partial") {
		if (
			!hasOnlyKeys(value, ["type", "planDigest", "resultReady", "evidenceReady", "reason"]) ||
			(value.planDigest !== undefined && !isDigest(value.planDigest)) ||
			typeof value.resultReady !== "boolean" ||
			typeof value.evidenceReady !== "boolean" ||
			!isContract(RuntimeHostFailureCodeSchema, value.reason)
		) {
			return undefined;
		}
		return value.planDigest === undefined
			? {
					type: value.type,
					resultReady: value.resultReady,
					evidenceReady: value.evidenceReady,
					reason: value.reason,
				}
			: {
					type: value.type,
					planDigest: value.planDigest,
					resultReady: value.resultReady,
					evidenceReady: value.evidenceReady,
					reason: value.reason,
				};
	}
	if (value.type === "blocked") {
		return hasOnlyKeys(value, ["type", "reason"]) && isContract(RuntimeHostFailureCodeSchema, value.reason)
			? { type: value.type, reason: value.reason }
			: undefined;
	}
	return undefined;
}

function mapToolFailure(reason: ControlledToolFailureCode): RuntimeHostFailureCode {
	switch (reason) {
		case "invalid_invocation":
		case "invalid_tool_input":
			return "invalid_tool_input";
		case "tool_not_registered":
		case "tool_version_mismatch":
			return "tool_not_registered";
		case "tool_not_read_only":
		case "unsafe_tool_request":
			return "unsafe_tool_request";
		case "source_type_not_allowed":
		case "authorization_denied":
			return "secret_or_egress_denied";
		case "authorization_unknown":
			return "runtime_unavailable";
		case "budget_exceeded":
			return "budget_exhausted";
		case "cancelled":
			return "cancelled";
		case "timeout_exceeded":
		case "executor_failed":
			return "runtime_failed";
		case "duplicate_invocation":
			return "trace_anomaly";
		case "invalid_tool_result":
			return "invalid_tool_result";
		case "evidence_required":
			return "evidence_required";
	}
}

type DriverRace =
	| { readonly kind: "decision"; readonly value: unknown }
	| { readonly kind: "aborted" }
	| { readonly kind: "failed" };

export class LoopController {
	private readonly host: RuntimeHost;
	private readonly registry: ControlledToolRegistry;
	private readonly driver: LoopDriver;
	private readonly maxTurns: number;
	private readonly maxRetries: number;
	private readonly retryableReasons: ReadonlySet<ControlledToolFailureCode>;
	private readonly parentSignal?: AbortSignal;
	private readonly now: () => number;
	private readonly controller = new AbortController();
	private started = false;
	private startRequest?: LoopControllerStartRequest;
	private deadlineAtMs?: number;
	private deadlineTimer?: ReturnType<typeof setTimeout>;
	private parentAbortCleanup?: () => void;
	private deadlineTriggered = false;
	private externalCancellation = false;
	private userCancellation = false;
	private turns = 0;
	private retries = 0;
	private clarificationDigest?: string;
	private lastToolResult?: LoopToolResultSummary;
	private activeLoop?: Promise<LoopControllerResult>;

	constructor(options: LoopControllerOptions) {
		if (
			!isRecord(options) ||
			!isRecord(options.host) ||
			!isRecord(options.registry) ||
			!isRecord(options.driver) ||
			typeof options.driver.decide !== "function" ||
			!isPositiveInteger(options.maxTurns, 10_000) ||
			(options.maxRetries !== undefined && !isNonNegativeInteger(options.maxRetries, 10_000)) ||
			(options.retryableReasons !== undefined &&
				(!Array.isArray(options.retryableReasons) ||
					options.retryableReasons.some((reason) => !isControlledToolFailureCode(reason)))) ||
			(options.signal !== undefined && !isAbortSignal(options.signal)) ||
			(options.now !== undefined && typeof options.now !== "function")
		) {
			throw new LoopControllerError("invalid_options");
		}
		this.host = options.host;
		this.registry = options.registry;
		this.driver = options.driver;
		this.maxTurns = options.maxTurns;
		this.maxRetries = options.maxRetries ?? 1;
		this.retryableReasons = new Set(options.retryableReasons ?? ["executor_failed", "timeout_exceeded"]);
		this.parentSignal = options.signal;
		this.now = options.now ?? (() => Date.now());
	}

	start(value: unknown): RuntimeRunSnapshot {
		if (this.started) throw new LoopControllerError("invalid_state", "Loop Controller already started");
		const request = normalizeStartRequest(value);
		const initialTime = this.readClock();
		this.startRequest = request;
		this.deadlineAtMs = request.deadlineAt === undefined ? undefined : Date.parse(request.deadlineAt);
		const hostRequest: RuntimeHostStartRequest = {
			runId: request.runId,
			ownerId: request.ownerId,
			workspaceId: request.workspaceId,
			question: request.question,
			budget: request.budget,
		};
		this.host.start(hostRequest);
		this.started = true;
		const planning = this.host.apply(request.runId, { type: "planning_started" });
		if (!planning.accepted) {
			throw new LoopControllerError("invalid_state", "Runtime Host rejected planning start");
		}
		this.attachParentCancellation();
		if (this.parentSignal?.aborted === true) this.handleExternalCancellation();
		if (!isTerminalStatus(this.host.getRun(request.runId).status)) {
			this.scheduleDeadlineTimer(initialTime);
		}
		return this.host.getRun(request.runId);
	}

	run(): Promise<LoopControllerResult> {
		if (!this.started || this.startRequest === undefined) {
			return Promise.reject(new LoopControllerError("invalid_state", "Loop Controller has not started"));
		}
		if (this.activeLoop !== undefined) return this.activeLoop;
		const loop = this.runLoop();
		this.activeLoop = loop;
		void loop
			.finally(() => {
				if (this.activeLoop === loop) this.activeLoop = undefined;
			})
			.catch(() => undefined);
		return loop;
	}

	continue(clarificationDigest: string): Promise<LoopControllerResult> {
		if (!this.started || this.startRequest === undefined) {
			return Promise.reject(new LoopControllerError("invalid_state", "Loop Controller has not started"));
		}
		if (this.activeLoop !== undefined) return this.activeLoop;
		const current = this.host.getRun(this.startRequest.runId);
		if (current.status !== "awaiting_clarification") return Promise.resolve(this.createResult());
		if (this.checkDeadline()) return Promise.resolve(this.createResult());
		if (!isDigest(clarificationDigest)) {
			this.blockHost("invalid_runtime_event");
			return Promise.resolve(this.createResult());
		}
		const transition = this.host.apply(this.startRequest.runId, { type: "clarification_received" });
		if (!transition.accepted) return Promise.resolve(this.createResult());
		this.clarificationDigest = clarificationDigest;
		return this.run();
	}

	cancel(): LoopControllerResult {
		if (!this.started || this.startRequest === undefined) {
			throw new LoopControllerError("invalid_state", "Loop Controller has not started");
		}
		this.userCancellation = true;
		this.controller.abort();
		this.cancelHost();
		return this.createResult();
	}

	private async runLoop(): Promise<LoopControllerResult> {
		while (true) {
			const current = this.host.getRun(this.startRequest?.runId ?? "invalid-run");
			if (isTerminalStatus(current.status) || current.status === "awaiting_clarification") {
				return this.createResult();
			}
			if (this.deadlineTriggered || this.checkDeadline()) return this.createResult();
			if (this.externalCancellation || this.userCancellation || this.controller.signal.aborted) {
				this.cancelHost();
				return this.createResult();
			}
			if (current.status !== "planning" && current.status !== "executing") {
				this.blockHost("invalid_transition");
				return this.createResult();
			}
			if (this.turns >= this.maxTurns) {
				this.blockHost("budget_exhausted");
				return this.createResult();
			}

			this.turns += 1;
			const driverRace = await this.requestDecision(this.createTurnContext(current));
			if (driverRace.kind === "aborted") {
				if (this.deadlineTriggered) this.blockHost("deadline_exceeded");
				else this.cancelHost();
				return this.createResult();
			}
			if (this.deadlineTriggered || this.checkDeadline()) return this.createResult();
			if (this.externalCancellation || this.userCancellation || this.controller.signal.aborted) {
				this.cancelHost();
				return this.createResult();
			}
			if (driverRace.kind === "failed") {
				this.blockHost("runtime_failed");
				return this.createResult();
			}
			const decision = normalizeDecision(driverRace.value);
			if (decision === undefined) {
				this.blockHost("invalid_runtime_event");
				return this.createResult();
			}
			if (!(await this.applyDecision(decision))) return this.createResult();
		}
	}

	private createTurnContext(snapshot: RuntimeRunSnapshot): LoopTurnContext {
		return {
			contractVersion: LOOP_CONTROLLER_CONTRACT_VERSION,
			runId: snapshot.runId,
			ownerId: snapshot.ownerId,
			workspaceId: snapshot.workspaceId,
			turn: this.turns,
			retries: this.retries,
			phase: snapshot.status === "planning" ? "planning" : "executing",
			signal: this.controller.signal,
			...(this.lastToolResult === undefined ? {} : { lastToolResult: cloneToolSummary(this.lastToolResult) }),
			...(this.clarificationDigest === undefined ? {} : { clarificationDigest: this.clarificationDigest }),
		};
	}

	private async requestDecision(context: LoopTurnContext): Promise<DriverRace> {
		if (this.controller.signal.aborted) return { kind: "aborted" };
		let resolveAbort: (() => void) | undefined;
		const aborted = new Promise<DriverRace>((resolve) => {
			resolveAbort = () => resolve({ kind: "aborted" });
		});
		const onAbort = () => resolveAbort?.();
		this.controller.signal.addEventListener("abort", onAbort, { once: true });
		const decision = Promise.resolve()
			.then(() => {
				if (this.controller.signal.aborted) return Promise.reject(new Error("aborted"));
				return this.driver.decide(context);
			})
			.then(
				(value): DriverRace => ({ kind: "decision", value }),
				(): DriverRace => ({ kind: "failed" }),
			);
		const result = await Promise.race([decision, aborted]);
		this.controller.signal.removeEventListener("abort", onAbort);
		return result;
	}

	private async applyDecision(decision: LoopDecision): Promise<boolean> {
		switch (decision.type) {
			case "clarification_required": {
				const transition = this.host.apply(this.startRequest?.runId ?? "invalid-run", {
					type: "clarification_required",
					questionDigest: decision.questionDigest,
				});
				if (transition.accepted) this.clarificationDigest = decision.questionDigest;
				return transition.accepted;
			}
			case "tool_call":
				return this.applyToolDecision(decision);
			case "complete":
				if (!this.ensureExecuting(decision.planDigest)) return false;
				return this.host.apply(this.startRequest?.runId ?? "invalid-run", {
					type: "run_completed",
					resultReady: decision.resultReady,
					evidenceReady: decision.evidenceReady,
				}).accepted;
			case "partial":
				if (!this.ensureExecuting(decision.planDigest)) return false;
				return this.host.apply(this.startRequest?.runId ?? "invalid-run", {
					type: "run_partial",
					resultReady: decision.resultReady,
					evidenceReady: decision.evidenceReady,
					reason: decision.reason,
				}).accepted;
			case "blocked":
				return this.host.apply(this.startRequest?.runId ?? "invalid-run", {
					type: "run_blocked",
					reason: decision.reason,
				}).accepted;
		}
	}

	private async applyToolDecision(decision: Extract<LoopDecision, { readonly type: "tool_call" }>): Promise<boolean> {
		if (!this.ensureExecuting(decision.planDigest)) return false;
		const invocation = this.buildInvocation(decision.invocation);
		if (invocation === undefined) return false;
		const runId = this.startRequest?.runId ?? "invalid-run";
		const requested = this.host.apply(runId, {
			type: "tool_call_requested",
			callId: invocation.invocationId,
			toolName: invocation.toolId,
			inputDigest: digestRuntimeText(serialize(invocation.input) ?? ""),
		});
		if (!requested.accepted) return false;

		let result: ControlledToolInvocationResult<unknown>;
		try {
			result = await this.registry.invoke(invocation);
		} catch {
			this.blockHost("runtime_failed");
			return false;
		}
		if (this.deadlineTriggered) {
			this.blockHost("deadline_exceeded");
			return false;
		}
		if (this.externalCancellation || this.userCancellation || this.controller.signal.aborted) {
			this.cancelHost();
			return false;
		}
		return this.applyToolResult(invocation.invocationId, result);
	}

	private buildInvocation(value: LoopToolInvocation): ControlledToolInvocationRequest | undefined {
		const request = this.startRequest;
		if (
			request === undefined ||
			value.runId !== request.runId ||
			value.ownerId !== request.ownerId ||
			value.workspaceId !== request.workspaceId
		) {
			this.blockHost("invalid_runtime_event");
			return undefined;
		}
		const serialized = serialize(value.input);
		if (serialized === undefined) {
			this.blockHost("invalid_tool_input");
			return undefined;
		}
		const snapshot = this.host.getRun(request.runId);
		return {
			invocationId: value.invocationId,
			runId: value.runId,
			ownerId: value.ownerId,
			workspaceId: value.workspaceId,
			toolId: value.toolId,
			version: value.version,
			sourceType: value.sourceType,
			input: value.input,
			remaining: {
				maxSteps: Math.max(0, snapshot.budget.maxSteps - snapshot.used.steps),
				maxRows: Math.max(0, snapshot.budget.maxRows - snapshot.used.rows),
				maxBytes: Math.max(0, snapshot.budget.maxBytes - snapshot.used.bytes),
			},
			signal: this.controller.signal,
		};
	}

	private applyToolResult(invocationId: ResourceId, result: ControlledToolInvocationResult<unknown>): boolean {
		const runId = this.startRequest?.runId ?? "invalid-run";
		if (result.status === "complete" || result.status === "partial") {
			const completion = this.host.apply(runId, {
				type: "tool_call_completed",
				callId: invocationId,
				status: result.status,
				rows: result.rows,
				bytes: result.bytes,
				evidenceReady: result.evidenceReady,
			});
			if (!completion.accepted) return false;
			const serialized = serialize(result.output);
			this.lastToolResult = {
				status: result.status,
				rows: result.rows,
				bytes: result.bytes,
				evidenceReady: result.evidenceReady,
				...(serialized === undefined ? {} : { resultDigest: digestRuntimeText(serialized) }),
			};
			return true;
		}

		if (result.status !== "blocked") return false;
		const completion = this.host.apply(runId, {
			type: "tool_call_completed",
			callId: invocationId,
			status: "blocked",
			rows: 0,
			bytes: 0,
			evidenceReady: false,
		});
		if (!completion.accepted) return false;
		const reason = result.reason;
		this.lastToolResult = {
			status: "blocked",
			rows: 0,
			bytes: 0,
			evidenceReady: false,
			reason,
		};
		if (reason === "cancelled") {
			this.cancelHost();
			return false;
		}
		if (this.retryableReasons.has(reason) && this.retries < this.maxRetries) {
			this.retries += 1;
			return true;
		}
		this.blockHost(mapToolFailure(reason));
		return false;
	}

	private ensureExecuting(planDigest: string | undefined): boolean {
		const runId = this.startRequest?.runId ?? "invalid-run";
		const current = this.host.getRun(runId);
		if (current.status === "planning") {
			if (planDigest === undefined) {
				this.blockHost("invalid_runtime_event");
				return false;
			}
			return this.host.apply(runId, { type: "plan_ready", planDigest }).accepted;
		}
		if (current.status !== "executing") {
			this.blockHost("invalid_transition");
			return false;
		}
		if (planDigest !== undefined && planDigest !== current.planDigest) {
			this.blockHost("invalid_transition");
			return false;
		}
		return true;
	}

	private createResult(): LoopControllerResult {
		const snapshot = this.host.getRun(this.startRequest?.runId ?? "invalid-run");
		if (isTerminalStatus(snapshot.status)) this.cleanup();
		return {
			contractVersion: LOOP_CONTROLLER_CONTRACT_VERSION,
			runId: snapshot.runId,
			status: snapshot.status,
			snapshot,
			turns: this.turns,
			retries: this.retries,
			...(this.clarificationDigest === undefined ? {} : { clarificationDigest: this.clarificationDigest }),
			...(this.lastToolResult === undefined ? {} : { lastToolResult: cloneToolSummary(this.lastToolResult) }),
		};
	}

	private blockHost(reason: RuntimeHostFailureCode): void {
		if (this.startRequest === undefined) return;
		const current = this.host.getRun(this.startRequest.runId);
		if (isTerminalStatus(current.status)) {
			this.cleanup();
			return;
		}
		this.host.apply(this.startRequest.runId, { type: "run_blocked", reason });
		this.cleanup();
	}

	private cancelHost(): void {
		if (this.startRequest === undefined) return;
		const current = this.host.getRun(this.startRequest.runId);
		if (isTerminalStatus(current.status)) {
			this.cleanup();
			return;
		}
		const cancelling = this.host.cancel(this.startRequest.runId, this.startRequest.ownerId);
		if (cancelling.status === "cancelling") this.host.apply(this.startRequest.runId, { type: "cancelled" });
		this.cleanup();
	}

	private handleExternalCancellation(): void {
		this.externalCancellation = true;
		this.controller.abort();
		this.cancelHost();
	}

	private attachParentCancellation(): void {
		if (this.parentSignal === undefined) return;
		const onAbort = () => this.handleExternalCancellation();
		this.parentSignal.addEventListener("abort", onAbort, { once: true });
		this.parentAbortCleanup = () => this.parentSignal?.removeEventListener("abort", onAbort);
	}

	private checkDeadline(): boolean {
		if (this.deadlineAtMs === undefined) return false;
		const now = this.tryReadClock();
		if (now === undefined) {
			this.blockHost("runtime_failed");
			return true;
		}
		if (now < this.deadlineAtMs && !this.deadlineTriggered) return false;
		this.triggerDeadline();
		return true;
	}

	private triggerDeadline(): void {
		if (this.deadlineTriggered) return;
		this.deadlineTriggered = true;
		this.controller.abort();
		this.blockHost("deadline_exceeded");
	}

	private scheduleDeadlineTimer(initialTime: number): void {
		if (
			this.deadlineAtMs === undefined ||
			isTerminalStatus(this.host.getRun(this.startRequest?.runId ?? "invalid-run").status)
		)
			return;
		const remaining = this.deadlineAtMs - initialTime;
		if (remaining <= 0) {
			this.triggerDeadline();
			return;
		}
		this.deadlineTimer = setTimeout(
			() => {
				this.deadlineTimer = undefined;
				const now = this.tryReadClock();
				if (now === undefined) {
					this.blockHost("runtime_failed");
					return;
				}
				if (now >= (this.deadlineAtMs ?? Number.POSITIVE_INFINITY)) this.triggerDeadline();
				else this.scheduleDeadlineTimer(now);
			},
			Math.min(remaining, MAX_TIMER_DELAY_MS),
		);
	}

	private readClock(): number {
		const value = this.tryReadClock();
		if (value === undefined) throw new LoopControllerError("invalid_clock");
		return value;
	}

	private tryReadClock(): number | undefined {
		try {
			const value = this.now();
			return Number.isFinite(value) ? value : undefined;
		} catch {
			return undefined;
		}
	}

	private cleanup(): void {
		if (this.deadlineTimer !== undefined) {
			clearTimeout(this.deadlineTimer);
			this.deadlineTimer = undefined;
		}
		this.parentAbortCleanup?.();
		this.parentAbortCleanup = undefined;
	}
}
