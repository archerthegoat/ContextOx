import { normalizeSourceBinding } from "./binding.ts";
import { type ContextPackAvailabilityWarning, evaluateContextPack, normalizeContextPack } from "./context-pack.ts";
import {
	type ContextPack,
	type ContextResource,
	isContract,
	type PermissionRef,
	ResourceIdSchema,
	type SourceBinding,
	type VersionId,
	VersionIdSchema,
} from "./contracts.ts";

export type ContextMatchCandidateKind = "source_binding" | "term" | "data_dictionary" | "document";

export type ContextMatchCandidateLabelKind = "label" | "physical_name";

export interface ContextMatchCandidateRef {
	readonly kind: ContextMatchCandidateKind;
	readonly id: string;
	readonly version: VersionId;
}

export interface ContextMatchCandidate {
	readonly ref: ContextMatchCandidateRef;
	readonly label: string;
	readonly labelKind: ContextMatchCandidateLabelKind;
	readonly aliases: readonly string[];
	readonly permissionRefs: readonly PermissionRef[];
}

export interface ContextMatchPackRef {
	readonly kind: "context_pack";
	readonly id: string;
	readonly version: VersionId;
}

export interface ContextMatchCatalog {
	readonly packRef: ContextMatchPackRef;
	readonly warnings: readonly ContextMatchWarning[];
	readonly candidates: readonly ContextMatchCandidate[];
}

export interface ContextMatchCatalogInput {
	readonly pack: unknown;
	readonly bindings: readonly unknown[];
	readonly at: unknown;
}

export type ContextMatchWarning = ContextPackAvailabilityWarning | "vector_unavailable";

export type ContextMatchCatalogResult =
	| { readonly status: "ready"; readonly catalog: ContextMatchCatalog }
	| { readonly status: "blocked"; readonly reason: "invalid_context" };

export interface VectorMatchRequest {
	readonly query: string;
	readonly candidates: readonly Pick<ContextMatchCandidate, "ref" | "label" | "aliases">[];
}

export interface VectorMatchScore {
	readonly candidate: ContextMatchCandidateRef;
	readonly score: number;
}

export interface VectorMatchAdapter {
	retrieve(request: VectorMatchRequest): readonly VectorMatchScore[];
}

export interface VectorMatchSuggestion {
	readonly candidate: ContextMatchCandidate;
	readonly score: number;
}

export type ContextMatchNotFoundReason = "no_deterministic_match" | "vector_empty" | "vector_unavailable";

export type ContextMatchAmbiguityReason = "ambiguous_id" | "ambiguous_label" | "ambiguous_alias_or_physical_name";

export type ContextMatchResult =
	| {
			readonly status: "matched";
			readonly candidate: ContextMatchCandidate;
			readonly matchKind: "id" | "label" | "alias" | "physical_name";
			readonly warnings: readonly ContextMatchWarning[];
	  }
	| {
			readonly status: "clarification_required";
			readonly reason: ContextMatchAmbiguityReason;
			readonly candidates: readonly ContextMatchCandidate[];
			readonly warnings: readonly ContextMatchWarning[];
	  }
	| {
			readonly status: "not_found";
			readonly reason: ContextMatchNotFoundReason;
			readonly warnings: readonly ContextMatchWarning[];
	  }
	| {
			readonly status: "suggested";
			readonly authoritative: false;
			readonly suggestions: readonly VectorMatchSuggestion[];
			readonly warnings: readonly ContextMatchWarning[];
	  }
	| {
			readonly status: "blocked";
			readonly reason: "invalid_context" | "invalid_request" | "invalid_vector_result";
	  };

type MatchTier = "id" | "label" | "alias_or_physical_name";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeMatchText(value: string): string {
	return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function candidateRefKey(ref: ContextMatchCandidateRef): string {
	return `${ref.kind}\u0000${ref.id}\u0000${ref.version}`;
}

function bindingRefKey(bindingId: string, version: VersionId): string {
	return `source_binding\u0000${bindingId}\u0000${version}`;
}

function candidateSortKey(candidate: ContextMatchCandidate): string {
	return candidateRefKey(candidate.ref);
}

function clonePermission(permission: PermissionRef): PermissionRef {
	return { policyId: permission.policyId, policyVersion: permission.policyVersion };
}

function clonePermissions(permissions: readonly PermissionRef[]): PermissionRef[] {
	return permissions.map(clonePermission);
}

function normalizeCandidateAliases(aliases: readonly string[]): string[] {
	const byKey = new Map<string, string>();
	for (const alias of aliases) {
		const key = normalizeMatchText(alias);
		if (key.length === 0) throw new Error("Empty normalized context alias");
		const existing = byKey.get(key);
		if (existing === undefined || compareStrings(alias, existing) < 0) byKey.set(key, alias);
	}
	return [...byKey.values()].sort(compareStrings);
}

function createCandidate(
	ref: ContextMatchCandidateRef,
	label: string,
	labelKind: ContextMatchCandidateLabelKind,
	aliases: readonly string[],
	permissionRefs: readonly PermissionRef[],
): ContextMatchCandidate {
	if (normalizeMatchText(label).length === 0) throw new Error("Empty normalized context label");
	return {
		ref,
		label,
		labelKind,
		aliases: normalizeCandidateAliases(aliases),
		permissionRefs: clonePermissions(permissionRefs),
	};
}

function candidateFromBinding(binding: SourceBinding): ContextMatchCandidate {
	return createCandidate(
		{ kind: "source_binding", id: binding.bindingId, version: binding.version },
		binding.subject.label,
		"label",
		[],
		[binding.permission],
	);
}

function candidateFromResource(resource: ContextResource, pack: ContextPack): ContextMatchCandidate {
	switch (resource.type) {
		case "term":
			return createCandidate(
				{ kind: "term", id: resource.resourceId, version: pack.version },
				resource.label,
				"label",
				resource.aliases,
				pack.permissions,
			);
		case "data_dictionary":
			return createCandidate(
				{ kind: "data_dictionary", id: resource.resourceId, version: pack.version },
				resource.physicalName,
				"physical_name",
				[],
				pack.permissions,
			);
		case "document":
			return createCandidate(
				{ kind: "document", id: resource.resourceId, version: pack.version },
				resource.title,
				"label",
				[],
				pack.permissions,
			);
		default:
			throw new Error("Unsupported context resource type");
	}
}

function isCandidateKind(value: unknown): value is ContextMatchCandidateKind {
	return value === "source_binding" || value === "term" || value === "data_dictionary" || value === "document";
}

function readCandidateRef(value: unknown): ContextMatchCandidateRef | undefined {
	if (!isRecord(value)) return undefined;
	if (!isCandidateKind(value.kind)) return undefined;
	if (!isContract(ResourceIdSchema, value.id)) return undefined;
	if (!isContract(VersionIdSchema, value.version)) return undefined;
	return { kind: value.kind, id: value.id, version: value.version };
}

function uniqueCandidates(values: readonly ContextMatchCandidate[]): ContextMatchCandidate[] {
	const unique = new Map<string, ContextMatchCandidate>();
	for (const candidate of values) unique.set(candidateRefKey(candidate.ref), candidate);
	return [...unique.values()].sort((left, right) => compareStrings(candidateSortKey(left), candidateSortKey(right)));
}

function warningsForCatalog(catalog: ContextMatchCatalog): ContextMatchWarning[] {
	return [...catalog.warnings];
}

function resultForDeterministicMatches(
	candidates: readonly ContextMatchCandidate[],
	tier: MatchTier,
	warnings: readonly ContextMatchWarning[],
): ContextMatchResult {
	const unique = uniqueCandidates(candidates);
	if (unique.length !== 1) {
		const reason: ContextMatchAmbiguityReason =
			tier === "id" ? "ambiguous_id" : tier === "label" ? "ambiguous_label" : "ambiguous_alias_or_physical_name";
		return { status: "clarification_required", reason, candidates: unique, warnings };
	}
	const candidate = unique[0];
	if (candidate === undefined) return { status: "not_found", reason: "no_deterministic_match", warnings };
	const matchKind =
		tier === "id"
			? "id"
			: tier === "label"
				? "label"
				: candidate.labelKind === "physical_name"
					? "physical_name"
					: "alias";
	return { status: "matched", candidate, matchKind, warnings };
}

function addLookup(lookup: Map<string, ContextMatchCandidate[]>, key: string, candidate: ContextMatchCandidate): void {
	const group = lookup.get(key) ?? [];
	group.push(candidate);
	lookup.set(key, group);
}

function findVectorSuggestions(
	catalog: ContextMatchCatalog,
	query: string,
	adapter: VectorMatchAdapter,
): ContextMatchResult {
	const warnings = warningsForCatalog(catalog);
	if (typeof adapter.retrieve !== "function") return { status: "blocked", reason: "invalid_vector_result" };
	const candidateByKey = new Map(catalog.candidates.map((candidate) => [candidateRefKey(candidate.ref), candidate]));
	let rawScores: unknown;
	try {
		rawScores = adapter.retrieve({
			query,
			candidates: catalog.candidates.map(({ ref, label, aliases }) => ({
				ref: { ...ref },
				label,
				aliases: [...aliases],
			})),
		});
	} catch {
		return { status: "not_found", reason: "vector_unavailable", warnings: [...warnings, "vector_unavailable"] };
	}
	if (!isUnknownArray(rawScores)) return { status: "blocked", reason: "invalid_vector_result" };

	const seen = new Set<string>();
	const suggestions: VectorMatchSuggestion[] = [];
	for (const rawScore of rawScores) {
		if (!isRecord(rawScore)) return { status: "blocked", reason: "invalid_vector_result" };
		const ref = readCandidateRef(rawScore.candidate);
		if (ref === undefined || typeof rawScore.score !== "number" || !Number.isFinite(rawScore.score)) {
			return { status: "blocked", reason: "invalid_vector_result" };
		}
		if (rawScore.score < 0 || rawScore.score > 1) return { status: "blocked", reason: "invalid_vector_result" };
		const key = candidateRefKey(ref);
		const candidate = candidateByKey.get(key);
		if (candidate === undefined || seen.has(key)) return { status: "blocked", reason: "invalid_vector_result" };
		seen.add(key);
		suggestions.push({ candidate, score: rawScore.score });
	}

	if (suggestions.length === 0) return { status: "not_found", reason: "vector_empty", warnings };
	suggestions.sort((left, right) => {
		const scoreOrder = right.score - left.score;
		return scoreOrder === 0
			? compareStrings(candidateSortKey(left.candidate), candidateSortKey(right.candidate))
			: scoreOrder;
	});
	return {
		status: "suggested",
		authoritative: false,
		suggestions: suggestions.slice(0, 5),
		warnings,
	};
}

function isValidCatalogInput(value: unknown): value is ContextMatchCatalogInput {
	return isRecord(value) && isUnknownArray(value.bindings) && "at" in value;
}

export function buildContextMatchCatalog(value: unknown): ContextMatchCatalogResult {
	if (!isValidCatalogInput(value)) return { status: "blocked", reason: "invalid_context" };

	let pack: ContextPack;
	try {
		pack = normalizeContextPack(value.pack);
	} catch {
		return { status: "blocked", reason: "invalid_context" };
	}
	const availability = evaluateContextPack(pack, value.at);
	if (availability.status !== "available") return { status: "blocked", reason: "invalid_context" };

	const bindingsByRef = new Map<string, SourceBinding>();
	for (const rawBinding of value.bindings) {
		let binding: SourceBinding;
		try {
			binding = normalizeSourceBinding(rawBinding);
		} catch {
			return { status: "blocked", reason: "invalid_context" };
		}
		const key = bindingRefKey(binding.bindingId, binding.version);
		if (bindingsByRef.has(key)) return { status: "blocked", reason: "invalid_context" };
		bindingsByRef.set(key, binding);
	}

	const candidates: ContextMatchCandidate[] = [];
	try {
		const bindingIds = new Set<string>();
		for (const bindingRef of pack.bindings) {
			if (bindingIds.has(bindingRef.id)) return { status: "blocked", reason: "invalid_context" };
			bindingIds.add(bindingRef.id);
			const binding = bindingsByRef.get(bindingRefKey(bindingRef.id, bindingRef.version));
			if (binding === undefined || binding.status !== "published") {
				return { status: "blocked", reason: "invalid_context" };
			}
			candidates.push(candidateFromBinding(binding));
		}
		for (const resource of pack.resources) candidates.push(candidateFromResource(resource, pack));
	} catch {
		return { status: "blocked", reason: "invalid_context" };
	}

	candidates.sort((left, right) => compareStrings(candidateSortKey(left), candidateSortKey(right)));
	return {
		status: "ready",
		catalog: {
			packRef: { kind: "context_pack", id: pack.packId, version: pack.version },
			warnings: [...availability.warnings],
			candidates,
		},
	};
}

function readQuery(value: unknown): string | undefined {
	if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.query !== "string") return undefined;
	if (value.query.trim().length === 0) return undefined;
	return value.query;
}

export function matchContext(
	context: unknown,
	request: unknown,
	vectorAdapter?: VectorMatchAdapter,
): ContextMatchResult {
	const catalogResult = buildContextMatchCatalog(context);
	if (catalogResult.status !== "ready") return catalogResult;
	const query = readQuery(request);
	if (query === undefined) return { status: "blocked", reason: "invalid_request" };

	const idMatches = catalogResult.catalog.candidates.filter((candidate) => candidate.ref.id === query);
	if (idMatches.length > 0) return resultForDeterministicMatches(idMatches, "id", catalogResult.catalog.warnings);

	const normalizedQuery = normalizeMatchText(query);
	const labelLookup = new Map<string, ContextMatchCandidate[]>();
	const aliasLookup = new Map<string, ContextMatchCandidate[]>();
	for (const candidate of catalogResult.catalog.candidates) {
		if (candidate.labelKind === "label") addLookup(labelLookup, normalizeMatchText(candidate.label), candidate);
		for (const alias of candidate.aliases) addLookup(aliasLookup, normalizeMatchText(alias), candidate);
	}
	const labelMatches = labelLookup.get(normalizedQuery) ?? [];
	if (labelMatches.length > 0)
		return resultForDeterministicMatches(labelMatches, "label", catalogResult.catalog.warnings);
	const aliasMatches = aliasLookup.get(normalizedQuery) ?? [];
	const physicalNameMatches = catalogResult.catalog.candidates.filter(
		(candidate) => candidate.labelKind === "physical_name" && normalizeMatchText(candidate.label) === normalizedQuery,
	);
	const alternativeMatches = uniqueCandidates([...aliasMatches, ...physicalNameMatches]);
	if (alternativeMatches.length > 0) {
		return resultForDeterministicMatches(
			alternativeMatches,
			"alias_or_physical_name",
			catalogResult.catalog.warnings,
		);
	}
	if (vectorAdapter === undefined) {
		return { status: "not_found", reason: "no_deterministic_match", warnings: catalogResult.catalog.warnings };
	}
	return findVectorSuggestions(catalogResult.catalog, normalizedQuery, vectorAdapter);
}
