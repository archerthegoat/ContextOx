import { isContract, type ResourceId, ResourceIdSchema } from "./contracts.ts";
import {
	digestRuntimeText,
	type RuntimeHost,
	type RuntimeHostFailureCode,
	type RuntimeHostInput,
	type RuntimeHostToolCallStatus,
	type RuntimeHostTransition,
	type RuntimeRunSnapshot,
} from "./runtime-host.ts";

export const PI_RUNTIME_ADAPTER_CONTRACT_VERSION = "pi-adapter.v1" as const;

export type PiRuntimeEventType =
	| "agent_start"
	| "agent_end"
	| "turn_start"
	| "turn_end"
	| "message_start"
	| "message_update"
	| "message_end"
	| "tool_execution_start"
	| "tool_execution_update"
	| "tool_execution_end";

export type PiRuntimeAdapterReason =
	| "invalid_pi_event"
	| "invalid_tool_call"
	| "runtime_unavailable"
	| "tool_result_not_forwarded"
	| "terminal_result_required"
	| "invalid_tool_result"
	| "runtime_failed"
	| "host_rejected"
	| "run_already_terminal";

export interface PiToolResultObservation {
	readonly callId: ResourceId;
	readonly toolName: ResourceId;
	readonly isError: boolean;
	readonly resultDigest: string;
}

export interface PiToolResultSummary {
	readonly status: RuntimeHostToolCallStatus;
	readonly rows: number;
	readonly bytes: number;
	readonly evidenceReady: boolean;
}

export interface PiRuntimeAdapterOptions {
	readonly host: RuntimeHost;
	readonly runId: ResourceId;
	readonly normalizeToolResult?: (observation: PiToolResultObservation) => PiToolResultSummary | undefined;
	readonly onListenerError?: (error: unknown) => void;
}

export type PiRuntimeAdapterDisposition = "applied" | "ignored" | "blocked";

export interface PiRuntimeAdapterResult {
	readonly contractVersion: typeof PI_RUNTIME_ADAPTER_CONTRACT_VERSION;
	readonly runId: ResourceId;
	readonly sourceType: PiRuntimeEventType | "unknown";
	readonly disposition: PiRuntimeAdapterDisposition;
	readonly snapshot: RuntimeRunSnapshot;
	readonly transition?: RuntimeHostTransition;
	readonly reason?: PiRuntimeAdapterReason;
}

export interface PiRuntimeAdapterAttachment {
	readonly attached: boolean;
	readonly detach: () => void;
	readonly failure?: PiRuntimeAdapterResult;
}

type PiRuntimeAdapterListener = (result: PiRuntimeAdapterResult) => void;
type PiRuntimeEventListener = (event: unknown, signal: AbortSignal) => void;
type PiRuntimeEventSource = {
	subscribe: (listener: PiRuntimeEventListener) => unknown;
};

const PI_RUNTIME_EVENT_TYPES = new Set<PiRuntimeEventType>([
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isEventSource(value: unknown): value is PiRuntimeEventSource {
	return isRecord(value) && typeof value.subscribe === "function";
}

function readEventType(value: unknown): PiRuntimeEventType | "unknown" {
	if (
		!isRecord(value) ||
		typeof value.type !== "string" ||
		!PI_RUNTIME_EVENT_TYPES.has(value.type as PiRuntimeEventType)
	) {
		return "unknown";
	}
	return value.type as PiRuntimeEventType;
}

function readResourceId(value: unknown): ResourceId | undefined {
	return isContract(ResourceIdSchema, value) ? value : undefined;
}

function allowedMessageRole(value: unknown): "user" | "assistant" | "toolResult" | "other" {
	if (value === "user" || value === "assistant" || value === "toolResult") return value;
	return "other";
}

function allowedContentKind(value: unknown): "text" | "thinking" | "toolCall" | "toolResult" | "image" | "other" {
	if (
		value === "text" ||
		value === "thinking" ||
		value === "toolCall" ||
		value === "toolResult" ||
		value === "image"
	) {
		return value;
	}
	return "other";
}

function allowedStopReason(value: unknown): "stop" | "length" | "toolUse" | "error" | "aborted" | "other" {
	if (value === "stop" || value === "length" || value === "toolUse" || value === "error" || value === "aborted") {
		return value;
	}
	return "other";
}

function shapeOf(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return `array:${value.length}`;
	switch (typeof value) {
		case "undefined":
			return "undefined";
		case "string":
			return `string:${value.length}`;
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "bigint":
			return "bigint";
		case "function":
			return "function";
		case "symbol":
			return "symbol";
		default:
			return "object";
	}
}

interface SafeMessageMetadata {
	readonly digest: string;
	readonly failed: boolean;
}

function readMessageMetadata(value: unknown, sourceType: PiRuntimeEventType): SafeMessageMetadata | undefined {
	if (!isRecord(value)) return undefined;
	const contentKinds = Array.isArray(value.content)
		? value.content.map((part) => (isRecord(part) ? allowedContentKind(part.type) : "other"))
		: typeof value.content === "string"
			? ["text"]
			: [];
	const stopReason = allowedStopReason(value.stopReason);
	const failed = stopReason === "error" || stopReason === "aborted" || typeof value.errorMessage === "string";
	const digest = digestRuntimeText(
		JSON.stringify({
			event: sourceType,
			role: allowedMessageRole(value.role),
			contentKinds,
			contentShape: shapeOf(value.content),
			stopReason,
			hasErrorMessage: typeof value.errorMessage === "string",
		}),
	);
	return { digest, failed };
}

function readToolCallIdentity(
	value: Record<string, unknown>,
): { readonly callId: ResourceId; readonly toolName: ResourceId } | undefined {
	const callId = readResourceId(value.toolCallId);
	const toolName = readResourceId(value.toolName);
	return callId === undefined || toolName === undefined ? undefined : { callId, toolName };
}

function isToolResultSummary(value: unknown): value is PiToolResultSummary {
	if (!isRecord(value)) return false;
	if (value.status !== "complete" && value.status !== "partial" && value.status !== "blocked") return false;
	if (
		typeof value.rows !== "number" ||
		!Number.isInteger(value.rows) ||
		value.rows < 0 ||
		typeof value.bytes !== "number" ||
		!Number.isInteger(value.bytes) ||
		value.bytes < 0 ||
		typeof value.evidenceReady !== "boolean"
	) {
		return false;
	}
	return (value.status !== "complete" && value.status !== "partial") || value.evidenceReady;
}

function createDigest(sourceType: PiRuntimeEventType, metadata: Record<string, unknown>): string {
	return digestRuntimeText(JSON.stringify({ event: sourceType, ...metadata }));
}

export class PiRuntimeAdapter {
	private readonly host: RuntimeHost;
	private readonly runId: ResourceId;
	private readonly normalizeToolResult: PiRuntimeAdapterOptions["normalizeToolResult"];
	private readonly onListenerError: PiRuntimeAdapterOptions["onListenerError"];
	private readonly listeners = new Set<PiRuntimeAdapterListener>();
	private sourceDetach: (() => void) | undefined;
	private _lastResult: PiRuntimeAdapterResult | undefined;

	constructor(options: PiRuntimeAdapterOptions) {
		this.host = options.host;
		this.runId = options.runId;
		this.normalizeToolResult = options.normalizeToolResult;
		this.onListenerError = options.onListenerError;
		this.host.getRun(this.runId);
	}

	get lastResult(): PiRuntimeAdapterResult | undefined {
		return this._lastResult;
	}

	subscribe(listener: PiRuntimeAdapterListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	ingest(event: unknown): PiRuntimeAdapterResult {
		const sourceType = readEventType(event);
		const result = this.reduce(sourceType, event);
		this._lastResult = result;
		this.publish(result);
		return result;
	}

	attach(source: unknown): PiRuntimeAdapterAttachment {
		this.detach();
		if (!isEventSource(source)) {
			const failure = this.finishFailure("unknown", "runtime_unavailable", "runtime_unavailable");
			this._lastResult = failure;
			this.publish(failure);
			return { attached: false, detach: () => {}, failure };
		}

		try {
			const unsubscribe = source.subscribe((event) => {
				this.ingest(event);
			});
			if (typeof unsubscribe !== "function") {
				const failure = this.finishFailure("unknown", "runtime_unavailable", "runtime_unavailable");
				this._lastResult = failure;
				this.publish(failure);
				return { attached: false, detach: () => {}, failure };
			}

			let detached = false;
			const detach = () => {
				if (detached) return;
				detached = true;
				if (this.sourceDetach === detach) this.sourceDetach = undefined;
				try {
					unsubscribe();
				} catch (error) {
					this.reportListenerError(error);
				}
			};
			this.sourceDetach = detach;
			return { attached: true, detach };
		} catch {
			const failure = this.finishFailure("unknown", "runtime_unavailable", "runtime_unavailable");
			this._lastResult = failure;
			this.publish(failure);
			return { attached: false, detach: () => {}, failure };
		}
	}

	detach(): void {
		const detach = this.sourceDetach;
		this.sourceDetach = undefined;
		if (detach !== undefined) detach();
	}

	private reduce(sourceType: PiRuntimeEventType | "unknown", event: unknown): PiRuntimeAdapterResult {
		if (sourceType === "unknown" || !isRecord(event)) {
			return this.finishFailure(sourceType, "invalid_runtime_event", "invalid_pi_event");
		}

		switch (sourceType) {
			case "agent_start":
				return this.apply(sourceType, { type: "planning_started" });
			case "agent_end":
				return Array.isArray(event.messages)
					? this.ignored(sourceType, "terminal_result_required")
					: this.finishFailure(sourceType, "invalid_runtime_event", "invalid_pi_event");
			case "turn_start":
				return this.applyRuntimeMessage(sourceType, createDigest(sourceType, { phase: "start" }));
			case "turn_end": {
				const message = readMessageMetadata(event.message, sourceType);
				if (message === undefined || !Array.isArray(event.toolResults)) {
					return this.finishFailure(sourceType, "invalid_runtime_event", "invalid_pi_event");
				}
				return message.failed
					? this.applyRuntimeFailure(sourceType)
					: this.applyRuntimeMessage(
							sourceType,
							createDigest(sourceType, {
								messageDigest: message.digest,
								toolResultCount: event.toolResults.length,
							}),
						);
			}
			case "message_start":
			case "message_update":
			case "message_end": {
				const message = readMessageMetadata(event.message, sourceType);
				if (message === undefined)
					return this.finishFailure(sourceType, "invalid_runtime_event", "invalid_pi_event");
				return message.failed
					? this.applyRuntimeFailure(sourceType)
					: this.applyRuntimeMessage(sourceType, message.digest);
			}
			case "tool_execution_start": {
				const identity = readToolCallIdentity(event);
				if (identity === undefined)
					return this.finishFailure(sourceType, "unsafe_tool_request", "invalid_tool_call");
				return this.apply(sourceType, {
					type: "tool_call_requested",
					callId: identity.callId,
					toolName: identity.toolName,
					inputDigest: digestRuntimeText(
						JSON.stringify({
							callId: identity.callId,
							toolName: identity.toolName,
							argumentsShape: shapeOf(event.args),
						}),
					),
				});
			}
			case "tool_execution_update":
				return readToolCallIdentity(event) === undefined
					? this.finishFailure(sourceType, "unsafe_tool_request", "invalid_tool_call")
					: this.ignored(sourceType, "tool_result_not_forwarded");
			case "tool_execution_end":
				return this.reduceToolExecutionEnd(sourceType, event);
		}
	}

	private reduceToolExecutionEnd(
		sourceType: "tool_execution_end",
		event: Record<string, unknown>,
	): PiRuntimeAdapterResult {
		const identity = readToolCallIdentity(event);
		if (identity === undefined || typeof event.isError !== "boolean" || !("result" in event)) {
			return this.finishFailure(sourceType, "invalid_runtime_event", "invalid_pi_event");
		}

		const observation: PiToolResultObservation = {
			callId: identity.callId,
			toolName: identity.toolName,
			isError: event.isError,
			resultDigest: digestRuntimeText(
				JSON.stringify({
					toolName: identity.toolName,
					isError: event.isError,
					resultShape: shapeOf(event.result),
				}),
			),
		};

		if (observation.isError) {
			return this.apply(sourceType, {
				type: "tool_call_completed",
				callId: observation.callId,
				status: "blocked",
				rows: 0,
				bytes: 0,
				evidenceReady: false,
			});
		}

		let summary: PiToolResultSummary | undefined;
		try {
			const candidate = this.normalizeToolResult?.(observation);
			if (isToolResultSummary(candidate)) summary = candidate;
		} catch {
			summary = undefined;
		}
		if (summary === undefined)
			return this.finishFailure(sourceType, "evidence_required", "tool_result_not_forwarded");

		return this.apply(sourceType, {
			type: "tool_call_completed",
			callId: observation.callId,
			status: summary.status,
			rows: summary.rows,
			bytes: summary.bytes,
			evidenceReady: summary.evidenceReady,
		});
	}

	private applyRuntimeMessage(sourceType: PiRuntimeEventType, messageDigest: string): PiRuntimeAdapterResult {
		return this.apply(sourceType, { type: "runtime_message", messageDigest });
	}

	private applyRuntimeFailure(sourceType: PiRuntimeEventType): PiRuntimeAdapterResult {
		return this.apply(
			sourceType,
			{ type: "runtime_failed", code: "runtime_failed", resultAvailable: false },
			{ disposition: "blocked", reason: "runtime_failed" },
		);
	}

	private apply(
		sourceType: PiRuntimeEventType,
		input: RuntimeHostInput,
		options: { readonly disposition?: PiRuntimeAdapterDisposition; readonly reason?: PiRuntimeAdapterReason } = {},
	): PiRuntimeAdapterResult {
		const transition = this.host.apply(this.runId, input);
		if (!transition.accepted && transition.event === undefined) {
			return this.createResult(sourceType, "ignored", transition, "run_already_terminal");
		}
		if (!transition.accepted) return this.createResult(sourceType, "blocked", transition, "host_rejected");
		return this.createResult(sourceType, options.disposition ?? "applied", transition, options.reason);
	}

	private finishFailure(
		sourceType: PiRuntimeEventType | "unknown",
		hostReason: RuntimeHostFailureCode,
		reason: PiRuntimeAdapterReason,
	): PiRuntimeAdapterResult {
		const transition = this.host.apply(this.runId, { type: "run_blocked", reason: hostReason });
		if (!transition.accepted && transition.event === undefined) {
			return this.createResult(sourceType, "ignored", transition, "run_already_terminal");
		}
		return this.createResult(sourceType, "blocked", transition, reason);
	}

	private ignored(sourceType: PiRuntimeEventType, reason: PiRuntimeAdapterReason): PiRuntimeAdapterResult {
		return this.createResult(
			sourceType,
			"ignored",
			{ accepted: false, snapshot: this.host.getRun(this.runId) },
			reason,
		);
	}

	private createResult(
		sourceType: PiRuntimeEventType | "unknown",
		disposition: PiRuntimeAdapterDisposition,
		transition: RuntimeHostTransition,
		reason?: PiRuntimeAdapterReason,
	): PiRuntimeAdapterResult {
		return {
			contractVersion: PI_RUNTIME_ADAPTER_CONTRACT_VERSION,
			runId: this.runId,
			sourceType,
			disposition,
			snapshot: transition.snapshot,
			...(transition.event === undefined ? {} : { transition }),
			...(reason === undefined ? {} : { reason }),
		};
	}

	private publish(result: PiRuntimeAdapterResult): void {
		for (const listener of this.listeners) {
			try {
				listener(result);
			} catch (error) {
				this.reportListenerError(error);
			}
		}
	}

	private reportListenerError(error: unknown): void {
		try {
			this.onListenerError?.(error);
		} catch {
			// Observability callbacks cannot change the Host state transition.
		}
	}
}
