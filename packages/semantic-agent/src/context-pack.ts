import {
	ContextContractValidationError,
	type ContextPack,
	type ContextResource,
	type DataDictionaryResource,
	type DateTime,
	DateTimeSchema,
	type DocumentResource,
	isContract,
	type PermissionRef,
	type Provenance,
	parseContextPack,
	type ResourceRef,
	type SourceRef,
	type TermResource,
} from "./contracts.ts";

export type ContextPackErrorCode = "invalid_pack" | "invalid_json" | "invalid_time";

export class ContextPackError extends Error {
	readonly code: ContextPackErrorCode;

	constructor(code: ContextPackErrorCode, message: string) {
		super(message);
		this.name = "ContextPackError";
		this.code = code;
	}
}

export type ContextPackAvailabilityReason =
	| "invalid_pack"
	| "invalid_time"
	| "not_yet_effective"
	| "draft"
	| "in_review"
	| "revoked"
	| "expired"
	| "rolled_back"
	| "freshness_expired";

export type ContextPackAvailabilityWarning = "freshness_stale" | "freshness_unknown";

export type ContextPackAvailability =
	| { readonly status: "available"; readonly warnings: readonly ContextPackAvailabilityWarning[] }
	| { readonly status: "blocked"; readonly reason: ContextPackAvailabilityReason };

function invalidPack(message: string): never {
	throw new ContextPackError("invalid_pack", message);
}

function invalidJson(): never {
	throw new ContextPackError("invalid_json", "Invalid ContextPack JSON");
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sourceKey(source: SourceRef): string {
	return `${source.sourceId}\u0000${source.version}`;
}

function resourceRefKey(resourceRef: ResourceRef): string {
	return `${resourceRef.kind}\u0000${resourceRef.id}\u0000${resourceRef.version}`;
}

function permissionKey(permission: PermissionRef): string {
	return `${permission.policyId}\u0000${permission.policyVersion}`;
}

function ensureUnique(values: readonly string[], label: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) invalidPack(`Duplicate ${label}`);
		seen.add(value);
	}
}

function normalizeSourceRef(source: SourceRef): SourceRef {
	return { sourceId: source.sourceId, version: source.version };
}

function normalizeSourceRefs(sources: readonly SourceRef[], label: string): SourceRef[] {
	const normalized = sources.map(normalizeSourceRef).sort((left, right) => {
		return compareStrings(sourceKey(left), sourceKey(right));
	});
	ensureUnique(normalized.map(sourceKey), label);
	return normalized;
}

function normalizeResourceRef(resourceRef: ResourceRef): ResourceRef {
	return { kind: resourceRef.kind, id: resourceRef.id, version: resourceRef.version };
}

function normalizePermission(permission: PermissionRef): PermissionRef {
	return { policyId: permission.policyId, policyVersion: permission.policyVersion };
}

function normalizePermissions(permissions: readonly PermissionRef[]): PermissionRef[] {
	const normalized = permissions.map(normalizePermission).sort((left, right) => {
		return compareStrings(permissionKey(left), permissionKey(right));
	});
	ensureUnique(normalized.map(permissionKey), "permission references");
	return normalized;
}

function normalizeAliases(aliases: readonly string[]): string[] {
	const normalized = [...aliases].sort(compareStrings);
	ensureUnique(normalized, "term aliases");
	return normalized;
}

function normalizeTerm(resource: TermResource): TermResource {
	return {
		resourceId: resource.resourceId,
		type: "term",
		label: resource.label,
		definition: resource.definition,
		aliases: normalizeAliases(resource.aliases),
		sources: normalizeSourceRefs(resource.sources, "term source references"),
	};
}

function normalizeDocument(resource: DocumentResource): DocumentResource {
	return {
		resourceId: resource.resourceId,
		type: "document",
		title: resource.title,
		content: {
			uri: resource.content.uri,
			digest: resource.content.digest,
			mediaType: resource.content.mediaType,
		},
		sources: normalizeSourceRefs(resource.sources, "document source references"),
	};
}

function normalizeDataDictionary(resource: DataDictionaryResource): DataDictionaryResource {
	const termIds = [...resource.termIds].sort(compareStrings);
	ensureUnique(termIds, "data dictionary term references");
	return {
		resourceId: resource.resourceId,
		type: "data_dictionary",
		physicalName: resource.physicalName,
		description: resource.description,
		dataType: resource.dataType,
		source: normalizeSourceRef(resource.source),
		termIds,
	};
}

function normalizeResource(resource: ContextResource): ContextResource {
	switch (resource.type) {
		case "term":
			return normalizeTerm(resource);
		case "document":
			return normalizeDocument(resource);
		case "data_dictionary":
			return normalizeDataDictionary(resource);
		default:
			return invalidPack("Unsupported context resource type");
	}
}

function normalizeProvenance(provenance: Provenance): Provenance {
	return {
		sources: normalizeSourceRefs(provenance.sources, "provenance source references"),
		createdBy: {
			kind: provenance.createdBy.kind,
			...(provenance.createdBy.id === undefined ? {} : { id: provenance.createdBy.id }),
		},
		createdAt: provenance.createdAt,
	};
}

function parseTime(value: DateTime, code: ContextPackErrorCode): number {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new ContextPackError(code, "Invalid ContextPack time");
	return timestamp;
}

function validateSourceCoverage(
	pack: ContextPack,
	resources: readonly ContextResource[],
	provenance: Provenance,
): void {
	const packSourceKeys = new Set(pack.sources.map(sourceKey));
	for (const source of provenance.sources) {
		if (!packSourceKeys.has(sourceKey(source))) invalidPack("Provenance source is not declared by the pack");
	}
	for (const resource of resources) {
		const sources = resource.type === "data_dictionary" ? [resource.source] : resource.sources;
		for (const source of sources) {
			if (!packSourceKeys.has(sourceKey(source))) invalidPack("Resource source is not declared by the pack");
		}
	}
}

function validateResourceReferences(resources: readonly ContextResource[]): void {
	const resourceById = new Map<string, ContextResource>();
	for (const resource of resources) {
		if (resourceById.has(resource.resourceId)) invalidPack("Context resource IDs must be globally unique");
		resourceById.set(resource.resourceId, resource);
	}
	for (const resource of resources) {
		if (resource.type !== "data_dictionary") continue;
		for (const termId of resource.termIds) {
			if (resourceById.get(termId)?.type !== "term") {
				invalidPack("Data dictionary term reference is unresolved");
			}
		}
	}
}

function normalizeBindings(bindings: readonly ResourceRef[]): ResourceRef[] {
	const normalized = bindings.map((binding) => {
		if (binding.kind !== "source_binding")
			invalidPack("Context Pack bindings must reference Source Binding resources");
		return normalizeResourceRef(binding);
	});
	normalized.sort((left, right) => compareStrings(resourceRefKey(left), resourceRefKey(right)));
	ensureUnique(normalized.map(resourceRefKey), "binding references");
	return normalized;
}

export function normalizeContextPack(value: unknown): ContextPack {
	let pack: ContextPack;
	try {
		pack = parseContextPack(value);
	} catch (error) {
		if (error instanceof ContextContractValidationError) invalidPack("Context Pack contract validation failed");
		invalidPack("Context Pack contract validation failed");
	}

	const sources = normalizeSourceRefs(pack.sources, "pack source references");
	const bindings = normalizeBindings(pack.bindings);
	const resources = pack.resources
		.map(normalizeResource)
		.sort((left, right) => compareStrings(left.resourceId, right.resourceId));
	const permissions = normalizePermissions(pack.permissions);
	const provenance = normalizeProvenance(pack.provenance);
	const normalized: ContextPack = {
		contractVersion: pack.contractVersion,
		kind: "context_pack",
		packId: pack.packId,
		version: pack.version,
		name: pack.name,
		status: pack.status,
		sources,
		bindings,
		resources,
		permissions,
		provenance,
		freshness: {
			asOf: pack.freshness.asOf,
			checkedAt: pack.freshness.checkedAt,
			status: pack.freshness.status,
			...(pack.freshness.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: pack.freshness.maxAgeSeconds }),
		},
		effectiveFrom: pack.effectiveFrom,
		...(pack.effectiveTo === undefined ? {} : { effectiveTo: pack.effectiveTo }),
	};

	ensureUnique(
		normalized.resources.map((resource) => resource.resourceId),
		"context resource IDs",
	);
	validateSourceCoverage(normalized, normalized.resources, normalized.provenance);
	validateResourceReferences(normalized.resources);
	const effectiveFrom = parseTime(normalized.effectiveFrom, "invalid_pack");
	if (normalized.effectiveTo !== undefined && parseTime(normalized.effectiveTo, "invalid_pack") <= effectiveFrom) {
		invalidPack("Context Pack effective window is invalid");
	}
	return normalized;
}

export function exportContextPack(value: unknown): string {
	const normalized = normalizeContextPack(value);
	const serialized = JSON.stringify(normalized);
	if (serialized === undefined) invalidPack("Context Pack export failed");
	return serialized;
}

export function importContextPack(serialized: unknown): ContextPack {
	if (typeof serialized !== "string") invalidJson();
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		invalidJson();
	}
	return normalizeContextPack(value);
}

export function evaluateContextPack(value: unknown, at: unknown): ContextPackAvailability {
	let pack: ContextPack;
	try {
		pack = normalizeContextPack(value);
	} catch {
		return { status: "blocked", reason: "invalid_pack" };
	}
	if (!isContract(DateTimeSchema, at)) return { status: "blocked", reason: "invalid_time" };
	const atTime = parseTime(at, "invalid_time");

	switch (pack.status) {
		case "draft":
			return { status: "blocked", reason: "draft" };
		case "in_review":
			return { status: "blocked", reason: "in_review" };
		case "revoked":
			return { status: "blocked", reason: "revoked" };
		case "expired":
			return { status: "blocked", reason: "expired" };
		case "rolled_back":
			return { status: "blocked", reason: "rolled_back" };
		case "published":
			break;
		default:
			return { status: "blocked", reason: "invalid_pack" };
	}

	if (atTime < parseTime(pack.effectiveFrom, "invalid_time")) {
		return { status: "blocked", reason: "not_yet_effective" };
	}
	if (pack.effectiveTo !== undefined && atTime >= parseTime(pack.effectiveTo, "invalid_time")) {
		return { status: "blocked", reason: "expired" };
	}
	if (pack.freshness.status === "expired") return { status: "blocked", reason: "freshness_expired" };
	const warnings: ContextPackAvailabilityWarning[] = [];
	if (pack.freshness.status === "stale") warnings.push("freshness_stale");
	if (pack.freshness.status === "unknown") warnings.push("freshness_unknown");
	return { status: "available", warnings };
}
