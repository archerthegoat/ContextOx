import { createHash } from "node:crypto";
import Type, { type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import type { CompiledQuery } from "./compiler.ts";
import {
	DateTimeSchema,
	FreshnessSchema,
	PermissionRefSchema,
	ResourceIdSchema,
	VersionIdSchema,
} from "./contracts.ts";
import { ANALYSIS_CONTRACT_VERSION, type ContextPackRef } from "./plan.ts";
import { normalizeResultEnvelope, type ResultEnvelope, ResultLineageSchema } from "./results.ts";

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
export type AnalysisPlanRef = Static<typeof AnalysisPlanRefSchema>;

const ResultRefSchema = strictObject({
	resultId: ResourceIdSchema,
	resultVersion: VersionIdSchema,
});
export type ResultRef = Static<typeof ResultRefSchema>;

const EvidenceStatusSchema = Type.Union([Type.Literal("complete"), Type.Literal("partial"), Type.Literal("blocked")]);
export type EvidenceStatus = Static<typeof EvidenceStatusSchema>;

export const EvidenceWarningCodeSchema = Type.Union([
	Type.Literal("freshness_stale"),
	Type.Literal("freshness_unknown"),
	Type.Literal("result_truncated"),
	Type.Literal("privacy_minimized"),
	Type.Literal("partial_result"),
]);
export type EvidenceWarningCode = Static<typeof EvidenceWarningCodeSchema>;

export const EvidenceErrorCodeSchema = Type.Union([
	Type.Literal("result_not_ready"),
	Type.Literal("partial_result"),
	Type.Literal("integrity_failed"),
	Type.Literal("privacy_blocked"),
	Type.Literal("source_untraceable"),
	Type.Literal("invalid_contract"),
]);
export type EvidenceErrorCode = Static<typeof EvidenceErrorCodeSchema>;

const EvidenceErrorSchema = strictObject({ code: EvidenceErrorCodeSchema });
export type EvidenceError = Static<typeof EvidenceErrorSchema>;

const EvidencePolicyDecisionSchema = strictObject({
	permission: PermissionRefSchema,
	resource: strictObject({
		kind: Type.Union([Type.Literal("query_plan"), Type.Literal("binding_execution_spec")]),
		id: ResourceIdSchema,
		version: VersionIdSchema,
	}),
	decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("unknown")]),
});
export type EvidencePolicyDecision = Static<typeof EvidencePolicyDecisionSchema>;

const ParameterSummarySchema = strictObject({
	index: Type.Integer({ minimum: 1 }),
	role: Type.Union([Type.Literal("filter"), Type.Literal("time_range"), Type.Literal("limit")]),
	type: Type.Union([Type.Literal("string"), Type.Literal("number"), Type.Literal("boolean"), Type.Literal("null")]),
});
export type ParameterSummary = Static<typeof ParameterSummarySchema>;

const EvidenceQuerySchema = strictObject({
	queryDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
	parameterSummary: Type.Array(ParameterSummarySchema),
	readOnly: Type.Literal(true),
});
export type EvidenceQuery = Static<typeof EvidenceQuerySchema>;

const EvidenceObservationSchema = strictObject({
	kind: Type.Union([
		Type.Literal("row_count"),
		Type.Literal("returned_count"),
		Type.Literal("estimated_rows"),
		Type.Literal("estimated_bytes"),
		Type.Literal("truncated"),
	]),
	value: Type.Union([Type.Integer({ minimum: 0 }), Type.Boolean()]),
});
export type EvidenceObservation = Static<typeof EvidenceObservationSchema>;

const EvidenceTransformationSchema = strictObject({
	stepId: ResourceIdSchema,
	operation: Type.Union([
		Type.Literal("project"),
		Type.Literal("aggregate"),
		Type.Literal("sort"),
		Type.Literal("limit"),
		Type.Literal("redact"),
		Type.Literal("truncate"),
	]),
});
export type EvidenceTransformation = Static<typeof EvidenceTransformationSchema>;

const IntegritySchema = strictObject({
	status: Type.Union([Type.Literal("complete"), Type.Literal("incomplete"), Type.Literal("failed")]),
	digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
});
export type EvidenceIntegrity = Static<typeof IntegritySchema>;

export const EvidenceEnvelopeSchema = Type.Object(
	{
		contractVersion: Type.Literal(ANALYSIS_CONTRACT_VERSION),
		kind: Type.Literal("evidence_envelope"),
		evidenceId: ResourceIdSchema,
		evidenceVersion: VersionIdSchema,
		runId: ResourceIdSchema,
		planRef: AnalysisPlanRefSchema,
		stepId: ResourceIdSchema,
		result: ResultRefSchema,
		contextPack: ContextPackRefSchema,
		lineage: ResultLineageSchema,
		asOf: DateTimeSchema,
		freshness: FreshnessSchema,
		query: Type.Optional(EvidenceQuerySchema),
		policyDecisions: Type.Array(EvidencePolicyDecisionSchema),
		observations: Type.Array(EvidenceObservationSchema),
		transformations: Type.Array(EvidenceTransformationSchema),
		upstreamResultRefs: Type.Array(ResultRefSchema),
		status: EvidenceStatusSchema,
		warnings: Type.Array(EvidenceWarningCodeSchema),
		errors: Type.Array(EvidenceErrorSchema),
		integrity: IntegritySchema,
	},
	{ additionalProperties: false, ...schemaOptions("evidence-envelope.schema.json") },
);
export type EvidenceEnvelope = Static<typeof EvidenceEnvelopeSchema>;

export class EvidenceConstructionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EvidenceConstructionError";
	}
}

export interface EvidenceBuildInput {
	readonly evidenceId: string;
	readonly evidenceVersion: string;
	readonly planRef: AnalysisPlanRef;
	readonly contextPack: ContextPackRef;
	readonly result: ResultEnvelope;
	readonly compiledQuery?: CompiledQuery;
	readonly policyDecisions: readonly EvidencePolicyDecision[];
	readonly observations?: readonly EvidenceObservation[];
	readonly transformations?: readonly EvidenceTransformation[];
	readonly upstreamResultRefs?: readonly ResultRef[];
}

type EvidencePayload = Omit<EvidenceEnvelope, "integrity">;

function assertSchema<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	message: string,
): Static<TSchemaType> {
	if (!Check(schema, value)) throw new EvidenceConstructionError(message);
	return value as Static<TSchemaType>;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizeLineage(lineage: ResultEnvelope["lineage"]): ResultEnvelope["lineage"] {
	return {
		source: { sourceId: lineage.source.sourceId, version: lineage.source.version },
		snapshot: { kind: "source_snapshot", id: lineage.snapshot.id, version: lineage.snapshot.version },
		binding: { kind: "source_binding", id: lineage.binding.id, version: lineage.binding.version },
		executionSpec: {
			kind: "binding_execution_spec",
			id: lineage.executionSpec.id,
			version: lineage.executionSpec.version,
		},
	};
}

function normalizePolicyDecisions(values: readonly EvidencePolicyDecision[]): EvidencePolicyDecision[] {
	const byKey = new Map<string, EvidencePolicyDecision>();
	for (const value of values) {
		const key = `${value.permission.policyId}\u0000${value.permission.policyVersion}\u0000${value.resource.kind}\u0000${value.resource.id}\u0000${value.resource.version}`;
		if (byKey.has(key)) throw new EvidenceConstructionError("Duplicate policy decision reference");
		byKey.set(key, {
			permission: { policyId: value.permission.policyId, policyVersion: value.permission.policyVersion },
			resource: { kind: value.resource.kind, id: value.resource.id, version: value.resource.version },
			decision: value.decision,
		});
	}
	return [...byKey.values()].sort((left, right) =>
		compareStrings(
			`${left.permission.policyId}\u0000${left.permission.policyVersion}\u0000${left.resource.kind}\u0000${left.resource.id}\u0000${left.resource.version}`,
			`${right.permission.policyId}\u0000${right.permission.policyVersion}\u0000${right.resource.kind}\u0000${right.resource.id}\u0000${right.resource.version}`,
		),
	);
}

function normalizeObservations(values: readonly EvidenceObservation[]): EvidenceObservation[] {
	const byKind = new Map<string, EvidenceObservation>();
	for (const value of values) {
		if (byKind.has(value.kind)) throw new EvidenceConstructionError("Duplicate evidence observation");
		byKind.set(value.kind, { kind: value.kind, value: value.value });
	}
	return [...byKind.values()].sort((left, right) => compareStrings(left.kind, right.kind));
}

function normalizeTransformations(values: readonly EvidenceTransformation[]): EvidenceTransformation[] {
	const keys = values.map((value) => `${value.stepId}\u0000${value.operation}`);
	if (new Set(keys).size !== keys.length) throw new EvidenceConstructionError("Duplicate evidence transformation");
	return values.map((value) => ({ stepId: value.stepId, operation: value.operation }));
}

function normalizeResultRefs(values: readonly ResultRef[]): ResultRef[] {
	const refs = values.map((value) => ({ resultId: value.resultId, resultVersion: value.resultVersion }));
	const keys = refs.map((value) => `${value.resultId}\u0000${value.resultVersion}`);
	if (new Set(keys).size !== keys.length) throw new EvidenceConstructionError("Duplicate upstream result reference");
	return refs.sort((left, right) =>
		compareStrings(`${left.resultId}\u0000${left.resultVersion}`, `${right.resultId}\u0000${right.resultVersion}`),
	);
}

function normalizeWarnings(values: readonly EvidenceWarningCode[]): EvidenceWarningCode[] {
	return [...new Set(values)].sort(compareStrings);
}

function normalizeErrors(values: readonly EvidenceError[]): EvidenceError[] {
	return [...new Map(values.map((value) => [value.code, { code: value.code }])).values()].sort((left, right) =>
		compareStrings(left.code, right.code),
	);
}

function normalizeQuery(query: EvidenceQuery): EvidenceQuery {
	const parameterSummary = [...query.parameterSummary].sort((left, right) => left.index - right.index);
	for (let index = 1; index < parameterSummary.length; index += 1) {
		if (parameterSummary[index - 1].index === parameterSummary[index].index) {
			throw new EvidenceConstructionError("Duplicate query parameter index");
		}
	}
	return {
		queryDigest: query.queryDigest,
		parameterSummary,
		readOnly: true,
	};
}

function canonicalize(value: EvidenceEnvelope): EvidencePayload {
	const query = value.query === undefined ? undefined : normalizeQuery(value.query);
	return {
		contractVersion: value.contractVersion,
		kind: "evidence_envelope",
		evidenceId: value.evidenceId,
		evidenceVersion: value.evidenceVersion,
		runId: value.runId,
		planRef: { kind: "analysis_plan", id: value.planRef.id, version: value.planRef.version },
		stepId: value.stepId,
		result: { resultId: value.result.resultId, resultVersion: value.result.resultVersion },
		contextPack: { kind: "context_pack", id: value.contextPack.id, version: value.contextPack.version },
		lineage: normalizeLineage(value.lineage),
		asOf: value.asOf,
		freshness: {
			asOf: value.freshness.asOf,
			checkedAt: value.freshness.checkedAt,
			status: value.freshness.status,
			...(value.freshness.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: value.freshness.maxAgeSeconds }),
		},
		...(query === undefined ? {} : { query }),
		policyDecisions: normalizePolicyDecisions(value.policyDecisions),
		observations: normalizeObservations(value.observations),
		transformations: normalizeTransformations(value.transformations),
		upstreamResultRefs: normalizeResultRefs(value.upstreamResultRefs),
		status: value.status,
		warnings: normalizeWarnings(value.warnings),
		errors: normalizeErrors(value.errors),
	};
}

export function normalizeEvidenceEnvelope(value: unknown): EvidenceEnvelope {
	const parsed = assertSchema(EvidenceEnvelopeSchema, value, "Invalid EvidenceEnvelope contract");
	const payload = canonicalize(parsed);
	if (parsed.integrity.digest !== digest(payload))
		throw new EvidenceConstructionError("Evidence integrity digest mismatch");
	if (parsed.status === "complete" && (parsed.integrity.status !== "complete" || payload.errors.length > 0)) {
		throw new EvidenceConstructionError("Complete evidence must have complete integrity and no errors");
	}
	if (parsed.status === "partial" && parsed.integrity.status !== "incomplete") {
		throw new EvidenceConstructionError("Partial evidence must have incomplete integrity");
	}
	if (parsed.status === "blocked" && parsed.integrity.status !== "failed") {
		throw new EvidenceConstructionError("Blocked evidence must have failed integrity");
	}
	return { ...payload, integrity: { status: parsed.integrity.status, digest: parsed.integrity.digest } };
}

function resultWarnings(result: ResultEnvelope): EvidenceWarningCode[] {
	const warnings: EvidenceWarningCode[] = [];
	for (const warning of result.warnings) {
		if (warning.code === "partial_failure") warnings.push("partial_result");
		else warnings.push(warning.code);
	}
	if (result.status === "partial") warnings.push("partial_result");
	return warnings;
}

function resultErrors(result: ResultEnvelope): EvidenceError[] {
	if (result.errors.some((error) => error.code === "privacy_blocked")) return [{ code: "privacy_blocked" }];
	return result.status === "partial" ? [{ code: "partial_result" }] : [];
}

function defaultObservations(result: ResultEnvelope, compiledQuery: CompiledQuery | undefined): EvidenceObservation[] {
	const observations: EvidenceObservation[] = [
		{ kind: "row_count", value: result.rowCount },
		{ kind: "returned_count", value: result.returnedCount },
		{ kind: "truncated", value: result.truncated },
	];
	if (compiledQuery !== undefined) {
		observations.push(
			{ kind: "estimated_rows", value: compiledQuery.estimatedRows },
			{ kind: "estimated_bytes", value: compiledQuery.estimatedBytes },
		);
	}
	return observations;
}

export function createEvidenceEnvelope(input: EvidenceBuildInput): EvidenceEnvelope {
	const result = normalizeResultEnvelope(input.result);
	if (!result.canEvidence || result.status === "blocked" || result.status === "clarification_required") {
		throw new EvidenceConstructionError("Result is not ready for evidence");
	}
	const query =
		input.compiledQuery === undefined
			? undefined
			: {
					queryDigest: input.compiledQuery.queryDigest,
					parameterSummary: input.compiledQuery.parameters.map((parameter) => ({
						index: parameter.index,
						role: parameter.role,
						type: parameter.type,
					})),
					readOnly: true as const,
				};
	const status: EvidenceStatus = result.status === "partial" ? "partial" : "complete";
	const integrityStatus = status === "complete" ? "complete" : "incomplete";
	const withoutIntegrity = {
		contractVersion: ANALYSIS_CONTRACT_VERSION,
		kind: "evidence_envelope" as const,
		evidenceId: input.evidenceId,
		evidenceVersion: input.evidenceVersion,
		runId: result.runId,
		planRef: input.planRef,
		stepId: result.stepId,
		result: { resultId: result.resultId, resultVersion: result.resultVersion },
		contextPack: input.contextPack,
		lineage: result.lineage,
		asOf: result.asOf,
		freshness: result.freshness,
		...(query === undefined ? {} : { query }),
		policyDecisions: [...input.policyDecisions],
		observations: [...defaultObservations(result, input.compiledQuery), ...(input.observations ?? [])],
		transformations: [...(input.transformations ?? [])],
		upstreamResultRefs: [...(input.upstreamResultRefs ?? [])],
		status,
		warnings: resultWarnings(result),
		errors: resultErrors(result),
	};
	const canonicalPayload = canonicalize({
		...withoutIntegrity,
		integrity: { status: integrityStatus, digest: digest(withoutIntegrity) },
	});
	const integrity = { status: integrityStatus, digest: digest(canonicalPayload) } as const;
	return normalizeEvidenceEnvelope({ ...withoutIntegrity, integrity });
}
