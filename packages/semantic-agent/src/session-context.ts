import Type, { type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { DateTimeSchema, FreshnessSchema, isContract, ResourceIdSchema, VersionIdSchema } from "./contracts.ts";

export const SESSION_CONTEXT_CONTRACT_VERSION = "session.v1" as const;

const strictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

const schemaOptions = (id: string) => ({
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://alphaox.dev/schemas/${id}`,
});

const ContextPackRefSchema = strictObject({
	kind: Type.Literal("context_pack"),
	id: ResourceIdSchema,
	version: VersionIdSchema,
});

const AnalysisPlanRefSchema = strictObject({
	kind: Type.Literal("analysis_plan"),
	id: ResourceIdSchema,
	version: VersionIdSchema,
});

export type SessionAnalysisPlanRef = Static<typeof AnalysisPlanRefSchema>;

export const SessionContextItemSchema = strictObject({
	itemId: ResourceIdSchema,
	kind: Type.Union([Type.Literal("preference"), Type.Literal("workspace_knowledge")]),
	version: VersionIdSchema,
	scope: Type.Union([Type.Literal("session"), Type.Literal("workspace")]),
	digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
	freshness: FreshnessSchema,
});
export type SessionContextItem = Static<typeof SessionContextItemSchema>;

const SessionContextStatusSchema = Type.Union([Type.Literal("active"), Type.Literal("revoked")]);
export type SessionContextStatus = Static<typeof SessionContextStatusSchema>;

export const SessionContextSchema = Type.Object(
	{
		contractVersion: Type.Literal(SESSION_CONTEXT_CONTRACT_VERSION),
		kind: Type.Literal("session_context"),
		sessionId: ResourceIdSchema,
		traceId: ResourceIdSchema,
		ownerId: ResourceIdSchema,
		workspaceId: ResourceIdSchema,
		version: VersionIdSchema,
		status: SessionContextStatusSchema,
		contextPack: ContextPackRefSchema,
		plan: Type.Optional(AnalysisPlanRefSchema),
		items: Type.Array(SessionContextItemSchema),
		freshness: FreshnessSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	},
	{ additionalProperties: false, ...schemaOptions("session-context.schema.json") },
);
export type SessionContext = Static<typeof SessionContextSchema>;

export type SessionContextErrorCode =
	| "invalid_context"
	| "invalid_scope"
	| "invalid_time"
	| "not_found"
	| "owner_mismatch"
	| "workspace_mismatch"
	| "trace_mismatch"
	| "version_mismatch"
	| "version_conflict"
	| "context_revoked"
	| "freshness_expired"
	| "freshness_not_allowed"
	| "store_failed";

export class SessionContextError extends Error {
	readonly code: SessionContextErrorCode;

	constructor(code: SessionContextErrorCode, message: string = code) {
		super(message);
		this.name = "SessionContextError";
		this.code = code;
	}
}

export type SessionFreshnessPolicy = "fresh_only" | "allow_stale" | "allow_unknown";

export interface SessionContextLookup {
	readonly sessionId: string;
	readonly ownerId: string;
	readonly workspaceId: string;
	readonly version?: string;
}

export interface SessionContextResolutionRequest extends SessionContextLookup {
	readonly at: string;
	readonly freshnessPolicy?: SessionFreshnessPolicy;
}

export type SessionContextAvailabilityWarning = "freshness_stale" | "freshness_unknown";

export type SessionContextResolution =
	| {
			readonly status: "available";
			readonly context: SessionContext;
			readonly warnings: readonly SessionContextAvailabilityWarning[];
	  }
	| {
			readonly status: "blocked";
			readonly reason:
				| "invalid_context"
				| "invalid_scope"
				| "invalid_time"
				| "not_found"
				| "owner_mismatch"
				| "workspace_mismatch"
				| "version_mismatch"
				| "context_revoked"
				| "freshness_expired"
				| "freshness_not_allowed";
	  };

export interface SessionContextReplacement extends SessionContextLookup {
	readonly expectedVersion: string;
	readonly context: unknown;
}

export interface SessionContextRevocation extends SessionContextLookup {
	readonly expectedVersion: string;
	readonly at: string;
}

export interface SessionContextStore {
	register(value: unknown): SessionContext;
	get(request: SessionContextLookup): SessionContext;
	resolve(request: unknown): SessionContextResolution;
	replace(request: SessionContextReplacement): SessionContext;
	activate(request: SessionContextLookup): SessionContext;
	revoke(request: SessionContextRevocation): SessionContext;
}

function assertSchema<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	message: string,
): Static<TSchemaType> {
	if (!Check(schema, value)) throw new SessionContextError("invalid_context", message);
	return value as Static<TSchemaType>;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function itemKey(item: SessionContextItem): string {
	return `${item.scope}\u0000${item.kind}\u0000${item.itemId}\u0000${item.version}`;
}

function cloneFreshness(value: SessionContext["freshness"]): SessionContext["freshness"] {
	return {
		asOf: value.asOf,
		checkedAt: value.checkedAt,
		status: value.status,
		...(value.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: value.maxAgeSeconds }),
	};
}

function cloneContext(value: SessionContext): SessionContext {
	return {
		contractVersion: value.contractVersion,
		kind: "session_context",
		sessionId: value.sessionId,
		traceId: value.traceId,
		ownerId: value.ownerId,
		workspaceId: value.workspaceId,
		version: value.version,
		status: value.status,
		contextPack: { kind: "context_pack", id: value.contextPack.id, version: value.contextPack.version },
		...(value.plan === undefined
			? {}
			: { plan: { kind: "analysis_plan", id: value.plan.id, version: value.plan.version } }),
		items: value.items.map((item) => ({
			itemId: item.itemId,
			kind: item.kind,
			version: item.version,
			scope: item.scope,
			digest: item.digest,
			freshness: cloneFreshness(item.freshness),
		})),
		freshness: cloneFreshness(value.freshness),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function normalizeFreshness(value: SessionContext["freshness"]): SessionContext["freshness"] {
	for (const timestamp of [value.asOf, value.checkedAt]) {
		if (!isContract(DateTimeSchema, timestamp) || !Number.isFinite(Date.parse(timestamp))) {
			throw new SessionContextError("invalid_time", "Invalid Session Context freshness time");
		}
	}
	return cloneFreshness(value);
}

function normalizeScope(value: SessionContextLookup): SessionContextLookup {
	if (
		!isContract(ResourceIdSchema, value.sessionId) ||
		!isContract(ResourceIdSchema, value.ownerId) ||
		!isContract(ResourceIdSchema, value.workspaceId)
	) {
		throw new SessionContextError("invalid_scope", "Invalid Session Context scope");
	}
	if (value.version !== undefined && !isContract(VersionIdSchema, value.version)) {
		throw new SessionContextError("invalid_scope", "Invalid Session Context version");
	}
	return {
		sessionId: value.sessionId,
		ownerId: value.ownerId,
		workspaceId: value.workspaceId,
		...(value.version === undefined ? {} : { version: value.version }),
	};
}

function canonicalContext(value: SessionContext): string {
	return JSON.stringify(value);
}

export function normalizeSessionContext(value: unknown): SessionContext {
	const parsed = assertSchema(SessionContextSchema, value, "Invalid Session Context contract");
	if (!isContract(DateTimeSchema, parsed.createdAt) || !Number.isFinite(Date.parse(parsed.createdAt))) {
		throw new SessionContextError("invalid_time", "Invalid Session Context creation time");
	}
	if (!isContract(DateTimeSchema, parsed.updatedAt) || !Number.isFinite(Date.parse(parsed.updatedAt))) {
		throw new SessionContextError("invalid_time", "Invalid Session Context update time");
	}
	if (Date.parse(parsed.updatedAt) < Date.parse(parsed.createdAt)) {
		throw new SessionContextError("invalid_time", "Session Context update precedes creation");
	}
	const itemKeys = parsed.items.map(itemKey);
	if (new Set(itemKeys).size !== itemKeys.length) {
		throw new SessionContextError("invalid_context", "Duplicate Session Context item");
	}
	const itemIds = parsed.items.map((item) => item.itemId);
	if (new Set(itemIds).size !== itemIds.length) {
		throw new SessionContextError("invalid_context", "Duplicate Session Context item ID");
	}
	for (const item of parsed.items) {
		if (
			(item.kind === "preference" && item.scope !== "session") ||
			(item.kind === "workspace_knowledge" && item.scope !== "workspace")
		) {
			throw new SessionContextError("invalid_context", "Session Context item scope is invalid");
		}
	}
	const freshness = normalizeFreshness(parsed.freshness);
	const items = parsed.items
		.map((item) => ({
			itemId: item.itemId,
			kind: item.kind,
			version: item.version,
			scope: item.scope,
			digest: item.digest,
			freshness: normalizeFreshness(item.freshness),
		}))
		.sort((left, right) => compareStrings(itemKey(left), itemKey(right)));
	return {
		contractVersion: SESSION_CONTEXT_CONTRACT_VERSION,
		kind: "session_context",
		sessionId: parsed.sessionId,
		traceId: parsed.traceId,
		ownerId: parsed.ownerId,
		workspaceId: parsed.workspaceId,
		version: parsed.version,
		status: parsed.status,
		contextPack: { kind: "context_pack", id: parsed.contextPack.id, version: parsed.contextPack.version },
		...(parsed.plan === undefined
			? {}
			: { plan: { kind: "analysis_plan", id: parsed.plan.id, version: parsed.plan.version } }),
		items,
		freshness,
		createdAt: parsed.createdAt,
		updatedAt: parsed.updatedAt,
	};
}

function readContext(
	versions: ReadonlyMap<string, SessionContext>,
	currentVersion: string | undefined,
	request: SessionContextLookup,
): SessionContext {
	const scope = normalizeScope(request);
	const versionMap = versions;
	if (versionMap.size === 0) throw new SessionContextError("not_found", "Session Context not found");
	const first = versionMap.values().next().value as SessionContext | undefined;
	if (first === undefined) throw new SessionContextError("not_found", "Session Context not found");
	if (first.ownerId !== scope.ownerId)
		throw new SessionContextError("owner_mismatch", "Session Context owner mismatch");
	if (first.workspaceId !== scope.workspaceId)
		throw new SessionContextError("workspace_mismatch", "Session Context workspace mismatch");
	const version = scope.version ?? currentVersion;
	if (version === undefined) throw new SessionContextError("not_found", "Session Context not found");
	const context = versionMap.get(version);
	if (context === undefined) throw new SessionContextError("version_mismatch", "Session Context version mismatch");
	if (currentVersion !== version) throw new SessionContextError("version_mismatch", "Session Context is not current");
	return context;
}

function resolutionFailure(error: unknown): SessionContextResolution {
	if (error instanceof SessionContextError) {
		if (
			error.code === "invalid_context" ||
			error.code === "invalid_scope" ||
			error.code === "invalid_time" ||
			error.code === "not_found" ||
			error.code === "owner_mismatch" ||
			error.code === "workspace_mismatch" ||
			error.code === "version_mismatch" ||
			error.code === "context_revoked" ||
			error.code === "freshness_expired" ||
			error.code === "freshness_not_allowed"
		) {
			return { status: "blocked", reason: error.code };
		}
	}
	return { status: "blocked", reason: "invalid_context" };
}

function freshnessStatuses(context: SessionContext): readonly SessionContext["freshness"]["status"][] {
	return [context.freshness.status, ...context.items.map((item) => item.freshness.status)];
}

export class InMemorySessionContextStore implements SessionContextStore {
	private readonly versions = new Map<string, Map<string, SessionContext>>();

	private readonly currentVersions = new Map<string, string>();

	register(value: unknown): SessionContext {
		const context = normalizeSessionContext(value);
		const versionMap = this.versions.get(context.sessionId) ?? new Map<string, SessionContext>();
		const existingScope = versionMap.values().next().value as SessionContext | undefined;
		if (existingScope !== undefined) {
			if (existingScope.ownerId !== context.ownerId)
				throw new SessionContextError("owner_mismatch", "Session Context owner mismatch");
			if (existingScope.workspaceId !== context.workspaceId)
				throw new SessionContextError("workspace_mismatch", "Session Context workspace mismatch");
			if (existingScope.traceId !== context.traceId)
				throw new SessionContextError("trace_mismatch", "Session Context trace mismatch");
		}
		const existing = versionMap.get(context.version);
		if (existing !== undefined) {
			if (canonicalContext(existing) !== canonicalContext(context)) {
				throw new SessionContextError(
					"version_conflict",
					"Session Context version already contains different content",
				);
			}
			return cloneContext(existing);
		}
		versionMap.set(context.version, cloneContext(context));
		this.versions.set(context.sessionId, versionMap);
		const currentVersion = this.currentVersions.get(context.sessionId);
		if (currentVersion === undefined || versionMap.get(currentVersion)?.status === "revoked") {
			this.currentVersions.set(context.sessionId, context.version);
		}
		return cloneContext(context);
	}

	get(request: SessionContextLookup): SessionContext {
		const scope = normalizeScope(request);
		const versionMap = this.versions.get(scope.sessionId);
		if (versionMap === undefined) throw new SessionContextError("not_found", "Session Context not found");
		return cloneContext(readContext(versionMap, this.currentVersions.get(scope.sessionId), scope));
	}

	resolve(request: unknown): SessionContextResolution {
		if (typeof request !== "object" || request === null) return { status: "blocked", reason: "invalid_context" };
		const candidate = request as Partial<SessionContextResolutionRequest>;
		if (
			typeof candidate.sessionId !== "string" ||
			typeof candidate.ownerId !== "string" ||
			typeof candidate.workspaceId !== "string" ||
			typeof candidate.at !== "string"
		) {
			return { status: "blocked", reason: "invalid_context" };
		}
		if (!isContract(DateTimeSchema, candidate.at) || !Number.isFinite(Date.parse(candidate.at))) {
			return { status: "blocked", reason: "invalid_time" };
		}
		const freshnessPolicy = candidate.freshnessPolicy ?? "fresh_only";
		if (
			freshnessPolicy !== "fresh_only" &&
			freshnessPolicy !== "allow_stale" &&
			freshnessPolicy !== "allow_unknown"
		) {
			return { status: "blocked", reason: "invalid_context" };
		}
		try {
			const context = this.get({
				sessionId: candidate.sessionId,
				ownerId: candidate.ownerId,
				workspaceId: candidate.workspaceId,
				...(candidate.version === undefined ? {} : { version: candidate.version }),
			});
			if (context.status === "revoked")
				throw new SessionContextError("context_revoked", "Session Context is revoked");
			const freshnessStatusesForContext = freshnessStatuses(context);
			if (freshnessStatusesForContext.includes("expired"))
				throw new SessionContextError("freshness_expired", "Session Context freshness is expired");
			if (freshnessStatusesForContext.includes("stale") && freshnessPolicy === "fresh_only") {
				throw new SessionContextError("freshness_not_allowed", "Stale Session Context is not allowed");
			}
			if (freshnessStatusesForContext.includes("unknown") && freshnessPolicy !== "allow_unknown") {
				throw new SessionContextError("freshness_not_allowed", "Unknown Session Context freshness is not allowed");
			}
			const warnings: SessionContextAvailabilityWarning[] = [];
			if (freshnessStatusesForContext.includes("stale")) warnings.push("freshness_stale");
			if (freshnessStatusesForContext.includes("unknown")) warnings.push("freshness_unknown");
			return { status: "available", context, warnings };
		} catch (error) {
			return resolutionFailure(error);
		}
	}

	replace(request: SessionContextReplacement): SessionContext {
		const expected = normalizeScope({
			sessionId: request.sessionId,
			ownerId: request.ownerId,
			workspaceId: request.workspaceId,
			version: request.expectedVersion,
		});
		if (!isContract(VersionIdSchema, request.expectedVersion)) {
			throw new SessionContextError("invalid_scope", "Invalid expected Session Context version");
		}
		const current = this.get(expected);
		const replacement = normalizeSessionContext(request.context);
		if (replacement.sessionId !== expected.sessionId) {
			throw new SessionContextError("version_conflict", "Replacement Session Context identity mismatch");
		}
		if (replacement.ownerId !== expected.ownerId)
			throw new SessionContextError("owner_mismatch", "Session Context owner mismatch");
		if (replacement.workspaceId !== expected.workspaceId)
			throw new SessionContextError("workspace_mismatch", "Session Context workspace mismatch");
		if (replacement.traceId !== current.traceId)
			throw new SessionContextError("trace_mismatch", "Session Context trace mismatch");
		if (replacement.createdAt !== current.createdAt)
			throw new SessionContextError("version_conflict", "Session Context creation time changed");
		if (current.version !== expected.version || replacement.version === expected.version) {
			throw new SessionContextError("version_mismatch", "Session Context replacement version mismatch");
		}
		if (replacement.status !== "active")
			throw new SessionContextError("invalid_context", "Replacement Session Context must be active");
		this.register(replacement);
		this.currentVersions.set(expected.sessionId, replacement.version);
		return cloneContext(replacement);
	}

	activate(request: SessionContextLookup): SessionContext {
		const scope = normalizeScope(request);
		if (scope.version === undefined)
			throw new SessionContextError("invalid_scope", "Session Context version is required");
		const versionMap = this.versions.get(scope.sessionId);
		if (versionMap === undefined) throw new SessionContextError("not_found", "Session Context not found");
		const context = readContext(versionMap, this.currentVersions.get(scope.sessionId), {
			sessionId: scope.sessionId,
			ownerId: scope.ownerId,
			workspaceId: scope.workspaceId,
		});
		if (context.ownerId !== scope.ownerId)
			throw new SessionContextError("owner_mismatch", "Session Context owner mismatch");
		if (context.workspaceId !== scope.workspaceId)
			throw new SessionContextError("workspace_mismatch", "Session Context workspace mismatch");
		const target = versionMap.get(scope.version);
		if (target === undefined) throw new SessionContextError("version_mismatch", "Session Context version mismatch");
		if (target.status !== "active") throw new SessionContextError("context_revoked", "Session Context is revoked");
		this.currentVersions.set(scope.sessionId, scope.version);
		return cloneContext(target);
	}

	revoke(request: SessionContextRevocation): SessionContext {
		if (!isContract(DateTimeSchema, request.at) || !Number.isFinite(Date.parse(request.at))) {
			throw new SessionContextError("invalid_time", "Invalid Session Context revocation time");
		}
		const scope = normalizeScope({
			sessionId: request.sessionId,
			ownerId: request.ownerId,
			workspaceId: request.workspaceId,
			version: request.expectedVersion,
		});
		const current = this.get(scope);
		if (current.version !== request.expectedVersion)
			throw new SessionContextError("version_mismatch", "Session Context version mismatch");
		const revoked = normalizeSessionContext({
			...current,
			status: "revoked",
			updatedAt: request.at,
		});
		const versionMap = this.versions.get(scope.sessionId);
		if (versionMap === undefined)
			throw new SessionContextError("store_failed", "Session Context store state is missing");
		versionMap.set(current.version, revoked);
		return cloneContext(revoked);
	}
}
