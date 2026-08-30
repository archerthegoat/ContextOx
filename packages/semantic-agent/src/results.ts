import Type, { type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import {
	DateTimeSchema,
	type Freshness,
	FreshnessSchema,
	type ResourceId,
	ResourceIdSchema,
	SourceRefSchema,
	VersionIdSchema,
} from "./contracts.ts";
import {
	ANALYSIS_CONTRACT_VERSION,
	BindingExecutionSpecRefSchema,
	ColumnRefSchema,
	type ScalarValue,
	SourceBindingRefSchema,
	SourceSnapshotRefSchema,
} from "./plan.ts";

const strictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

const schemaOptions = (id: string) => ({
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://alphaox.dev/schemas/${id}`,
});

export const ResultStatusSchema = Type.Union([
	Type.Literal("complete"),
	Type.Literal("partial"),
	Type.Literal("blocked"),
	Type.Literal("clarification_required"),
]);
export type ResultStatus = Static<typeof ResultStatusSchema>;

export const ResultColumnSchema = strictObject({
	columnId: ResourceIdSchema,
	label: Type.String({ minLength: 1, maxLength: 200 }),
	dataType: Type.String({ minLength: 1, maxLength: 128 }),
	nullable: Type.Boolean(),
	source: Type.Optional(ColumnRefSchema),
});
export type ResultColumn = Static<typeof ResultColumnSchema>;

export const ResultLineageSchema = strictObject({
	source: SourceRefSchema,
	snapshot: SourceSnapshotRefSchema,
	binding: SourceBindingRefSchema,
	executionSpec: BindingExecutionSpecRefSchema,
});
export type ResultLineage = Static<typeof ResultLineageSchema>;

export const MinimizationRuleRefSchema = strictObject({
	ruleId: ResourceIdSchema,
	version: VersionIdSchema,
});
export type MinimizationRuleRef = Static<typeof MinimizationRuleRefSchema>;

export const ResultMinimizationSchema = strictObject({
	ruleRefs: Type.Array(MinimizationRuleRefSchema),
	removedColumnIds: Type.Array(ResourceIdSchema),
	applied: Type.Boolean(),
});
export type ResultMinimization = Static<typeof ResultMinimizationSchema>;

export const ResultWarningCodeSchema = Type.Union([
	Type.Literal("freshness_stale"),
	Type.Literal("freshness_unknown"),
	Type.Literal("result_truncated"),
	Type.Literal("privacy_minimized"),
	Type.Literal("partial_failure"),
]);
export type ResultWarningCode = Static<typeof ResultWarningCodeSchema>;

export const ResultWarningSchema = strictObject({ code: ResultWarningCodeSchema });
export type ResultWarning = Static<typeof ResultWarningSchema>;

export const ResultErrorCodeSchema = Type.Union([
	Type.Literal("invalid_result"),
	Type.Literal("cancelled"),
	Type.Literal("deadline_exceeded"),
	Type.Literal("executor_failed"),
	Type.Literal("budget_exceeded"),
	Type.Literal("privacy_blocked"),
	Type.Literal("evidence_failed"),
	Type.Literal("permission_denied"),
	Type.Literal("unknown_permission"),
	Type.Literal("freshness_expired"),
	Type.Literal("query_unsupported"),
	Type.Literal("invalid_contract"),
]);
export type ResultErrorCode = Static<typeof ResultErrorCodeSchema>;

export const ResultErrorSchema = strictObject({
	code: ResultErrorCodeSchema,
	retryable: Type.Boolean(),
});
export type ResultError = Static<typeof ResultErrorSchema>;

const ResultRowSchema = Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]), {
	maxItems: 1000,
});

export const ResultEnvelopeSchema = Type.Object(
	{
		contractVersion: Type.Literal(ANALYSIS_CONTRACT_VERSION),
		kind: Type.Literal("result_envelope"),
		resultId: ResourceIdSchema,
		resultVersion: VersionIdSchema,
		runId: ResourceIdSchema,
		stepId: ResourceIdSchema,
		status: ResultStatusSchema,
		columns: Type.Array(ResultColumnSchema, { maxItems: 1000 }),
		rows: Type.Array(ResultRowSchema, { maxItems: 10000 }),
		rowCount: Type.Integer({ minimum: 0 }),
		returnedCount: Type.Integer({ minimum: 0 }),
		truncated: Type.Boolean(),
		lineage: ResultLineageSchema,
		asOf: DateTimeSchema,
		freshness: FreshnessSchema,
		minimization: ResultMinimizationSchema,
		warnings: Type.Array(ResultWarningSchema),
		errors: Type.Array(ResultErrorSchema),
		canTransform: Type.Boolean(),
		canEvidence: Type.Boolean(),
	},
	{ additionalProperties: false, ...schemaOptions("result-envelope.schema.json") },
);
export type ResultEnvelope = Static<typeof ResultEnvelopeSchema>;

export class ResultEnvelopeValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ResultEnvelopeValidationError";
	}
}

export type ResultMinimizationErrorCode = "invalid_candidate" | "privacy_blocked" | "budget_exceeded";

export interface ResultCandidate {
	readonly columns: readonly ResultColumn[];
	readonly rows: readonly (readonly ScalarValue[])[];
	readonly rowCount: number;
}

export interface ResultMinimizationPolicy {
	readonly ruleRefs: readonly MinimizationRuleRef[];
	readonly allowedColumnIds: readonly ResourceId[];
	readonly maxRows: number;
	readonly maxBytes: number;
}

export type ResultMinimizationResult =
	| {
			readonly status: "ready";
			readonly columns: readonly ResultColumn[];
			readonly rows: readonly (readonly ScalarValue[])[];
			readonly rowCount: number;
			readonly returnedCount: number;
			readonly truncated: boolean;
			readonly ruleRefs: readonly MinimizationRuleRef[];
			readonly removedColumnIds: readonly ResourceId[];
			readonly warnings: readonly ResultWarningCode[];
	  }
	| { readonly status: "blocked"; readonly reason: ResultMinimizationErrorCode };

export type ReadyResultMinimization = Extract<ResultMinimizationResult, { readonly status: "ready" }>;

export interface ResultEnvelopeBuildInput {
	readonly resultId: ResourceId;
	readonly resultVersion: string;
	readonly runId: ResourceId;
	readonly stepId: ResourceId;
	readonly lineage: ResultLineage;
	readonly asOf: string;
	readonly freshness: Freshness;
	readonly minimized: ReadyResultMinimization;
	readonly errors?: readonly ResultError[];
	readonly warnings?: readonly ResultWarningCode[];
	readonly canTransform?: boolean;
	readonly canEvidence?: boolean;
}

export interface BlockedResultEnvelopeBuildInput {
	readonly resultId: ResourceId;
	readonly resultVersion: string;
	readonly runId: ResourceId;
	readonly stepId: ResourceId;
	readonly lineage: ResultLineage;
	readonly asOf: string;
	readonly freshness: Freshness;
	readonly error: ResultErrorCode;
	readonly warnings?: readonly ResultWarningCode[];
}

function assertSchema<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	message: string,
): Static<TSchemaType> {
	if (!Check(schema, value)) throw new ResultEnvelopeValidationError(message);
	return value as Static<TSchemaType>;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueStrings(values: readonly string[], label: string): string[] {
	const sorted = [...new Set(values)].sort(compareStrings);
	if (sorted.length !== values.length) throw new ResultEnvelopeValidationError(`Duplicate ${label}`);
	return sorted;
}

function normalizeWarnings(values: readonly ResultWarning[]): ResultWarning[] {
	const byCode = new Map<string, ResultWarning>();
	for (const warning of values) byCode.set(warning.code, { code: warning.code });
	return [...byCode.values()].sort((left, right) => compareStrings(left.code, right.code));
}

function normalizeErrors(values: readonly ResultError[]): ResultError[] {
	const byCode = new Map<string, ResultError>();
	for (const error of values) {
		const existing = byCode.get(error.code);
		if (existing !== undefined && existing.retryable !== error.retryable) {
			throw new ResultEnvelopeValidationError("Conflicting retryability for result error");
		}
		byCode.set(error.code, { code: error.code, retryable: error.retryable });
	}
	return [...byCode.values()].sort((left, right) => compareStrings(left.code, right.code));
}

function freshnessWarnings(freshness: Freshness): ResultWarningCode[] {
	if (freshness.status === "stale") return ["freshness_stale"];
	if (freshness.status === "unknown") return ["freshness_unknown"];
	return [];
}

function normalizeLineage(lineage: ResultLineage): ResultLineage {
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

function normalizeMinimization(value: ResultMinimization): ResultMinimization {
	const ruleKeys = value.ruleRefs.map((rule) => `${rule.ruleId}\u0000${rule.version}`);
	uniqueStrings(ruleKeys, "minimization rule");
	const removedColumnIds = uniqueStrings(value.removedColumnIds, "removed result column");
	const ruleRefs = [...value.ruleRefs]
		.map((rule) => ({ ruleId: rule.ruleId, version: rule.version }))
		.sort((left, right) =>
			compareStrings(`${left.ruleId}\u0000${left.version}`, `${right.ruleId}\u0000${right.version}`),
		);
	if (!value.applied && removedColumnIds.length > 0) {
		throw new ResultEnvelopeValidationError("Removed columns require an applied minimization");
	}
	return { ruleRefs, removedColumnIds, applied: value.applied };
}

export function normalizeResultEnvelope(value: unknown): ResultEnvelope {
	const parsed = assertSchema(ResultEnvelopeSchema, value, "Invalid ResultEnvelope contract");
	const columnIds = parsed.columns.map((column) => column.columnId);
	uniqueStrings(columnIds, "result column");
	for (const row of parsed.rows) {
		if (row.length !== parsed.columns.length)
			throw new ResultEnvelopeValidationError("Result row width does not match columns");
		if (row.some((value) => !isScalarValue(value))) {
			throw new ResultEnvelopeValidationError("Result rows must contain finite scalar values");
		}
	}
	if (parsed.returnedCount !== parsed.rows.length) {
		throw new ResultEnvelopeValidationError("Result returnedCount does not match rows");
	}
	if (parsed.returnedCount > parsed.rowCount)
		throw new ResultEnvelopeValidationError("Result returnedCount exceeds rowCount");
	if (parsed.truncated !== parsed.returnedCount < parsed.rowCount) {
		throw new ResultEnvelopeValidationError("Result truncation flag does not match counts");
	}
	const warnings = normalizeWarnings(parsed.warnings);
	const errors = normalizeErrors(parsed.errors);
	const minimization = normalizeMinimization(parsed.minimization);
	const warningCodes = new Set(warnings.map((warning) => warning.code));
	if (warningCodes.has("result_truncated") !== parsed.truncated) {
		throw new ResultEnvelopeValidationError("Result truncation warning does not match counts");
	}
	if (warningCodes.has("privacy_minimized") !== minimization.removedColumnIds.length > 0) {
		throw new ResultEnvelopeValidationError("Result privacy warning does not match minimization");
	}
	if (parsed.freshness.status === "stale" && !warningCodes.has("freshness_stale")) {
		throw new ResultEnvelopeValidationError("Stale result requires a freshness warning");
	}
	if (parsed.freshness.status === "unknown" && !warningCodes.has("freshness_unknown")) {
		throw new ResultEnvelopeValidationError("Unknown freshness requires a freshness warning");
	}
	if (parsed.freshness.status === "expired" && !errors.some((error) => error.code === "freshness_expired")) {
		throw new ResultEnvelopeValidationError("Expired result requires a freshness error");
	}
	if (warningCodes.has("partial_failure") && parsed.status !== "partial") {
		throw new ResultEnvelopeValidationError("Partial failure warning requires a partial result");
	}
	if (parsed.status === "complete" && (parsed.truncated || errors.length > 0)) {
		throw new ResultEnvelopeValidationError("Complete result cannot be truncated or contain errors");
	}
	if (parsed.status === "partial" && !parsed.truncated && errors.length === 0) {
		throw new ResultEnvelopeValidationError("Partial result requires truncation or an error");
	}
	if (parsed.status === "blocked" || parsed.status === "clarification_required") {
		if (parsed.rows.length > 0 || parsed.rowCount !== 0 || parsed.returnedCount !== 0) {
			throw new ResultEnvelopeValidationError("Blocked result cannot expose rows");
		}
		if (parsed.canTransform || parsed.canEvidence) {
			throw new ResultEnvelopeValidationError("Blocked result cannot be consumed downstream");
		}
	}
	return {
		contractVersion: parsed.contractVersion,
		kind: "result_envelope",
		resultId: parsed.resultId,
		resultVersion: parsed.resultVersion,
		runId: parsed.runId,
		stepId: parsed.stepId,
		status: parsed.status,
		columns: parsed.columns.map((column) => ({
			columnId: column.columnId,
			label: column.label,
			dataType: column.dataType,
			nullable: column.nullable,
			...(column.source === undefined
				? {}
				: { source: { tableId: column.source.tableId, columnId: column.source.columnId } }),
		})),
		rows: parsed.rows.map((row) => [...row]),
		rowCount: parsed.rowCount,
		returnedCount: parsed.returnedCount,
		truncated: parsed.truncated,
		lineage: normalizeLineage(parsed.lineage),
		asOf: parsed.asOf,
		freshness: {
			asOf: parsed.freshness.asOf,
			checkedAt: parsed.freshness.checkedAt,
			status: parsed.freshness.status,
			...(parsed.freshness.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: parsed.freshness.maxAgeSeconds }),
		},
		minimization,
		warnings,
		errors,
		canTransform: parsed.canTransform,
		canEvidence: parsed.canEvidence,
	};
}

function isScalarValue(value: unknown): value is ScalarValue {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function rowBytes(row: readonly ScalarValue[]): number {
	const serialized = JSON.stringify(row);
	if (serialized === undefined) throw new ResultEnvelopeValidationError("Result row cannot be serialized");
	return Buffer.byteLength(serialized, "utf8");
}

export function minimizeResult(candidate: ResultCandidate, policy: ResultMinimizationPolicy): ResultMinimizationResult {
	if (
		!Number.isInteger(candidate.rowCount) ||
		candidate.rowCount < 0 ||
		candidate.rowCount < candidate.rows.length ||
		!Number.isInteger(policy.maxRows) ||
		!Number.isInteger(policy.maxBytes) ||
		policy.maxRows < 1 ||
		policy.maxBytes < 1
	) {
		return { status: "blocked", reason: "invalid_candidate" };
	}
	const columnIds = candidate.columns.map((column) => column.columnId);
	if (new Set(columnIds).size !== columnIds.length) return { status: "blocked", reason: "invalid_candidate" };
	const allowedColumnIds = new Set(policy.allowedColumnIds);
	if (allowedColumnIds.size !== policy.allowedColumnIds.length)
		return { status: "blocked", reason: "invalid_candidate" };
	if (policy.allowedColumnIds.some((columnId) => !columnIds.includes(columnId))) {
		return { status: "blocked", reason: "invalid_candidate" };
	}
	const ruleKeys = policy.ruleRefs.map((rule) => `${rule.ruleId}\u0000${rule.version}`);
	if (new Set(ruleKeys).size !== ruleKeys.length) return { status: "blocked", reason: "invalid_candidate" };
	for (const row of candidate.rows) {
		if (row.length !== candidate.columns.length || row.some((value) => !isScalarValue(value))) {
			return { status: "blocked", reason: "invalid_candidate" };
		}
	}
	const selectedIndexes = candidate.columns
		.map((column, index) => (allowedColumnIds.has(column.columnId) ? index : -1))
		.filter((index) => index >= 0);
	if (candidate.columns.length > 0 && selectedIndexes.length === 0) {
		return { status: "blocked", reason: "privacy_blocked" };
	}
	const columns = selectedIndexes.map((index) => candidate.columns[index]);
	const removedColumnIds = candidate.columns
		.filter((_, index) => !selectedIndexes.includes(index))
		.map((column) => column.columnId);
	const rows: ScalarValue[][] = [];
	let bytes = 0;
	let truncated = candidate.rowCount > candidate.rows.length;
	for (const row of candidate.rows) {
		if (rows.length >= policy.maxRows) {
			truncated = true;
			break;
		}
		const minimizedRow = selectedIndexes.map((index) => row[index]);
		const nextBytes = rowBytes(minimizedRow);
		if (bytes + nextBytes > policy.maxBytes) {
			truncated = true;
			break;
		}
		rows.push(minimizedRow);
		bytes += nextBytes;
	}
	if (rows.length < candidate.rowCount) truncated = true;
	const warnings: ResultWarningCode[] = [];
	if (removedColumnIds.length > 0) warnings.push("privacy_minimized");
	if (truncated) warnings.push("result_truncated");
	return {
		status: "ready",
		columns,
		rows,
		rowCount: candidate.rowCount,
		returnedCount: rows.length,
		truncated,
		ruleRefs: [...policy.ruleRefs]
			.map((rule) => ({ ruleId: rule.ruleId, version: rule.version }))
			.sort((left, right) =>
				compareStrings(`${left.ruleId}\u0000${left.version}`, `${right.ruleId}\u0000${right.version}`),
			),
		removedColumnIds,
		warnings,
	};
}

export function createResultEnvelope(input: ResultEnvelopeBuildInput): ResultEnvelope {
	const errors = [...(input.errors ?? [])];
	const status: ResultStatus = input.minimized.truncated || errors.length > 0 ? "partial" : "complete";
	const warnings = [...(input.warnings ?? []), ...input.minimized.warnings, ...freshnessWarnings(input.freshness)].map(
		(code) => ({
			code,
		}),
	);
	return normalizeResultEnvelope({
		contractVersion: ANALYSIS_CONTRACT_VERSION,
		kind: "result_envelope",
		resultId: input.resultId,
		resultVersion: input.resultVersion,
		runId: input.runId,
		stepId: input.stepId,
		status,
		columns: input.minimized.columns,
		rows: input.minimized.rows,
		rowCount: input.minimized.rowCount,
		returnedCount: input.minimized.returnedCount,
		truncated: input.minimized.truncated,
		lineage: input.lineage,
		asOf: input.asOf,
		freshness: input.freshness,
		minimization: {
			ruleRefs: input.minimized.ruleRefs,
			removedColumnIds: input.minimized.removedColumnIds,
			applied: input.minimized.ruleRefs.length > 0 || input.minimized.removedColumnIds.length > 0,
		},
		warnings,
		errors,
		canTransform: input.canTransform ?? true,
		canEvidence: input.canEvidence ?? true,
	});
}

export function createBlockedResultEnvelope(input: BlockedResultEnvelopeBuildInput): ResultEnvelope {
	return normalizeResultEnvelope({
		contractVersion: ANALYSIS_CONTRACT_VERSION,
		kind: "result_envelope",
		resultId: input.resultId,
		resultVersion: input.resultVersion,
		runId: input.runId,
		stepId: input.stepId,
		status: "blocked",
		columns: [],
		rows: [],
		rowCount: 0,
		returnedCount: 0,
		truncated: false,
		lineage: input.lineage,
		asOf: input.asOf,
		freshness: input.freshness,
		minimization: { ruleRefs: [], removedColumnIds: [], applied: false },
		warnings: [...(input.warnings ?? []), ...freshnessWarnings(input.freshness)].map((code) => ({ code })),
		errors: [{ code: input.error, retryable: false }],
		canTransform: false,
		canEvidence: false,
	});
}
