import { Buffer } from "node:buffer";
import type { Static, TSchema } from "typebox";
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
import { digestRuntimeText } from "./runtime-host.ts";

export const CONTROLLED_TOOL_REGISTRY_CONTRACT_VERSION = "tool-registry.v1" as const;

export type ControlledToolFailureCode =
	| "invalid_invocation"
	| "tool_not_registered"
	| "tool_version_mismatch"
	| "tool_not_read_only"
	| "invalid_tool_input"
	| "unsafe_tool_request"
	| "source_type_not_allowed"
	| "authorization_denied"
	| "authorization_unknown"
	| "budget_exceeded"
	| "cancelled"
	| "timeout_exceeded"
	| "duplicate_invocation"
	| "executor_failed"
	| "invalid_tool_result"
	| "evidence_required";

export type ControlledToolRegistryErrorCode = "invalid_definition" | "duplicate_tool" | "invalid_registry_clock";

export type ControlledToolAuthorizationDecision = "allow" | "deny" | "unknown";
export type ControlledToolInvocationStatus = "complete" | "partial" | "blocked";

export interface ControlledToolBudget {
	readonly maxSteps: number;
	readonly maxRows: number;
	readonly maxBytes: number;
}

export interface ControlledToolExecutionContext {
	readonly invocationId: ResourceId;
	readonly runId: ResourceId;
	readonly ownerId: ResourceId;
	readonly workspaceId: ResourceId;
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly sourceType: SourceType;
	readonly policyCategory: ResourceId;
	readonly inputDigest: string;
	readonly remaining: ControlledToolBudget;
	readonly signal: AbortSignal;
}

export interface ControlledToolExecution<TOutput> {
	readonly status: "complete" | "partial";
	readonly output: TOutput;
	readonly evidenceReady: boolean;
}

export interface ControlledToolAuthorizationRequest {
	readonly invocationId: ResourceId;
	readonly runId: ResourceId;
	readonly ownerId: ResourceId;
	readonly workspaceId: ResourceId;
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly sourceType: SourceType;
	readonly policyCategory: ResourceId;
	readonly inputDigest: string;
	readonly remaining: ControlledToolBudget;
	readonly signal: AbortSignal;
}

export interface ControlledDataToolDefinition<TInput extends TSchema, TOutput extends TSchema> {
	readonly kind: "controlled_data_tool";
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly label: string;
	readonly description: string;
	readonly capability: string;
	readonly readOnly: true;
	readonly sourceTypes: readonly SourceType[];
	readonly inputSchema: TInput;
	readonly outputSchema: TOutput;
	readonly policyCategory: ResourceId;
	readonly timeoutMs: number;
	readonly maxRows: number;
	readonly maxBytes: number;
	readonly requiresEvidence: true;
	readonly execute: (
		input: Static<TInput>,
		context: ControlledToolExecutionContext,
	) => Promise<ControlledToolExecution<Static<TOutput>>>;
	readonly rowCount: (output: Static<TOutput>) => number;
}

export interface ControlledToolDescriptor {
	readonly kind: "controlled_data_tool";
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly label: string;
	readonly description: string;
	readonly capability: string;
	readonly readOnly: true;
	readonly sourceTypes: readonly SourceType[];
	readonly inputSchema: TSchema;
	readonly outputSchema: TSchema;
	readonly policyCategory: ResourceId;
	readonly timeoutMs: number;
	readonly maxRows: number;
	readonly maxBytes: number;
	readonly requiresEvidence: true;
}

export interface ControlledToolInvocationRequest {
	readonly invocationId: ResourceId;
	readonly runId: ResourceId;
	readonly ownerId: ResourceId;
	readonly workspaceId: ResourceId;
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly sourceType: SourceType;
	readonly input: unknown;
	readonly remaining: ControlledToolBudget;
	readonly signal?: AbortSignal;
}

export interface ControlledToolLifecycleEvent {
	readonly contractVersion: typeof CONTROLLED_TOOL_REGISTRY_CONTRACT_VERSION;
	readonly eventId: ResourceId;
	readonly invocationId: ResourceId;
	readonly runId: ResourceId;
	readonly sequence: number;
	readonly occurredAt: string;
	readonly type: "invocation_started" | "invocation_completed" | "invocation_partial" | "invocation_blocked";
	readonly status: "invoking" | "complete" | "partial" | "blocked";
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly sourceType: SourceType;
	readonly rows?: number;
	readonly bytes?: number;
	readonly reason?: ControlledToolFailureCode;
}

interface ControlledToolInvocationBase {
	readonly contractVersion: typeof CONTROLLED_TOOL_REGISTRY_CONTRACT_VERSION;
	readonly invocationId: ResourceId;
	readonly runId: ResourceId;
	readonly toolId: ResourceId;
	readonly version: VersionId;
	readonly sourceType: SourceType;
	readonly event: ControlledToolLifecycleEvent;
}

export type ControlledToolInvocationResult<TOutput> =
	| (ControlledToolInvocationBase & {
			readonly status: "complete" | "partial";
			readonly output: TOutput;
			readonly rows: number;
			readonly bytes: number;
			readonly evidenceReady: true;
	  })
	| (ControlledToolInvocationBase & {
			readonly status: "blocked";
			readonly reason: ControlledToolFailureCode;
	  });

export interface ControlledToolRegistryOptions {
	readonly authorize: (request: ControlledToolAuthorizationRequest) => Promise<ControlledToolAuthorizationDecision>;
	readonly now?: () => string;
	readonly onEvent?: (event: ControlledToolLifecycleEvent) => void;
	readonly onListenerError?: (error: unknown) => void;
}

export class ControlledToolRegistryError extends Error {
	readonly code: ControlledToolRegistryErrorCode;

	constructor(code: ControlledToolRegistryErrorCode, message: string = code) {
		super(message);
		this.name = "ControlledToolRegistryError";
		this.code = code;
	}
}

interface StoredControlledToolDefinition {
	readonly descriptor: ControlledToolDescriptor;
	readonly execute: (
		input: unknown,
		context: ControlledToolExecutionContext,
	) => Promise<ControlledToolExecution<unknown>>;
	readonly rowCount: (output: unknown) => number;
}

type ExecutionRace<T> =
	| { readonly kind: "completed"; readonly value: T }
	| { readonly kind: "failed" }
	| { readonly kind: "timeout" }
	| { readonly kind: "cancelled" };

type AuthorizationRace =
	| { readonly kind: "decision"; readonly decision: ControlledToolAuthorizationDecision }
	| { readonly kind: "unknown" }
	| { readonly kind: "cancelled" };

const UNSAFE_KEYS = new Set([
	"apikey",
	"authorization",
	"code",
	"command",
	"connection",
	"connectionstring",
	"credential",
	"credentials",
	"endpoint",
	"eval",
	"exec",
	"expression",
	"file",
	"filepath",
	"password",
	"path",
	"rawquery",
	"rawsql",
	"script",
	"secret",
	"shell",
	"sql",
	"token",
	"url",
	"querystring",
	"querytext",
]);

const SQL_LIKE_VALUE = /\b(?:select|with|insert|update|delete|drop|alter|create|truncate|pragma|call)\b/i;
const CODE_LIKE_VALUE =
	/(?:^#!\/|<script\b|\brm\s+-rf\b|\beval\s*\(|\bexec\s*\(|\bfunction\s*\(|\b(?:const|let|var)\s+[A-Za-z_$]|\b(?:import|require)\s*\(|=>)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isUnsafeKey(value: string): boolean {
	return UNSAFE_KEYS.has(normalizeKey(value));
}

function containsUnsafeValue(value: unknown, seen = new WeakSet<object>()): boolean {
	if (typeof value === "string") return SQL_LIKE_VALUE.test(value) || CODE_LIKE_VALUE.test(value);
	if (!isRecord(value)) return false;
	if (seen.has(value)) return true;
	seen.add(value);
	for (const [key, child] of Object.entries(value)) {
		if (isUnsafeKey(key) || containsUnsafeValue(child, seen)) return true;
	}
	return false;
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (!isRecord(value) || seen.has(value)) return false;
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			if (Object.getOwnPropertySymbols(value).length > 0) return false;
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index) || !isJsonValue(value[index], seen)) return false;
			}
			return Object.keys(value).every((key) => /^(?:0|[1-9][0-9]*)$/.test(key));
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return false;
		if (Object.getOwnPropertySymbols(value).length > 0) return false;
		if (Object.getOwnPropertyNames(value).some((key) => !Object.prototype.propertyIsEnumerable.call(value, key))) {
			return false;
		}
		return Object.values(value).every((child) => isJsonValue(child, seen));
	} catch {
		return false;
	}
}

function schemaHasUnsafeProperty(value: unknown, seen = new WeakSet<object>()): boolean {
	if (!isRecord(value)) return false;
	if (seen.has(value)) return false;
	seen.add(value);
	try {
		const properties = value.properties;
		if (isRecord(properties)) {
			for (const [key, child] of Object.entries(properties)) {
				if (isUnsafeKey(key) || schemaHasUnsafeProperty(child, seen)) return true;
			}
		}
		for (const key of ["additionalProperties", "items", "not", "contains", "if", "then", "else"]) {
			if (schemaHasUnsafeProperty(value[key], seen)) return true;
		}
		for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
			const children = value[key];
			if (Array.isArray(children) && children.some((child) => schemaHasUnsafeProperty(child, seen))) return true;
		}
		return false;
	} finally {
		seen.delete(value);
	}
}

function isPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAbortSignal(value: unknown): value is AbortSignal {
	return (
		isRecord(value) &&
		typeof value.aborted === "boolean" &&
		typeof value.addEventListener === "function" &&
		typeof value.removeEventListener === "function"
	);
}

function toolKey(toolId: ResourceId, version: VersionId): string {
	return `${toolId}\u0000${version}`;
}

function cloneSourceTypes(values: readonly SourceType[]): readonly SourceType[] {
	return Object.freeze([...values].sort());
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
	if (!isRecord(value) || seen.has(value)) return value;
	seen.add(value);
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child, seen);
	return value;
}

function cloneSchema(schema: TSchema): TSchema {
	const serialized = serialize(schema);
	if (serialized === undefined) throw new ControlledToolRegistryError("invalid_definition");
	try {
		const cloned: unknown = JSON.parse(serialized);
		if (!validSchema(cloned)) throw new ControlledToolRegistryError("invalid_definition");
		return cloned;
	} catch (error) {
		if (error instanceof ControlledToolRegistryError) throw error;
		throw new ControlledToolRegistryError("invalid_definition");
	}
}

function cloneDescriptor(descriptor: ControlledToolDescriptor): ControlledToolDescriptor {
	return deepFreeze({
		...descriptor,
		sourceTypes: [...descriptor.sourceTypes],
		inputSchema: cloneSchema(descriptor.inputSchema),
		outputSchema: cloneSchema(descriptor.outputSchema),
	});
}

function cloneEvent(event: ControlledToolLifecycleEvent): ControlledToolLifecycleEvent {
	return { ...event };
}

function serialize(value: unknown): string | undefined {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

function validSchema(value: unknown): value is TSchema {
	return isRecord(value) && !Array.isArray(value);
}

function validSourceType(value: unknown): value is SourceType {
	return isContract(SourceTypeSchema, value);
}

function validClockValue(value: string): boolean {
	return isContract(DateTimeSchema, value) && Number.isFinite(Date.parse(value));
}

function cloneBudget(value: ControlledToolBudget): ControlledToolBudget {
	return Object.freeze({ maxSteps: value.maxSteps, maxRows: value.maxRows, maxBytes: value.maxBytes });
}

export class ControlledToolRegistry {
	private readonly definitions = new Map<string, StoredControlledToolDefinition>();
	private readonly events = new Map<ResourceId, ControlledToolLifecycleEvent[]>();
	private readonly active = new Set<ResourceId>();
	private readonly seen = new Set<ResourceId>();
	private readonly authorize: ControlledToolRegistryOptions["authorize"];
	private readonly now: () => string;
	private readonly onEvent: ControlledToolRegistryOptions["onEvent"];
	private readonly onListenerError: ControlledToolRegistryOptions["onListenerError"];

	constructor(options: ControlledToolRegistryOptions) {
		if (
			!isRecord(options) ||
			typeof options.authorize !== "function" ||
			(options.now !== undefined && typeof options.now !== "function") ||
			(options.onEvent !== undefined && typeof options.onEvent !== "function") ||
			(options.onListenerError !== undefined && typeof options.onListenerError !== "function")
		) {
			throw new ControlledToolRegistryError(
				"invalid_definition",
				"Tool Registry requires an authorization function",
			);
		}
		this.authorize = options.authorize;
		this.now = options.now ?? (() => new Date().toISOString());
		this.onEvent = options.onEvent;
		this.onListenerError = options.onListenerError;
	}

	register<TInput extends TSchema, TOutput extends TSchema>(
		definition: ControlledDataToolDefinition<TInput, TOutput>,
	): ControlledToolDescriptor {
		this.validateDefinition(definition);
		const key = toolKey(definition.toolId, definition.version);
		if (this.definitions.has(key)) throw new ControlledToolRegistryError("duplicate_tool");
		const inputSchema = deepFreeze(cloneSchema(definition.inputSchema));
		const outputSchema = deepFreeze(cloneSchema(definition.outputSchema));

		const descriptor: ControlledToolDescriptor = {
			kind: definition.kind,
			toolId: definition.toolId,
			version: definition.version,
			label: definition.label,
			description: definition.description,
			capability: definition.capability,
			readOnly: true,
			sourceTypes: cloneSourceTypes(definition.sourceTypes),
			inputSchema,
			outputSchema,
			policyCategory: definition.policyCategory,
			timeoutMs: definition.timeoutMs,
			maxRows: definition.maxRows,
			maxBytes: definition.maxBytes,
			requiresEvidence: true,
		};
		this.definitions.set(key, {
			descriptor,
			execute: async (input, context) => definition.execute(input as Static<TInput>, context),
			rowCount: (output) => definition.rowCount(output as Static<TOutput>),
		});
		return cloneDescriptor(descriptor);
	}

	listTools(): readonly ControlledToolDescriptor[] {
		return [...this.definitions.values()]
			.map((definition) => cloneDescriptor(definition.descriptor))
			.sort((left, right) => toolKey(left.toolId, left.version).localeCompare(toolKey(right.toolId, right.version)));
	}

	getTool(toolId: ResourceId, version: VersionId): ControlledToolDescriptor | undefined {
		const descriptor = this.definitions.get(toolKey(toolId, version))?.descriptor;
		return descriptor === undefined ? undefined : cloneDescriptor(descriptor);
	}

	getEvents(invocationId: ResourceId): readonly ControlledToolLifecycleEvent[] {
		return (this.events.get(invocationId) ?? []).map(cloneEvent);
	}

	getActiveInvocationIds(): readonly ResourceId[] {
		return [...this.active].sort();
	}

	async invoke(request: ControlledToolInvocationRequest): Promise<ControlledToolInvocationResult<unknown>> {
		const normalized = this.normalizeInvocation(request);
		if (normalized === undefined) return this.blockInvalidInvocation(request);

		const definition = this.definitions.get(toolKey(normalized.toolId, normalized.version));
		if (definition === undefined) {
			const toolIdRegistered = [...this.definitions.values()].some(
				(candidate) => candidate.descriptor.toolId === normalized.toolId,
			);
			return this.block(normalized, toolIdRegistered ? "tool_version_mismatch" : "tool_not_registered");
		}
		if (definition.descriptor.readOnly !== true) {
			return this.block(normalized, "tool_not_read_only");
		}
		if (!definition.descriptor.sourceTypes.includes(normalized.sourceType)) {
			return this.block(normalized, "source_type_not_allowed");
		}
		if (!this.checkSchema(definition.descriptor.inputSchema, normalized.input)) {
			return this.block(normalized, "invalid_tool_input");
		}
		if (!isJsonValue(normalized.input)) return this.block(normalized, "invalid_tool_input");
		if (containsUnsafeValue(normalized.input)) return this.block(normalized, "unsafe_tool_request");
		if (normalized.remaining.maxSteps < 1) return this.block(normalized, "budget_exceeded");
		if (normalized.signal?.aborted === true) return this.block(normalized, "cancelled");
		if (this.active.has(normalized.invocationId) || this.seen.has(normalized.invocationId)) {
			return this.block(normalized, "duplicate_invocation");
		}

		const inputSerialized = serialize(normalized.input);
		if (inputSerialized === undefined) return this.block(normalized, "invalid_tool_input");
		const inputDigest = digestRuntimeText(inputSerialized);
		const requestSignal = normalized.signal;
		const controller = new AbortController();
		const onParentAbort = () => controller.abort();
		if (requestSignal !== undefined) requestSignal.addEventListener("abort", onParentAbort, { once: true });
		const remaining = cloneBudget(normalized.remaining);
		const context: ControlledToolExecutionContext = {
			invocationId: normalized.invocationId,
			runId: normalized.runId,
			ownerId: normalized.ownerId,
			workspaceId: normalized.workspaceId,
			toolId: definition.descriptor.toolId,
			version: definition.descriptor.version,
			sourceType: normalized.sourceType,
			policyCategory: definition.descriptor.policyCategory,
			inputDigest,
			remaining,
			signal: controller.signal,
		};

		this.active.add(normalized.invocationId);
		this.seen.add(normalized.invocationId);

		try {
			try {
				this.emit(normalized, "invocation_started", "invoking");
			} catch (error) {
				this.active.delete(normalized.invocationId);
				throw error;
			}
			const authorizationRace = await this.authorizeWithCancellation({
				invocationId: normalized.invocationId,
				runId: normalized.runId,
				ownerId: normalized.ownerId,
				workspaceId: normalized.workspaceId,
				toolId: definition.descriptor.toolId,
				version: definition.descriptor.version,
				sourceType: normalized.sourceType,
				policyCategory: definition.descriptor.policyCategory,
				inputDigest,
				remaining,
				signal: controller.signal,
			});
			if (authorizationRace.kind === "cancelled") return this.finishBlocked(normalized, "cancelled");
			if (authorizationRace.kind === "unknown") return this.finishBlocked(normalized, "authorization_unknown");
			if (authorizationRace.decision !== "allow") {
				return this.finishBlocked(
					normalized,
					authorizationRace.decision === "deny" ? "authorization_denied" : "authorization_unknown",
				);
			}
			if (requestSignal?.aborted === true) return this.finishBlocked(normalized, "cancelled");

			const race = await this.executeWithTimeout(definition, normalized.input, context, controller);
			if (race.kind === "timeout") {
				this.active.delete(normalized.invocationId);
				const event = this.emit(normalized, "invocation_blocked", "blocked", { reason: "timeout_exceeded" });
				return this.blockedResult(normalized, "timeout_exceeded", event);
			}
			if (race.kind === "cancelled") {
				this.active.delete(normalized.invocationId);
				const event = this.emit(normalized, "invocation_blocked", "blocked", { reason: "cancelled" });
				return this.blockedResult(normalized, "cancelled", event);
			}
			this.active.delete(normalized.invocationId);
			if (race.kind === "failed") return this.finishBlocked(normalized, "executor_failed");

			const execution = race.value;
			if (!this.checkExecutionShape(execution)) {
				return this.finishBlocked(normalized, "invalid_tool_result");
			}
			if (!this.checkSchema(definition.descriptor.outputSchema, execution.output)) {
				return this.finishBlocked(normalized, "invalid_tool_result");
			}
			if (!isJsonValue(execution.output)) return this.finishBlocked(normalized, "invalid_tool_result");
			if (containsUnsafeValue(execution.output)) {
				return this.finishBlocked(normalized, "invalid_tool_result");
			}

			let rows: number;
			try {
				rows = definition.rowCount(execution.output);
			} catch {
				return this.finishBlocked(normalized, "invalid_tool_result");
			}
			if (!isNonNegativeInteger(rows)) return this.finishBlocked(normalized, "invalid_tool_result");
			const serializedOutput = serialize(execution.output);
			if (serializedOutput === undefined) return this.finishBlocked(normalized, "invalid_tool_result");
			const bytes = Buffer.byteLength(serializedOutput, "utf8");
			const maxRows = Math.min(definition.descriptor.maxRows, normalized.remaining.maxRows);
			const maxBytes = Math.min(definition.descriptor.maxBytes, normalized.remaining.maxBytes);
			if (rows > maxRows || bytes > maxBytes) {
				return this.finishBlocked(normalized, "budget_exceeded");
			}
			if (!execution.evidenceReady) {
				return this.finishBlocked(normalized, "evidence_required");
			}

			const eventType = execution.status === "complete" ? "invocation_completed" : "invocation_partial";
			const eventStatus = execution.status;
			const event = this.emit(normalized, eventType, eventStatus, { rows, bytes });
			return {
				contractVersion: CONTROLLED_TOOL_REGISTRY_CONTRACT_VERSION,
				invocationId: normalized.invocationId,
				runId: normalized.runId,
				toolId: definition.descriptor.toolId,
				version: definition.descriptor.version,
				sourceType: normalized.sourceType,
				status: execution.status,
				output: execution.output,
				rows,
				bytes,
				evidenceReady: true,
				event,
			};
		} finally {
			this.active.delete(normalized.invocationId);
			if (requestSignal !== undefined) requestSignal.removeEventListener("abort", onParentAbort);
			controller.abort();
		}
	}

	private validateDefinition<TInput extends TSchema, TOutput extends TSchema>(
		definition: ControlledDataToolDefinition<TInput, TOutput>,
	): void {
		if (
			!isRecord(definition) ||
			definition.kind !== "controlled_data_tool" ||
			!isContract(ResourceIdSchema, definition.toolId) ||
			!isContract(VersionIdSchema, definition.version) ||
			typeof definition.label !== "string" ||
			definition.label.length < 1 ||
			definition.label.length > 200 ||
			typeof definition.description !== "string" ||
			definition.description.length < 1 ||
			definition.description.length > 2000 ||
			typeof definition.capability !== "string" ||
			definition.capability.length < 1 ||
			definition.capability.length > 128 ||
			definition.readOnly !== true ||
			!Array.isArray(definition.sourceTypes) ||
			definition.sourceTypes.length === 0 ||
			definition.sourceTypes.some((sourceType) => !validSourceType(sourceType)) ||
			new Set(definition.sourceTypes).size !== definition.sourceTypes.length ||
			!validSchema(definition.inputSchema) ||
			!validSchema(definition.outputSchema) ||
			schemaHasUnsafeProperty(definition.inputSchema) ||
			schemaHasUnsafeProperty(definition.outputSchema) ||
			!isContract(ResourceIdSchema, definition.policyCategory) ||
			!isPositiveInteger(definition.timeoutMs, 300_000) ||
			!isPositiveInteger(definition.maxRows, 1_000_000) ||
			!isPositiveInteger(definition.maxBytes, 1_000_000_000) ||
			definition.requiresEvidence !== true ||
			typeof definition.execute !== "function" ||
			typeof definition.rowCount !== "function"
		) {
			throw new ControlledToolRegistryError("invalid_definition");
		}
	}

	private normalizeInvocation(request: ControlledToolInvocationRequest): ControlledToolInvocationRequest | undefined {
		if (
			!isRecord(request) ||
			!isContract(ResourceIdSchema, request.invocationId) ||
			!isContract(ResourceIdSchema, request.runId) ||
			!isContract(ResourceIdSchema, request.ownerId) ||
			!isContract(ResourceIdSchema, request.workspaceId) ||
			!isContract(ResourceIdSchema, request.toolId) ||
			!isContract(VersionIdSchema, request.version) ||
			!validSourceType(request.sourceType) ||
			!isRecord(request.remaining) ||
			!isNonNegativeInteger(request.remaining.maxSteps) ||
			!isNonNegativeInteger(request.remaining.maxRows) ||
			!isNonNegativeInteger(request.remaining.maxBytes) ||
			(request.signal !== undefined && !isAbortSignal(request.signal))
		) {
			return undefined;
		}
		return {
			invocationId: request.invocationId,
			runId: request.runId,
			ownerId: request.ownerId,
			workspaceId: request.workspaceId,
			toolId: request.toolId,
			version: request.version,
			sourceType: request.sourceType,
			input: request.input,
			remaining: cloneBudget(request.remaining),
			...(request.signal === undefined ? {} : { signal: request.signal }),
		};
	}

	private checkSchema(schema: TSchema, value: unknown): boolean {
		try {
			return isContract(schema, value);
		} catch {
			return false;
		}
	}

	private checkExecutionShape(value: unknown): value is ControlledToolExecution<unknown> {
		if (!isRecord(value)) return false;
		return (
			(value.status === "complete" || value.status === "partial") &&
			"output" in value &&
			typeof value.evidenceReady === "boolean"
		);
	}

	private async authorizeWithCancellation(request: ControlledToolAuthorizationRequest): Promise<AuthorizationRace> {
		if (request.signal.aborted) return { kind: "cancelled" };

		let resolveCancellation: (() => void) | undefined;
		const cancellation = new Promise<AuthorizationRace>((resolve) => {
			resolveCancellation = () => resolve({ kind: "cancelled" });
		});
		const onAbort = () => resolveCancellation?.();
		request.signal.addEventListener("abort", onAbort, { once: true });
		const decision = (async (): Promise<AuthorizationRace> => {
			try {
				return { kind: "decision", decision: await this.authorize(request) };
			} catch {
				return { kind: "unknown" };
			}
		})();
		const result = await Promise.race([decision, cancellation]);
		request.signal.removeEventListener("abort", onAbort);
		return result;
	}

	private async executeWithTimeout(
		definition: StoredControlledToolDefinition,
		input: unknown,
		context: ControlledToolExecutionContext,
		controller: AbortController,
	): Promise<
		| { readonly kind: "completed"; readonly value: ControlledToolExecution<unknown> }
		| { readonly kind: "failed" }
		| { readonly kind: "timeout" }
		| { readonly kind: "cancelled" }
	> {
		let timeoutTriggered = false;
		let resolveControl: ((result: ExecutionRace<ControlledToolExecution<unknown>>) => void) | undefined;
		const control = new Promise<ExecutionRace<ControlledToolExecution<unknown>>>((resolve) => {
			resolveControl = resolve;
		});
		const onAbort = () => resolveControl?.({ kind: timeoutTriggered ? "timeout" : "cancelled" });
		context.signal.addEventListener("abort", onAbort, { once: true });
		const execution: Promise<ExecutionRace<ControlledToolExecution<unknown>>> = definition
			.execute(input, context)
			.then(
				(value) => ({ kind: "completed", value }) satisfies ExecutionRace<ControlledToolExecution<unknown>>,
				() => ({ kind: "failed" }) satisfies ExecutionRace<ControlledToolExecution<unknown>>,
			);
		const timer = setTimeout(() => {
			timeoutTriggered = true;
			controller.abort();
			resolveControl?.({ kind: "timeout" });
		}, definition.descriptor.timeoutMs);

		const race = await Promise.race([execution, control]);
		clearTimeout(timer);
		context.signal.removeEventListener("abort", onAbort);
		if (race.kind === "completed") return race;
		if (race.kind === "failed") return race;
		return race;
	}

	private blockInvalidInvocation(request: ControlledToolInvocationRequest): ControlledToolInvocationResult<unknown> {
		const fallback = {
			invocationId: isContract(ResourceIdSchema, request?.invocationId)
				? request.invocationId
				: "invalid-invocation",
			runId: isContract(ResourceIdSchema, request?.runId) ? request.runId : "invalid-run",
			toolId: isContract(ResourceIdSchema, request?.toolId) ? request.toolId : "invalid-tool",
			version: isContract(VersionIdSchema, request?.version) ? request.version : "invalid-version",
			sourceType: validSourceType(request?.sourceType) ? request.sourceType : "database",
		};
		return this.block(fallback, "invalid_invocation");
	}

	private block(
		request: Pick<ControlledToolInvocationRequest, "invocationId" | "runId" | "toolId" | "version" | "sourceType">,
		reason: ControlledToolFailureCode,
	): ControlledToolInvocationResult<unknown> {
		const event = this.emit(request, "invocation_blocked", "blocked", { reason });
		return this.blockedResult(request, reason, event);
	}

	private blockedResult(
		request: Pick<ControlledToolInvocationRequest, "invocationId" | "runId" | "toolId" | "version" | "sourceType">,
		reason: ControlledToolFailureCode,
		event: ControlledToolLifecycleEvent,
	): ControlledToolInvocationResult<unknown> {
		return {
			contractVersion: CONTROLLED_TOOL_REGISTRY_CONTRACT_VERSION,
			invocationId: request.invocationId,
			runId: request.runId,
			toolId: request.toolId,
			version: request.version,
			sourceType: request.sourceType,
			status: "blocked",
			reason,
			event,
		};
	}

	private finishBlocked(
		request: ControlledToolInvocationRequest,
		reason: ControlledToolFailureCode,
	): ControlledToolInvocationResult<unknown> {
		this.active.delete(request.invocationId);
		return this.block(request, reason);
	}

	private emit(
		request: Pick<ControlledToolInvocationRequest, "invocationId" | "runId" | "toolId" | "version" | "sourceType">,
		type: ControlledToolLifecycleEvent["type"],
		status: ControlledToolLifecycleEvent["status"],
		values: { readonly rows?: number; readonly bytes?: number; readonly reason?: ControlledToolFailureCode } = {},
	): ControlledToolLifecycleEvent {
		const existing = this.events.get(request.invocationId) ?? [];
		const sequence = existing.length + 1;
		const occurredAt = this.now();
		if (!validClockValue(occurredAt)) throw new ControlledToolRegistryError("invalid_registry_clock");
		const event: ControlledToolLifecycleEvent = {
			contractVersion: CONTROLLED_TOOL_REGISTRY_CONTRACT_VERSION,
			eventId: digestRuntimeText(`${request.invocationId}:${sequence}:${type}`),
			invocationId: request.invocationId,
			runId: request.runId,
			sequence,
			occurredAt,
			type,
			status,
			toolId: request.toolId,
			version: request.version,
			sourceType: request.sourceType,
			...(values.rows === undefined ? {} : { rows: values.rows }),
			...(values.bytes === undefined ? {} : { bytes: values.bytes }),
			...(values.reason === undefined ? {} : { reason: values.reason }),
		};
		existing.push(event);
		this.events.set(request.invocationId, existing);
		try {
			this.onEvent?.(cloneEvent(event));
		} catch (error) {
			try {
				this.onListenerError?.(error);
			} catch {
				// Observability callbacks cannot change tool execution state.
			}
		}
		return cloneEvent(event);
	}
}
