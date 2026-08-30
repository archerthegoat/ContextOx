import { createHash } from "node:crypto";
import Type, { type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { DateTimeSchema, FreshnessStatusSchema, isContract, ResourceIdSchema, VersionIdSchema } from "./contracts.ts";

export const TRACE_CONTRACT_VERSION = "trace.v1" as const;

const strictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

const schemaOptions = (id: string) => ({
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://alphaox.dev/schemas/${id}`,
});

const DigestSchema = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });

const TraceCategorySchema = Type.Union([
	Type.Literal("session"),
	Type.Literal("context_pack"),
	Type.Literal("analysis_plan"),
	Type.Literal("tool"),
	Type.Literal("result"),
	Type.Literal("evidence"),
	Type.Literal("runtime"),
]);
export type TraceCategory = Static<typeof TraceCategorySchema>;

const TraceStatusSchema = Type.Union([
	Type.Literal("started"),
	Type.Literal("available"),
	Type.Literal("complete"),
	Type.Literal("partial"),
	Type.Literal("blocked"),
	Type.Literal("revoked"),
	Type.Literal("cancelled"),
]);
export type TraceStatus = Static<typeof TraceStatusSchema>;

export const TraceReasonSchema = Type.Union([
	Type.Literal("invalid_context"),
	Type.Literal("owner_mismatch"),
	Type.Literal("workspace_mismatch"),
	Type.Literal("version_mismatch"),
	Type.Literal("context_revoked"),
	Type.Literal("freshness_expired"),
	Type.Literal("freshness_not_allowed"),
	Type.Literal("permission_denied"),
	Type.Literal("source_unavailable"),
	Type.Literal("invalid_tool_input"),
	Type.Literal("executor_failed"),
	Type.Literal("evidence_failed"),
	Type.Literal("trace_anomaly"),
	Type.Literal("store_failed"),
	Type.Literal("cancelled"),
	Type.Literal("deadline_exceeded"),
	Type.Literal("budget_exceeded"),
]);
export type TraceReason = Static<typeof TraceReasonSchema>;

export const TraceDetailsSchema = strictObject({
	category: TraceCategorySchema,
	resourceId: Type.Optional(ResourceIdSchema),
	version: Type.Optional(VersionIdSchema),
	digest: Type.Optional(DigestSchema),
	status: Type.Optional(TraceStatusSchema),
	reason: Type.Optional(TraceReasonSchema),
	freshness: Type.Optional(FreshnessStatusSchema),
	rows: Type.Optional(Type.Integer({ minimum: 0 })),
	bytes: Type.Optional(Type.Integer({ minimum: 0 })),
	attempt: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type TraceDetails = Static<typeof TraceDetailsSchema>;

export const TraceEventTypeSchema = Type.Union([
	Type.Literal("session_created"),
	Type.Literal("session_replaced"),
	Type.Literal("context_resolved"),
	Type.Literal("plan_attached"),
	Type.Literal("tool_started"),
	Type.Literal("tool_completed"),
	Type.Literal("tool_blocked"),
	Type.Literal("result_recorded"),
	Type.Literal("evidence_recorded"),
	Type.Literal("runtime_transition"),
	Type.Literal("warning"),
	Type.Literal("failure"),
]);
export type TraceEventType = Static<typeof TraceEventTypeSchema>;

export const TraceEventSchema = Type.Object(
	{
		contractVersion: Type.Literal(TRACE_CONTRACT_VERSION),
		kind: Type.Literal("trace_event"),
		eventId: ResourceIdSchema,
		traceId: ResourceIdSchema,
		runId: ResourceIdSchema,
		ownerId: ResourceIdSchema,
		workspaceId: ResourceIdSchema,
		sequence: Type.Integer({ minimum: 1 }),
		occurredAt: DateTimeSchema,
		type: TraceEventTypeSchema,
		details: TraceDetailsSchema,
	},
	{ additionalProperties: false, ...schemaOptions("trace-event.schema.json") },
);
export type TraceEvent = Static<typeof TraceEventSchema>;

export const TraceAppendInputSchema = strictObject({
	traceId: ResourceIdSchema,
	runId: ResourceIdSchema,
	ownerId: ResourceIdSchema,
	workspaceId: ResourceIdSchema,
	occurredAt: DateTimeSchema,
	type: TraceEventTypeSchema,
	details: TraceDetailsSchema,
});
export type TraceAppendInput = Static<typeof TraceAppendInputSchema>;

export type TraceErrorCode =
	| "invalid_trace"
	| "invalid_scope"
	| "invalid_time"
	| "not_found"
	| "owner_mismatch"
	| "workspace_mismatch"
	| "run_mismatch"
	| "trace_conflict"
	| "sequence_conflict"
	| "store_failed";

export class TraceError extends Error {
	readonly code: TraceErrorCode;

	constructor(code: TraceErrorCode, message: string = code) {
		super(message);
		this.name = "TraceError";
		this.code = code;
	}
}

export interface TraceLookup {
	readonly traceId: string;
	readonly runId: string;
	readonly ownerId: string;
	readonly workspaceId: string;
}

export interface TraceStoreOptions {
	readonly failAfterWrites?: number;
	readonly maxEvents?: number;
}

export interface TraceStore {
	append(value: unknown): TraceEvent;
	getEvents(request: TraceLookup): readonly TraceEvent[];
}

function assertSchema<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	message: string,
): Static<TSchemaType> {
	if (!Check(schema, value)) throw new TraceError("invalid_trace", message);
	return value as Static<TSchemaType>;
}

function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function cloneDetails(value: TraceDetails): TraceDetails {
	return {
		category: value.category,
		...(value.resourceId === undefined ? {} : { resourceId: value.resourceId }),
		...(value.version === undefined ? {} : { version: value.version }),
		...(value.digest === undefined ? {} : { digest: value.digest }),
		...(value.status === undefined ? {} : { status: value.status }),
		...(value.reason === undefined ? {} : { reason: value.reason }),
		...(value.freshness === undefined ? {} : { freshness: value.freshness }),
		...(value.rows === undefined ? {} : { rows: value.rows }),
		...(value.bytes === undefined ? {} : { bytes: value.bytes }),
		...(value.attempt === undefined ? {} : { attempt: value.attempt }),
	};
}

function cloneEvent(value: TraceEvent): TraceEvent {
	return {
		contractVersion: value.contractVersion,
		kind: "trace_event",
		eventId: value.eventId,
		traceId: value.traceId,
		runId: value.runId,
		ownerId: value.ownerId,
		workspaceId: value.workspaceId,
		sequence: value.sequence,
		occurredAt: value.occurredAt,
		type: value.type,
		details: cloneDetails(value.details),
	};
}

function normalizeDateTime(value: string): string {
	if (!isContract(DateTimeSchema, value) || !Number.isFinite(Date.parse(value))) {
		throw new TraceError("invalid_time", "Invalid Trace event time");
	}
	return value;
}

function normalizeTraceDetails(value: TraceDetails): TraceDetails {
	return cloneDetails(value);
}

export function normalizeTraceAppendInput(value: unknown): TraceAppendInput {
	const parsed = assertSchema(TraceAppendInputSchema, value, "Invalid Trace append contract");
	return {
		traceId: parsed.traceId,
		runId: parsed.runId,
		ownerId: parsed.ownerId,
		workspaceId: parsed.workspaceId,
		occurredAt: normalizeDateTime(parsed.occurredAt),
		type: parsed.type,
		details: normalizeTraceDetails(parsed.details),
	};
}

export function normalizeTraceEvent(value: unknown): TraceEvent {
	const parsed = assertSchema(TraceEventSchema, value, "Invalid Trace event contract");
	const occurredAt = normalizeDateTime(parsed.occurredAt);
	if (!Number.isSafeInteger(parsed.sequence) || parsed.sequence < 1) {
		throw new TraceError("sequence_conflict", "Invalid Trace event sequence");
	}
	const expectedEventId = eventIdentity(
		{
			traceId: parsed.traceId,
			runId: parsed.runId,
			ownerId: parsed.ownerId,
			workspaceId: parsed.workspaceId,
			occurredAt,
			type: parsed.type,
			details: parsed.details,
		},
		parsed.sequence,
	);
	if (parsed.eventId !== expectedEventId) {
		throw new TraceError("sequence_conflict", "Trace event identity mismatch");
	}
	return {
		contractVersion: TRACE_CONTRACT_VERSION,
		kind: "trace_event",
		eventId: parsed.eventId,
		traceId: parsed.traceId,
		runId: parsed.runId,
		ownerId: parsed.ownerId,
		workspaceId: parsed.workspaceId,
		sequence: parsed.sequence,
		occurredAt,
		type: parsed.type,
		details: normalizeTraceDetails(parsed.details),
	};
}

function normalizeLookup(value: TraceLookup): TraceLookup {
	if (
		!isContract(ResourceIdSchema, value.traceId) ||
		!isContract(ResourceIdSchema, value.runId) ||
		!isContract(ResourceIdSchema, value.ownerId) ||
		!isContract(ResourceIdSchema, value.workspaceId)
	) {
		throw new TraceError("invalid_scope", "Invalid Trace lookup scope");
	}
	return {
		traceId: value.traceId,
		runId: value.runId,
		ownerId: value.ownerId,
		workspaceId: value.workspaceId,
	};
}

function eventIdentity(input: TraceAppendInput, sequence: number): string {
	return digest({
		traceId: input.traceId,
		runId: input.runId,
		ownerId: input.ownerId,
		workspaceId: input.workspaceId,
		sequence,
		occurredAt: input.occurredAt,
		type: input.type,
		details: input.details,
	});
}

function appendIdentity(input: TraceAppendInput): string {
	return digest(input);
}

function eventAppendIdentity(event: TraceEvent): string {
	return appendIdentity({
		traceId: event.traceId,
		runId: event.runId,
		ownerId: event.ownerId,
		workspaceId: event.workspaceId,
		occurredAt: event.occurredAt,
		type: event.type,
		details: event.details,
	});
}

export class InMemoryTraceStore implements TraceStore {
	private readonly traces = new Map<string, TraceEvent[]>();

	private readonly failAfterWrites: number | undefined;

	private readonly maxEvents: number;

	private writeAttempts = 0;

	constructor(options: TraceStoreOptions = {}) {
		if (
			options.failAfterWrites !== undefined &&
			(!Number.isSafeInteger(options.failAfterWrites) || options.failAfterWrites < 0)
		) {
			throw new TraceError("invalid_scope", "Invalid Trace store failure configuration");
		}
		if (options.maxEvents !== undefined && (!Number.isSafeInteger(options.maxEvents) || options.maxEvents < 1)) {
			throw new TraceError("invalid_scope", "Invalid Trace store event limit");
		}
		this.failAfterWrites = options.failAfterWrites;
		this.maxEvents = options.maxEvents ?? 10_000;
	}

	get attemptedWrites(): number {
		return this.writeAttempts;
	}

	append(value: unknown): TraceEvent {
		const input = normalizeTraceAppendInput(value);
		const events = this.traces.get(input.traceId) ?? [];
		const first = events[0];
		if (first !== undefined) {
			if (first.runId !== input.runId) throw new TraceError("run_mismatch", "Trace run mismatch");
			if (first.ownerId !== input.ownerId) throw new TraceError("owner_mismatch", "Trace owner mismatch");
			if (first.workspaceId !== input.workspaceId)
				throw new TraceError("workspace_mismatch", "Trace workspace mismatch");
		}
		const duplicate = events.find((event) => eventAppendIdentity(event) === appendIdentity(input));
		if (duplicate !== undefined) return cloneEvent(duplicate);
		if (events.length >= this.maxEvents) throw new TraceError("store_failed", "Trace event limit reached");
		if (this.failAfterWrites !== undefined && this.writeAttempts >= this.failAfterWrites) {
			throw new TraceError("store_failed", "Trace store write failed");
		}
		const sequence = events.length + 1;
		const event: TraceEvent = {
			contractVersion: TRACE_CONTRACT_VERSION,
			kind: "trace_event",
			eventId: eventIdentity(input, sequence),
			traceId: input.traceId,
			runId: input.runId,
			ownerId: input.ownerId,
			workspaceId: input.workspaceId,
			sequence,
			occurredAt: input.occurredAt,
			type: input.type,
			details: cloneDetails(input.details),
		};
		const normalized = normalizeTraceEvent(event);
		this.writeAttempts += 1;
		events.push(normalized);
		this.traces.set(input.traceId, events);
		return cloneEvent(normalized);
	}

	getEvents(request: TraceLookup): readonly TraceEvent[] {
		const scope = normalizeLookup(request);
		const events = this.traces.get(scope.traceId);
		if (events === undefined) throw new TraceError("not_found", "Trace not found");
		const first = events[0];
		if (first === undefined) throw new TraceError("not_found", "Trace not found");
		if (first.runId !== scope.runId) throw new TraceError("run_mismatch", "Trace run mismatch");
		if (first.ownerId !== scope.ownerId) throw new TraceError("owner_mismatch", "Trace owner mismatch");
		if (first.workspaceId !== scope.workspaceId)
			throw new TraceError("workspace_mismatch", "Trace workspace mismatch");
		return events
			.slice()
			.sort((left, right) => left.sequence - right.sequence)
			.map(cloneEvent);
	}
}
