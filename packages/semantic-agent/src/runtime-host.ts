import { createHash } from "node:crypto";
import Type, { type Static } from "typebox";
import { DateTimeSchema, isContract, type ResourceId, ResourceIdSchema } from "./contracts.ts";

const strictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

const DIGEST_PATTERN = "^sha256:[0-9a-f]{64}$";

export const RUNTIME_HOST_CONTRACT_VERSION = "runtime.v1" as const;

export const RuntimeHostStatusSchema = Type.Union([
	Type.Literal("queued"),
	Type.Literal("planning"),
	Type.Literal("awaiting_clarification"),
	Type.Literal("executing"),
	Type.Literal("cancelling"),
	Type.Literal("reconnecting"),
	Type.Literal("complete"),
	Type.Literal("partial"),
	Type.Literal("blocked"),
]);
export type RuntimeHostStatus = Static<typeof RuntimeHostStatusSchema>;

export type RuntimeHostTerminalStatus = "complete" | "partial" | "blocked";

export const RuntimeHostFailureCodeSchema = Type.Union([
	Type.Literal("invalid_runtime_event"),
	Type.Literal("invalid_transition"),
	Type.Literal("runtime_unavailable"),
	Type.Literal("tool_not_registered"),
	Type.Literal("unsafe_tool_request"),
	Type.Literal("invalid_tool_input"),
	Type.Literal("budget_exhausted"),
	Type.Literal("cancelled"),
	Type.Literal("context_revoked"),
	Type.Literal("secret_or_egress_denied"),
	Type.Literal("invalid_tool_result"),
	Type.Literal("source_unavailable"),
	Type.Literal("trace_anomaly"),
	Type.Literal("persistence_failed"),
	Type.Literal("result_not_ready"),
	Type.Literal("evidence_required"),
	Type.Literal("deadline_exceeded"),
	Type.Literal("runtime_failed"),
]);
export type RuntimeHostFailureCode = Static<typeof RuntimeHostFailureCodeSchema>;

const DigestSchema = Type.String({ pattern: DIGEST_PATTERN });

export const RuntimeHostBudgetSchema = strictObject({
	maxSteps: Type.Integer({ minimum: 1, maximum: 1000 }),
	maxRows: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
	maxBytes: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
});
export type RuntimeHostBudget = Static<typeof RuntimeHostBudgetSchema>;

export const RuntimeHostBudgetUsageSchema = strictObject({
	steps: Type.Integer({ minimum: 0 }),
	rows: Type.Integer({ minimum: 0 }),
	bytes: Type.Integer({ minimum: 0 }),
});
export type RuntimeHostBudgetUsage = Static<typeof RuntimeHostBudgetUsageSchema>;

export const RuntimeHostStartRequestSchema = strictObject({
	runId: ResourceIdSchema,
	ownerId: ResourceIdSchema,
	workspaceId: ResourceIdSchema,
	question: Type.String({ minLength: 1, maxLength: 20_000 }),
	budget: RuntimeHostBudgetSchema,
});
export type RuntimeHostStartRequest = Static<typeof RuntimeHostStartRequestSchema>;

const ToolCallStatusSchema = Type.Union([Type.Literal("complete"), Type.Literal("partial"), Type.Literal("blocked")]);
export type RuntimeHostToolCallStatus = Static<typeof ToolCallStatusSchema>;

const PlanningStartedInputSchema = strictObject({ type: Type.Literal("planning_started") });
const PlanReadyInputSchema = strictObject({ type: Type.Literal("plan_ready"), planDigest: DigestSchema });
const RuntimeMessageInputSchema = strictObject({ type: Type.Literal("runtime_message"), messageDigest: DigestSchema });
const ClarificationRequiredInputSchema = strictObject({
	type: Type.Literal("clarification_required"),
	questionDigest: DigestSchema,
});
const ClarificationReceivedInputSchema = strictObject({ type: Type.Literal("clarification_received") });
const ToolCallRequestedInputSchema = strictObject({
	type: Type.Literal("tool_call_requested"),
	callId: ResourceIdSchema,
	toolName: ResourceIdSchema,
	inputDigest: DigestSchema,
});
const ToolCallCompletedInputSchema = strictObject({
	type: Type.Literal("tool_call_completed"),
	callId: ResourceIdSchema,
	status: ToolCallStatusSchema,
	rows: Type.Integer({ minimum: 0 }),
	bytes: Type.Integer({ minimum: 0 }),
	evidenceReady: Type.Boolean(),
});
const RuntimeDisconnectedInputSchema = strictObject({ type: Type.Literal("runtime_disconnected") });
const RuntimeReconnectedInputSchema = strictObject({ type: Type.Literal("runtime_reconnected") });
const RuntimeFailedInputSchema = strictObject({
	type: Type.Literal("runtime_failed"),
	code: RuntimeHostFailureCodeSchema,
	resultAvailable: Type.Boolean(),
});
const RunCompletedInputSchema = strictObject({
	type: Type.Literal("run_completed"),
	resultReady: Type.Boolean(),
	evidenceReady: Type.Boolean(),
});
const RunPartialInputSchema = strictObject({
	type: Type.Literal("run_partial"),
	resultReady: Type.Boolean(),
	evidenceReady: Type.Boolean(),
	reason: RuntimeHostFailureCodeSchema,
});
const RunBlockedInputSchema = strictObject({ type: Type.Literal("run_blocked"), reason: RuntimeHostFailureCodeSchema });
const CancelRequestedInputSchema = strictObject({ type: Type.Literal("cancel_requested") });
const CancelledInputSchema = strictObject({ type: Type.Literal("cancelled") });

export const RuntimeHostInputSchema = Type.Union([
	PlanningStartedInputSchema,
	PlanReadyInputSchema,
	RuntimeMessageInputSchema,
	ClarificationRequiredInputSchema,
	ClarificationReceivedInputSchema,
	ToolCallRequestedInputSchema,
	ToolCallCompletedInputSchema,
	RuntimeDisconnectedInputSchema,
	RuntimeReconnectedInputSchema,
	RuntimeFailedInputSchema,
	RunCompletedInputSchema,
	RunPartialInputSchema,
	RunBlockedInputSchema,
	CancelRequestedInputSchema,
	CancelledInputSchema,
]);
export type RuntimeHostInput = Static<typeof RuntimeHostInputSchema>;

export type RuntimeHostEventType =
	| RuntimeHostInput["type"]
	| "run_created"
	| "budget_exhausted"
	| "invalid_runtime_event";

export type RuntimeHostEventDetails =
	| { readonly kind: "run_created"; readonly questionDigest: string }
	| { readonly kind: "planning_started" }
	| { readonly kind: "plan_ready"; readonly planDigest: string }
	| { readonly kind: "runtime_message"; readonly messageDigest: string }
	| { readonly kind: "clarification_required"; readonly questionDigest: string }
	| { readonly kind: "clarification_received" }
	| {
			readonly kind: "tool_call_requested";
			readonly callId: ResourceId;
			readonly toolName: ResourceId;
			readonly inputDigest: string;
	  }
	| {
			readonly kind: "tool_call_completed";
			readonly callId: ResourceId;
			readonly status: RuntimeHostToolCallStatus;
			readonly rows: number;
			readonly bytes: number;
			readonly evidenceReady: boolean;
	  }
	| { readonly kind: "runtime_disconnected" }
	| { readonly kind: "runtime_reconnected" }
	| { readonly kind: "runtime_failed"; readonly code: RuntimeHostFailureCode; readonly resultAvailable: boolean }
	| { readonly kind: "run_completed"; readonly resultReady: boolean; readonly evidenceReady: boolean }
	| {
			readonly kind: "run_partial";
			readonly resultReady: boolean;
			readonly evidenceReady: boolean;
			readonly reason: RuntimeHostFailureCode;
	  }
	| { readonly kind: "run_blocked"; readonly reason: RuntimeHostFailureCode }
	| { readonly kind: "cancel_requested" }
	| { readonly kind: "cancelled" }
	| { readonly kind: "budget_exhausted"; readonly dimension: "steps" | "rows" | "bytes" }
	| { readonly kind: "invalid_runtime_event"; readonly reason: RuntimeHostFailureCode };

export interface RuntimeHostEvent {
	readonly contractVersion: typeof RUNTIME_HOST_CONTRACT_VERSION;
	readonly eventId: ResourceId;
	readonly runId: ResourceId;
	readonly sequence: number;
	readonly occurredAt: string;
	readonly type: RuntimeHostEventType;
	readonly status: RuntimeHostStatus;
	readonly details: RuntimeHostEventDetails;
}

export interface RuntimeRunSnapshot {
	readonly contractVersion: typeof RUNTIME_HOST_CONTRACT_VERSION;
	readonly runId: ResourceId;
	readonly ownerId: ResourceId;
	readonly workspaceId: ResourceId;
	readonly questionDigest: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly status: RuntimeHostStatus;
	readonly budget: RuntimeHostBudget;
	readonly used: RuntimeHostBudgetUsage;
	readonly activeToolCallIds: readonly ResourceId[];
	readonly seenToolCallIds: readonly ResourceId[];
	readonly lastEventId: ResourceId;
	readonly eventCount: number;
	readonly planDigest?: string;
	readonly resumeStatus?: "planning" | "awaiting_clarification" | "executing";
	readonly terminalReason?: RuntimeHostFailureCode;
}

export interface RuntimeHostTransition {
	readonly accepted: boolean;
	readonly snapshot: RuntimeRunSnapshot;
	readonly event?: RuntimeHostEvent;
}

export interface RuntimeStateStore {
	createRun(snapshot: RuntimeRunSnapshot, event: RuntimeHostEvent): void;
	commit(snapshot: RuntimeRunSnapshot, event: RuntimeHostEvent): void;
	getRun(runId: ResourceId): RuntimeRunSnapshot | undefined;
	getEvents(runId: ResourceId): readonly RuntimeHostEvent[];
}

export class RuntimeHostError extends Error {
	readonly code: RuntimeHostErrorCode;

	constructor(code: RuntimeHostErrorCode, message: string = code) {
		super(message);
		this.name = "RuntimeHostError";
		this.code = code;
	}
}

export type RuntimeHostErrorCode =
	| "invalid_contract"
	| "run_exists"
	| "run_not_found"
	| "owner_mismatch"
	| "persistence_failed";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isTerminalStatus(status: RuntimeHostStatus): status is RuntimeHostTerminalStatus {
	return status === "complete" || status === "partial" || status === "blocked";
}

function cloneBudget(budget: RuntimeHostBudget): RuntimeHostBudget {
	return { maxSteps: budget.maxSteps, maxRows: budget.maxRows, maxBytes: budget.maxBytes };
}

function cloneUsage(used: RuntimeHostBudgetUsage): RuntimeHostBudgetUsage {
	return { steps: used.steps, rows: used.rows, bytes: used.bytes };
}

function cloneSnapshot(snapshot: RuntimeRunSnapshot): RuntimeRunSnapshot {
	return {
		contractVersion: snapshot.contractVersion,
		runId: snapshot.runId,
		ownerId: snapshot.ownerId,
		workspaceId: snapshot.workspaceId,
		questionDigest: snapshot.questionDigest,
		createdAt: snapshot.createdAt,
		updatedAt: snapshot.updatedAt,
		status: snapshot.status,
		budget: cloneBudget(snapshot.budget),
		used: cloneUsage(snapshot.used),
		activeToolCallIds: [...snapshot.activeToolCallIds],
		seenToolCallIds: [...snapshot.seenToolCallIds],
		lastEventId: snapshot.lastEventId,
		eventCount: snapshot.eventCount,
		...(snapshot.planDigest === undefined ? {} : { planDigest: snapshot.planDigest }),
		...(snapshot.resumeStatus === undefined ? {} : { resumeStatus: snapshot.resumeStatus }),
		...(snapshot.terminalReason === undefined ? {} : { terminalReason: snapshot.terminalReason }),
	};
}

function cloneEvent(event: RuntimeHostEvent): RuntimeHostEvent {
	return {
		contractVersion: event.contractVersion,
		eventId: event.eventId,
		runId: event.runId,
		sequence: event.sequence,
		occurredAt: event.occurredAt,
		type: event.type,
		status: event.status,
		details: { ...event.details },
	};
}

function digestText(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function isDigest(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function eventId(runId: ResourceId, sequence: number): ResourceId {
	return `${runId}:event:${sequence}`;
}

function normalizeStartRequest(value: unknown): RuntimeHostStartRequest {
	if (!isContract(RuntimeHostStartRequestSchema, value)) throw new RuntimeHostError("invalid_contract");
	return {
		runId: value.runId,
		ownerId: value.ownerId,
		workspaceId: value.workspaceId,
		question: value.question,
		budget: cloneBudget(value.budget),
	};
}

function normalizeInput(value: unknown): RuntimeHostInput {
	if (!isContract(RuntimeHostInputSchema, value)) throw new RuntimeHostError("invalid_contract");
	if (!isRecord(value)) throw new RuntimeHostError("invalid_contract");
	switch (value.type) {
		case "planning_started":
		case "clarification_received":
		case "runtime_disconnected":
		case "runtime_reconnected":
		case "cancel_requested":
		case "cancelled":
			return { type: value.type };
		case "plan_ready":
			if (!isDigest(value.planDigest)) throw new RuntimeHostError("invalid_contract");
			return { type: value.type, planDigest: value.planDigest };
		case "runtime_message":
			if (!isDigest(value.messageDigest)) throw new RuntimeHostError("invalid_contract");
			return { type: value.type, messageDigest: value.messageDigest };
		case "clarification_required":
			if (!isDigest(value.questionDigest)) throw new RuntimeHostError("invalid_contract");
			return { type: value.type, questionDigest: value.questionDigest };
		case "tool_call_requested":
			if (!isDigest(value.inputDigest)) throw new RuntimeHostError("invalid_contract");
			return {
				type: value.type,
				callId: value.callId,
				toolName: value.toolName,
				inputDigest: value.inputDigest,
			};
		case "tool_call_completed":
			return {
				type: value.type,
				callId: value.callId,
				status: value.status,
				rows: value.rows,
				bytes: value.bytes,
				evidenceReady: value.evidenceReady,
			};
		case "runtime_failed":
			return { type: value.type, code: value.code, resultAvailable: value.resultAvailable };
		case "run_completed":
			return { type: value.type, resultReady: value.resultReady, evidenceReady: value.evidenceReady };
		case "run_partial":
			return {
				type: value.type,
				resultReady: value.resultReady,
				evidenceReady: value.evidenceReady,
				reason: value.reason,
			};
		case "run_blocked":
			return { type: value.type, reason: value.reason };
	}
}

function dimensionForBudget(
	used: RuntimeHostBudgetUsage,
	budget: RuntimeHostBudget,
): "steps" | "rows" | "bytes" | undefined {
	if (used.steps > budget.maxSteps) return "steps";
	if (used.rows > budget.maxRows) return "rows";
	if (used.bytes > budget.maxBytes) return "bytes";
	return undefined;
}

function removeId(values: readonly ResourceId[], target: ResourceId): ResourceId[] {
	return values.filter((value) => value !== target);
}

function hasId(values: readonly ResourceId[], target: ResourceId): boolean {
	return values.includes(target);
}

function isResumableStatus(status: RuntimeHostStatus): status is "planning" | "awaiting_clarification" | "executing" {
	return status === "planning" || status === "awaiting_clarification" || status === "executing";
}

export class InMemoryRuntimeStateStore implements RuntimeStateStore {
	private readonly runs = new Map<ResourceId, RuntimeRunSnapshot>();
	private readonly events = new Map<ResourceId, RuntimeHostEvent[]>();

	createRun(snapshot: RuntimeRunSnapshot, event: RuntimeHostEvent): void {
		if (this.runs.has(snapshot.runId)) throw new RuntimeHostError("run_exists");
		this.runs.set(snapshot.runId, cloneSnapshot(snapshot));
		this.events.set(snapshot.runId, [cloneEvent(event)]);
	}

	commit(snapshot: RuntimeRunSnapshot, event: RuntimeHostEvent): void {
		if (!this.runs.has(snapshot.runId)) throw new RuntimeHostError("run_not_found");
		const events = this.events.get(snapshot.runId);
		if (
			events === undefined ||
			event.sequence !== events.length + 1 ||
			events.some((item) => item.eventId === event.eventId)
		) {
			throw new RuntimeHostError("persistence_failed");
		}
		this.runs.set(snapshot.runId, cloneSnapshot(snapshot));
		events.push(cloneEvent(event));
	}

	getRun(runId: ResourceId): RuntimeRunSnapshot | undefined {
		const snapshot = this.runs.get(runId);
		return snapshot === undefined ? undefined : cloneSnapshot(snapshot);
	}

	getEvents(runId: ResourceId): readonly RuntimeHostEvent[] {
		return (this.events.get(runId) ?? []).map(cloneEvent);
	}
}

export interface RuntimeHostOptions {
	readonly store?: RuntimeStateStore;
	readonly now?: () => string;
}

export class RuntimeHost {
	private readonly store: RuntimeStateStore;
	private readonly now: () => string;

	constructor(options: RuntimeHostOptions = {}) {
		this.store = options.store ?? new InMemoryRuntimeStateStore();
		this.now = options.now ?? (() => new Date().toISOString());
	}

	start(value: RuntimeHostStartRequest): RuntimeRunSnapshot {
		const request = normalizeStartRequest(value);
		if (this.store.getRun(request.runId) !== undefined) throw new RuntimeHostError("run_exists");
		const occurredAt = this.timestamp();
		const questionDigest = digestText(request.question);
		const firstEvent: RuntimeHostEvent = {
			contractVersion: RUNTIME_HOST_CONTRACT_VERSION,
			eventId: eventId(request.runId, 1),
			runId: request.runId,
			sequence: 1,
			occurredAt,
			type: "run_created",
			status: "queued",
			details: { kind: "run_created", questionDigest },
		};
		const snapshot: RuntimeRunSnapshot = {
			contractVersion: RUNTIME_HOST_CONTRACT_VERSION,
			runId: request.runId,
			ownerId: request.ownerId,
			workspaceId: request.workspaceId,
			questionDigest,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			status: "queued",
			budget: cloneBudget(request.budget),
			used: { steps: 0, rows: 0, bytes: 0 },
			activeToolCallIds: [],
			seenToolCallIds: [],
			lastEventId: firstEvent.eventId,
			eventCount: 1,
		};
		try {
			this.store.createRun(snapshot, firstEvent);
		} catch (error) {
			if (error instanceof RuntimeHostError && error.code === "run_exists") throw error;
			throw new RuntimeHostError("persistence_failed");
		}
		return cloneSnapshot(snapshot);
	}

	getRun(runId: ResourceId): RuntimeRunSnapshot {
		const snapshot = this.store.getRun(runId);
		if (snapshot === undefined) throw new RuntimeHostError("run_not_found");
		return snapshot;
	}

	getEvents(runId: ResourceId): readonly RuntimeHostEvent[] {
		this.getRun(runId);
		return this.store.getEvents(runId);
	}

	cancel(runId: ResourceId, ownerId: ResourceId): RuntimeRunSnapshot {
		const current = this.getRun(runId);
		if (current.ownerId !== ownerId) throw new RuntimeHostError("owner_mismatch");
		if (isTerminalStatus(current.status) || current.status === "cancelling") return current;
		return this.apply(runId, { type: "cancel_requested" }).snapshot;
	}

	apply(runId: ResourceId, value: unknown): RuntimeHostTransition {
		const current = this.getRun(runId);
		if (isTerminalStatus(current.status)) return { accepted: false, snapshot: current };
		let input: RuntimeHostInput;
		try {
			input = normalizeInput(value);
		} catch {
			return this.commitFailure(current, "invalid_runtime_event", "invalid_runtime_event", { accepted: false });
		}
		return this.reduce(current, input);
	}

	private timestamp(): string {
		const value = this.now();
		if (!isContract(DateTimeSchema, value) || !Number.isFinite(Date.parse(value))) {
			throw new RuntimeHostError("invalid_contract", "RuntimeHost clock returned an invalid timestamp");
		}
		return value;
	}

	private reduce(current: RuntimeRunSnapshot, input: RuntimeHostInput): RuntimeHostTransition {
		switch (input.type) {
			case "planning_started":
				return current.status === "queued"
					? this.commit(current, "planning_started", "planning", { kind: "planning_started" })
					: this.invalidTransition(current);
			case "plan_ready":
				return current.status === "planning"
					? this.commit(
							current,
							"plan_ready",
							"executing",
							{ kind: "plan_ready", planDigest: input.planDigest },
							{
								planDigest: input.planDigest,
							},
						)
					: this.invalidTransition(current);
			case "runtime_message":
				return isResumableStatus(current.status)
					? this.commit(current, "runtime_message", current.status, {
							kind: "runtime_message",
							messageDigest: input.messageDigest,
						})
					: this.invalidTransition(current);
			case "clarification_required":
				return (current.status === "planning" || current.status === "executing") &&
					current.activeToolCallIds.length === 0
					? this.commit(current, "clarification_required", "awaiting_clarification", {
							kind: "clarification_required",
							questionDigest: input.questionDigest,
						})
					: this.invalidTransition(current);
			case "clarification_received":
				return current.status === "awaiting_clarification"
					? this.commit(current, "clarification_received", "planning", { kind: "clarification_received" })
					: this.invalidTransition(current);
			case "tool_call_requested":
				return this.requestToolCall(current, input);
			case "tool_call_completed":
				return this.completeToolCall(current, input);
			case "runtime_disconnected":
				return isResumableStatus(current.status)
					? this.commit(
							current,
							"runtime_disconnected",
							"reconnecting",
							{ kind: "runtime_disconnected" },
							{
								resumeStatus: current.status,
							},
						)
					: this.invalidTransition(current);
			case "runtime_reconnected":
				return current.status === "reconnecting" && current.resumeStatus !== undefined
					? this.commit(
							current,
							"runtime_reconnected",
							current.resumeStatus,
							{ kind: "runtime_reconnected" },
							{
								clearResumeStatus: true,
							},
						)
					: this.invalidTransition(current);
			case "runtime_failed":
				return this.runtimeFailed(current, input);
			case "run_completed":
				return this.finishRun(current, input, "complete");
			case "run_partial":
				return this.finishRun(current, input, "partial");
			case "run_blocked":
				return this.commitFailure(current, input.reason, "run_blocked", { reason: input.reason });
			case "cancel_requested":
				return this.commit(current, "cancel_requested", "cancelling", { kind: "cancel_requested" });
			case "cancelled":
				return current.status === "cancelling"
					? this.commitFailure(current, "cancelled", "cancelled", {
							reason: "cancelled",
							clearActiveToolCalls: true,
						})
					: this.invalidTransition(current);
		}
	}

	private requestToolCall(
		current: RuntimeRunSnapshot,
		input: Extract<RuntimeHostInput, { readonly type: "tool_call_requested" }>,
	): RuntimeHostTransition {
		if (current.status !== "executing" || hasId(current.seenToolCallIds, input.callId))
			return this.invalidTransition(current);
		if (current.used.steps >= current.budget.maxSteps) return this.commitBudgetFailure(current, "steps");
		return this.commit(
			current,
			"tool_call_requested",
			"executing",
			{
				kind: "tool_call_requested",
				callId: input.callId,
				toolName: input.toolName,
				inputDigest: input.inputDigest,
			},
			{
				used: { ...current.used, steps: current.used.steps + 1 },
				activeToolCallIds: [...current.activeToolCallIds, input.callId].sort(compareStrings),
				seenToolCallIds: [...current.seenToolCallIds, input.callId].sort(compareStrings),
			},
		);
	}

	private completeToolCall(
		current: RuntimeRunSnapshot,
		input: Extract<RuntimeHostInput, { readonly type: "tool_call_completed" }>,
	): RuntimeHostTransition {
		if (current.status !== "executing" || !hasId(current.activeToolCallIds, input.callId))
			return this.invalidTransition(current);
		if ((input.status === "complete" || input.status === "partial") && !input.evidenceReady) {
			return this.commitFailure(current, "evidence_required", "tool_call_completed", {
				reason: "evidence_required",
				clearActiveToolCallId: input.callId,
				accepted: false,
			});
		}
		const used = {
			steps: current.used.steps,
			rows: current.used.rows + input.rows,
			bytes: current.used.bytes + input.bytes,
		};
		const exceeded = dimensionForBudget(used, current.budget);
		if (exceeded !== undefined) return this.commitBudgetFailure(current, exceeded);
		return this.commit(
			current,
			"tool_call_completed",
			"executing",
			{
				kind: "tool_call_completed",
				callId: input.callId,
				status: input.status,
				rows: input.rows,
				bytes: input.bytes,
				evidenceReady: input.evidenceReady,
			},
			{ used, activeToolCallIds: removeId(current.activeToolCallIds, input.callId) },
		);
	}

	private runtimeFailed(
		current: RuntimeRunSnapshot,
		input: Extract<RuntimeHostInput, { readonly type: "runtime_failed" }>,
	): RuntimeHostTransition {
		return this.commitFailure(current, input.code, "runtime_failed", {
			reason: input.code,
			clearActiveToolCalls: true,
			status: input.resultAvailable ? "partial" : "blocked",
		});
	}

	private finishRun(
		current: RuntimeRunSnapshot,
		input: Extract<RuntimeHostInput, { readonly type: "run_completed" | "run_partial" }>,
		status: "complete" | "partial",
	): RuntimeHostTransition {
		if (current.status !== "executing" || current.activeToolCallIds.length > 0)
			return this.invalidTransition(current);
		if (!input.resultReady)
			return this.commitFailure(current, "result_not_ready", "run_blocked", {
				reason: "result_not_ready",
				accepted: false,
			});
		if (!input.evidenceReady)
			return this.commitFailure(current, "evidence_required", "run_blocked", {
				reason: "evidence_required",
				accepted: false,
			});
		if (input.type === "run_completed") {
			return this.commit(current, "run_completed", status, {
				kind: "run_completed",
				resultReady: input.resultReady,
				evidenceReady: input.evidenceReady,
			});
		}
		return this.commit(
			current,
			"run_partial",
			status,
			{
				kind: "run_partial",
				resultReady: input.resultReady,
				evidenceReady: input.evidenceReady,
				reason: input.reason,
			},
			{ terminalReason: input.reason },
		);
	}

	private invalidTransition(current: RuntimeRunSnapshot): RuntimeHostTransition {
		return this.commitFailure(current, "invalid_transition", "invalid_runtime_event", {
			reason: "invalid_transition",
			accepted: false,
		});
	}

	private commitBudgetFailure(
		current: RuntimeRunSnapshot,
		dimension: "steps" | "rows" | "bytes",
	): RuntimeHostTransition {
		return this.commitFailure(current, "budget_exhausted", "budget_exhausted", {
			reason: "budget_exhausted",
			dimension,
			clearActiveToolCalls: true,
			accepted: false,
		});
	}

	private commitFailure(
		current: RuntimeRunSnapshot,
		reason: RuntimeHostFailureCode,
		type: RuntimeHostEventType,
		options: {
			readonly accepted?: boolean;
			readonly status?: RuntimeHostTerminalStatus;
			readonly clearActiveToolCalls?: boolean;
			readonly clearActiveToolCallId?: ResourceId;
			readonly dimension?: "steps" | "rows" | "bytes";
			readonly reason?: RuntimeHostFailureCode;
		} = {},
	): RuntimeHostTransition {
		const details: RuntimeHostEventDetails =
			type === "budget_exhausted"
				? { kind: "budget_exhausted", dimension: options.dimension ?? "steps" }
				: type === "run_blocked"
					? { kind: "run_blocked", reason: options.reason ?? reason }
					: type === "invalid_runtime_event"
						? { kind: "invalid_runtime_event", reason: options.reason ?? reason }
						: type === "cancelled"
							? { kind: "cancelled" }
							: type === "runtime_failed"
								? {
										kind: "runtime_failed",
										code: options.reason ?? reason,
										resultAvailable: options.status === "partial",
									}
								: type === "tool_call_completed"
									? {
											kind: "tool_call_completed",
											callId: options.clearActiveToolCallId ?? "invalid-call",
											status: "blocked",
											rows: 0,
											bytes: 0,
											evidenceReady: false,
										}
									: { kind: "run_blocked", reason };
		const transition = this.commit(current, type, options.status ?? "blocked", details, {
			activeToolCallIds:
				(options.clearActiveToolCalls ?? true) === true
					? []
					: options.clearActiveToolCallId === undefined
						? current.activeToolCallIds
						: removeId(current.activeToolCallIds, options.clearActiveToolCallId),
			terminalReason: reason,
		});
		return options.accepted === false ? { ...transition, accepted: false } : transition;
	}

	private commit(
		current: RuntimeRunSnapshot,
		type: RuntimeHostEventType,
		status: RuntimeHostStatus,
		details: RuntimeHostEventDetails,
		changes: {
			readonly used?: RuntimeHostBudgetUsage;
			readonly activeToolCallIds?: readonly ResourceId[];
			readonly seenToolCallIds?: readonly ResourceId[];
			readonly planDigest?: string;
			readonly resumeStatus?: "planning" | "awaiting_clarification" | "executing";
			readonly clearResumeStatus?: boolean;
			readonly terminalReason?: RuntimeHostFailureCode;
		} = {},
	): RuntimeHostTransition {
		const {
			planDigest: currentPlanDigest,
			resumeStatus: currentResumeStatus,
			terminalReason: currentTerminalReason,
			...currentWithoutOptionalFields
		} = current;
		const occurredAt = this.timestamp();
		const sequence = current.eventCount + 1;
		const event: RuntimeHostEvent = {
			contractVersion: RUNTIME_HOST_CONTRACT_VERSION,
			eventId: eventId(current.runId, sequence),
			runId: current.runId,
			sequence,
			occurredAt,
			type,
			status,
			details,
		};
		const snapshot: RuntimeRunSnapshot = {
			...currentWithoutOptionalFields,
			updatedAt: occurredAt,
			status,
			used: cloneUsage(changes.used ?? current.used),
			activeToolCallIds: [...(changes.activeToolCallIds ?? current.activeToolCallIds)].sort(compareStrings),
			seenToolCallIds: [...(changes.seenToolCallIds ?? current.seenToolCallIds)].sort(compareStrings),
			lastEventId: event.eventId,
			eventCount: sequence,
			...(changes.planDigest === undefined
				? currentPlanDigest === undefined
					? {}
					: { planDigest: currentPlanDigest }
				: { planDigest: changes.planDigest }),
			...(changes.clearResumeStatus === true
				? {}
				: changes.resumeStatus === undefined
					? currentResumeStatus === undefined
						? {}
						: { resumeStatus: currentResumeStatus }
					: { resumeStatus: changes.resumeStatus }),
			...(changes.terminalReason === undefined
				? currentTerminalReason === undefined
					? {}
					: { terminalReason: currentTerminalReason }
				: { terminalReason: changes.terminalReason }),
		};
		try {
			this.store.commit(snapshot, event);
		} catch {
			throw new RuntimeHostError("persistence_failed");
		}
		return { accepted: true, snapshot: cloneSnapshot(snapshot), event: cloneEvent(event) };
	}
}

export function digestRuntimeText(value: string): string {
	return digestText(value);
}
