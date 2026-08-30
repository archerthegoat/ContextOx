import Type, { type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import {
	ActorRefSchema,
	BindingApprovalSchema,
	DateTimeSchema,
	FreshnessSchema,
	LifecycleStatusSchema,
	PermissionRefSchema,
	type Provenance,
	ProvenanceSchema,
	ResourceIdSchema,
	VersionIdSchema,
} from "./contracts.ts";

export const ANALYSIS_CONTRACT_VERSION = "analysis.v1" as const;

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
export type ContextPackRef = Static<typeof ContextPackRefSchema>;

export const BindingExecutionSpecRefSchema = strictObject({
	kind: Type.Literal("binding_execution_spec"),
	id: ResourceIdSchema,
	version: VersionIdSchema,
});
export type BindingExecutionSpecRef = Static<typeof BindingExecutionSpecRefSchema>;

export const SourceBindingRefSchema = strictObject({
	kind: Type.Literal("source_binding"),
	id: ResourceIdSchema,
	version: VersionIdSchema,
});
export type SourceBindingRef = Static<typeof SourceBindingRefSchema>;

export const SourceSnapshotRefSchema = strictObject({
	kind: Type.Literal("source_snapshot"),
	id: ResourceIdSchema,
	version: VersionIdSchema,
});
export type SourceSnapshotRef = Static<typeof SourceSnapshotRefSchema>;

export const ColumnRefSchema = strictObject({
	tableId: ResourceIdSchema,
	columnId: ResourceIdSchema,
});
export type ColumnRef = Static<typeof ColumnRefSchema>;

export const AggregateFunctionSchema = Type.Union([
	Type.Literal("count"),
	Type.Literal("sum"),
	Type.Literal("avg"),
	Type.Literal("min"),
	Type.Literal("max"),
]);
export type AggregateFunction = Static<typeof AggregateFunctionSchema>;

export const FilterOperatorSchema = Type.Union([
	Type.Literal("eq"),
	Type.Literal("neq"),
	Type.Literal("gt"),
	Type.Literal("gte"),
	Type.Literal("lt"),
	Type.Literal("lte"),
	Type.Literal("in"),
	Type.Literal("between"),
	Type.Literal("is_null"),
	Type.Literal("is_not_null"),
]);
export type FilterOperator = Static<typeof FilterOperatorSchema>;

export const OrderDirectionSchema = Type.Union([Type.Literal("asc"), Type.Literal("desc")]);
export type OrderDirection = Static<typeof OrderDirectionSchema>;

export const RelationshipCardinalitySchema = Type.Union([
	Type.Literal("one_to_one"),
	Type.Literal("many_to_one"),
	Type.Literal("one_to_many"),
	Type.Literal("many_to_many"),
]);
export type RelationshipCardinality = Static<typeof RelationshipCardinalitySchema>;

export const RelationshipDirectionSchema = Type.Union([Type.Literal("forward"), Type.Literal("reverse")]);
export type RelationshipDirection = Static<typeof RelationshipDirectionSchema>;

export const ExecutionMeasureSchema = strictObject({
	measureId: ResourceIdSchema,
	column: ColumnRefSchema,
	aggregations: Type.Array(AggregateFunctionSchema, { minItems: 1 }),
});
export type ExecutionMeasure = Static<typeof ExecutionMeasureSchema>;

export const ExecutionDimensionSchema = strictObject({
	dimensionId: ResourceIdSchema,
	column: ColumnRefSchema,
});
export type ExecutionDimension = Static<typeof ExecutionDimensionSchema>;

export const ExecutionTimeColumnSchema = strictObject({
	timeColumnId: ResourceIdSchema,
	column: ColumnRefSchema,
	timezone: Type.String({ minLength: 1, maxLength: 128 }),
	boundary: Type.Union([Type.Literal("closed"), Type.Literal("open"), Type.Literal("half_open")]),
});
export type ExecutionTimeColumn = Static<typeof ExecutionTimeColumnSchema>;

export const ExecutionRelationshipPathSchema = strictObject({
	relationshipPathId: ResourceIdSchema,
	foreignKeyIds: Type.Array(ResourceIdSchema, { minItems: 1 }),
	direction: RelationshipDirectionSchema,
	cardinality: RelationshipCardinalitySchema,
});
export type ExecutionRelationshipPath = Static<typeof ExecutionRelationshipPathSchema>;

export const BindingExecutionSpecSchema = Type.Object(
	{
		contractVersion: Type.Literal(ANALYSIS_CONTRACT_VERSION),
		kind: Type.Literal("binding_execution_spec"),
		specId: ResourceIdSchema,
		version: VersionIdSchema,
		binding: SourceBindingRefSchema,
		snapshot: SourceSnapshotRefSchema,
		grainKeys: Type.Array(ColumnRefSchema, { minItems: 1 }),
		measures: Type.Array(ExecutionMeasureSchema),
		dimensions: Type.Array(ExecutionDimensionSchema),
		timeColumns: Type.Array(ExecutionTimeColumnSchema),
		relationshipPaths: Type.Array(ExecutionRelationshipPathSchema),
		status: LifecycleStatusSchema,
		permission: PermissionRefSchema,
		provenance: ProvenanceSchema,
		freshness: FreshnessSchema,
		approval: Type.Optional(BindingApprovalSchema),
	},
	{ additionalProperties: false, ...schemaOptions("binding-execution-spec.schema.json") },
);
export type BindingExecutionSpec = Static<typeof BindingExecutionSpecSchema>;

export const ScalarValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
export type ScalarValue = Static<typeof ScalarValueSchema>;

const ComparisonFilterSchema = strictObject({
	column: ColumnRefSchema,
	operator: Type.Union([
		Type.Literal("eq"),
		Type.Literal("neq"),
		Type.Literal("gt"),
		Type.Literal("gte"),
		Type.Literal("lt"),
		Type.Literal("lte"),
	]),
	value: ScalarValueSchema,
});

const SetFilterSchema = strictObject({
	column: ColumnRefSchema,
	operator: Type.Literal("in"),
	values: Type.Array(ScalarValueSchema, { minItems: 1, maxItems: 1000 }),
});

const RangeFilterSchema = strictObject({
	column: ColumnRefSchema,
	operator: Type.Literal("between"),
	values: Type.Tuple([ScalarValueSchema, ScalarValueSchema]),
});

const NullFilterSchema = strictObject({
	column: ColumnRefSchema,
	operator: Type.Union([Type.Literal("is_null"), Type.Literal("is_not_null")]),
});

export const QueryFilterSchema = Type.Union([
	ComparisonFilterSchema,
	SetFilterSchema,
	RangeFilterSchema,
	NullFilterSchema,
]);
export type QueryFilter = Static<typeof QueryFilterSchema>;

export const QueryTimeRangeSchema = strictObject({
	column: ColumnRefSchema,
	from: DateTimeSchema,
	to: DateTimeSchema,
	boundary: Type.Union([Type.Literal("closed"), Type.Literal("open"), Type.Literal("half_open")]),
});
export type QueryTimeRange = Static<typeof QueryTimeRangeSchema>;

export const QueryDimensionRefSchema = strictObject({ dimensionId: ResourceIdSchema });
export type QueryDimensionRef = Static<typeof QueryDimensionRefSchema>;

export const QueryMeasureRefSchema = strictObject({
	measureId: ResourceIdSchema,
	aggregation: AggregateFunctionSchema,
});
export type QueryMeasureRef = Static<typeof QueryMeasureRefSchema>;

export const QueryOrderSchema = strictObject({
	kind: Type.Union([Type.Literal("dimension"), Type.Literal("measure")]),
	id: ResourceIdSchema,
	direction: OrderDirectionSchema,
});
export type QueryOrder = Static<typeof QueryOrderSchema>;

export const QueryJoinRefSchema = strictObject({ relationshipPathId: ResourceIdSchema });
export type QueryJoinRef = Static<typeof QueryJoinRefSchema>;

export const QueryPlanSchema = Type.Object(
	{
		contractVersion: Type.Literal(ANALYSIS_CONTRACT_VERSION),
		kind: Type.Literal("query_plan"),
		queryPlanId: ResourceIdSchema,
		version: VersionIdSchema,
		executionSpec: BindingExecutionSpecRefSchema,
		dimensions: Type.Array(QueryDimensionRefSchema),
		measures: Type.Array(QueryMeasureRefSchema),
		filters: Type.Array(QueryFilterSchema),
		timeRange: Type.Optional(QueryTimeRangeSchema),
		joins: Type.Array(QueryJoinRefSchema),
		orderBy: Type.Array(QueryOrderSchema),
		limit: Type.Integer({ minimum: 1, maximum: 10000 }),
	},
	{ additionalProperties: false, ...schemaOptions("query-plan.schema.json") },
);
export type QueryPlan = Static<typeof QueryPlanSchema>;

const PlanStepBase = {
	stepId: ResourceIdSchema,
	required: Type.Boolean(),
	dependsOn: Type.Array(ResourceIdSchema),
} as const;

export const KnowledgePlanSchema = strictObject({
	sourceResourceIds: Type.Array(ResourceIdSchema, { minItems: 1 }),
	query: Type.String({ minLength: 1, maxLength: 2000 }),
	limit: Type.Integer({ minimum: 1, maximum: 100 }),
});
export type KnowledgePlan = Static<typeof KnowledgePlanSchema>;

export const TransformPlanSchema = strictObject({
	operation: Type.Union([
		Type.Literal("project"),
		Type.Literal("aggregate"),
		Type.Literal("sort"),
		Type.Literal("limit"),
	]),
	inputStepIds: Type.Array(ResourceIdSchema, { minItems: 1 }),
});
export type TransformPlan = Static<typeof TransformPlanSchema>;

export const HybridPlanSchema = strictObject({
	queryStepId: ResourceIdSchema,
	knowledgeStepId: ResourceIdSchema,
	mode: Type.Union([Type.Literal("annotate"), Type.Literal("compare"), Type.Literal("explain")]),
});
export type HybridPlan = Static<typeof HybridPlanSchema>;

const QueryStepSchema = Type.Object(
	{
		...PlanStepBase,
		kind: Type.Literal("query"),
		query: QueryPlanSchema,
	},
	{ additionalProperties: false },
);

const KnowledgeStepSchema = Type.Object(
	{
		...PlanStepBase,
		kind: Type.Literal("knowledge"),
		knowledge: KnowledgePlanSchema,
	},
	{ additionalProperties: false },
);

const TransformStepSchema = Type.Object(
	{
		...PlanStepBase,
		kind: Type.Literal("transform"),
		transform: TransformPlanSchema,
	},
	{ additionalProperties: false },
);

const HybridStepSchema = Type.Object(
	{
		...PlanStepBase,
		kind: Type.Literal("hybrid"),
		hybrid: HybridPlanSchema,
	},
	{ additionalProperties: false },
);

export const AnalysisStepSchema = Type.Union([
	QueryStepSchema,
	KnowledgeStepSchema,
	TransformStepSchema,
	HybridStepSchema,
]);
export type AnalysisStep = Static<typeof AnalysisStepSchema>;

export const AnalysisPlanSchema = Type.Object(
	{
		contractVersion: Type.Literal(ANALYSIS_CONTRACT_VERSION),
		kind: Type.Literal("analysis_plan"),
		planId: ResourceIdSchema,
		version: VersionIdSchema,
		contextPack: ContextPackRefSchema,
		executionSpecs: Type.Array(BindingExecutionSpecRefSchema),
		steps: Type.Array(AnalysisStepSchema, { minItems: 1 }),
		createdBy: ActorRefSchema,
		createdAt: DateTimeSchema,
		provenance: ProvenanceSchema,
	},
	{ additionalProperties: false, ...schemaOptions("analysis-plan.schema.json") },
);
export type AnalysisPlan = Static<typeof AnalysisPlanSchema>;

export class AnalysisContractValidationError extends Error {
	readonly contractKind: string;

	constructor(contractKind: string) {
		super(`Invalid ${contractKind} analysis contract`);
		this.name = "AnalysisContractValidationError";
		this.contractKind = contractKind;
	}
}

export type AnalysisPlanErrorCode =
	| "invalid_contract"
	| "duplicate_id"
	| "missing_dependency"
	| "cycle"
	| "invalid_reference"
	| "invalid_step";

export class AnalysisPlanError extends Error {
	readonly code: AnalysisPlanErrorCode;

	constructor(code: AnalysisPlanErrorCode, message: string) {
		super(message);
		this.name = "AnalysisPlanError";
		this.code = code;
	}
}

function assertAnalysisContract<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	contractKind: string,
): Static<TSchemaType> {
	if (!Check(schema, value)) throw new AnalysisContractValidationError(contractKind);
	return value as Static<TSchemaType>;
}

export function parseBindingExecutionSpec(value: unknown): BindingExecutionSpec {
	return assertAnalysisContract(BindingExecutionSpecSchema, value, "BindingExecutionSpec");
}

export function parseQueryPlan(value: unknown): QueryPlan {
	return assertAnalysisContract(QueryPlanSchema, value, "QueryPlan");
}

export function parseAnalysisPlan(value: unknown): AnalysisPlan {
	return assertAnalysisContract(AnalysisPlanSchema, value, "AnalysisPlan");
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function columnKey(column: ColumnRef): string {
	return `${column.tableId}\u0000${column.columnId}`;
}

function refKey(ref: { readonly id: string; readonly version: string }): string {
	return `${ref.id}\u0000${ref.version}`;
}

function ensureUnique(values: readonly string[], code: AnalysisPlanErrorCode, message: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) throw new AnalysisPlanError(code, message);
		seen.add(value);
	}
}

function normalizeProvenance(provenance: Provenance): Provenance {
	const sources = provenance.sources
		.map((source) => ({ sourceId: source.sourceId, version: source.version }))
		.sort((left, right) =>
			compareStrings(
				refKey({ id: left.sourceId, version: left.version }),
				refKey({ id: right.sourceId, version: right.version }),
			),
		);
	ensureUnique(
		sources.map((source) => refKey({ id: source.sourceId, version: source.version })),
		"duplicate_id",
		"Duplicate provenance source reference",
	);
	return {
		sources,
		createdBy: {
			kind: provenance.createdBy.kind,
			...(provenance.createdBy.id === undefined ? {} : { id: provenance.createdBy.id }),
		},
		createdAt: provenance.createdAt,
	};
}

function normalizeColumn(column: ColumnRef): ColumnRef {
	return { tableId: column.tableId, columnId: column.columnId };
}

function normalizeBindingExecutionSpecValue(value: BindingExecutionSpec): BindingExecutionSpec {
	const grainKeys = [...value.grainKeys]
		.map(normalizeColumn)
		.sort((left, right) => compareStrings(columnKey(left), columnKey(right)));
	ensureUnique(grainKeys.map(columnKey), "duplicate_id", "Duplicate BindingExecutionSpec grain key");

	const measures = value.measures
		.map((measure) => ({
			measureId: measure.measureId,
			column: normalizeColumn(measure.column),
			aggregations: [...new Set(measure.aggregations)].sort(compareStrings),
		}))
		.sort((left, right) => compareStrings(left.measureId, right.measureId));
	ensureUnique(
		measures.map((measure) => measure.measureId),
		"duplicate_id",
		"Duplicate BindingExecutionSpec measure",
	);

	const dimensions = value.dimensions
		.map((dimension) => ({ dimensionId: dimension.dimensionId, column: normalizeColumn(dimension.column) }))
		.sort((left, right) => compareStrings(left.dimensionId, right.dimensionId));
	ensureUnique(
		dimensions.map((dimension) => dimension.dimensionId),
		"duplicate_id",
		"Duplicate BindingExecutionSpec dimension",
	);

	const timeColumns = value.timeColumns
		.map((timeColumn) => ({
			timeColumnId: timeColumn.timeColumnId,
			column: normalizeColumn(timeColumn.column),
			timezone: timeColumn.timezone,
			boundary: timeColumn.boundary,
		}))
		.sort((left, right) => compareStrings(left.timeColumnId, right.timeColumnId));
	ensureUnique(
		timeColumns.map((timeColumn) => timeColumn.timeColumnId),
		"duplicate_id",
		"Duplicate BindingExecutionSpec time column",
	);

	const relationshipPaths = value.relationshipPaths
		.map((path) => ({
			relationshipPathId: path.relationshipPathId,
			foreignKeyIds: [...path.foreignKeyIds],
			direction: path.direction,
			cardinality: path.cardinality,
		}))
		.sort((left, right) => compareStrings(left.relationshipPathId, right.relationshipPathId));
	ensureUnique(
		relationshipPaths.map((path) => path.relationshipPathId),
		"duplicate_id",
		"Duplicate BindingExecutionSpec relationship path",
	);
	for (const path of relationshipPaths) {
		ensureUnique(path.foreignKeyIds, "duplicate_id", "Duplicate relationship path foreign key");
	}

	const normalized: BindingExecutionSpec = {
		contractVersion: value.contractVersion,
		kind: "binding_execution_spec",
		specId: value.specId,
		version: value.version,
		binding: { kind: "source_binding", id: value.binding.id, version: value.binding.version },
		snapshot: { kind: "source_snapshot", id: value.snapshot.id, version: value.snapshot.version },
		grainKeys,
		measures,
		dimensions,
		timeColumns,
		relationshipPaths,
		status: value.status,
		permission: { policyId: value.permission.policyId, policyVersion: value.permission.policyVersion },
		provenance: normalizeProvenance(value.provenance),
		freshness: {
			asOf: value.freshness.asOf,
			checkedAt: value.freshness.checkedAt,
			status: value.freshness.status,
			...(value.freshness.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: value.freshness.maxAgeSeconds }),
		},
		...(value.approval === undefined
			? {}
			: {
					approval: {
						reviewerId: value.approval.reviewerId,
						reviewedAt: value.approval.reviewedAt,
						decision: value.approval.decision,
						...(value.approval.note === undefined ? {} : { note: value.approval.note }),
					},
				}),
	};

	if (normalized.status === "published" && normalized.approval?.decision !== "approved") {
		throw new AnalysisPlanError("invalid_contract", "Published BindingExecutionSpec requires approved review");
	}
	if (
		normalized.approval?.decision === "approved" &&
		(normalized.status === "draft" || normalized.status === "in_review")
	) {
		throw new AnalysisPlanError("invalid_contract", "Approved BindingExecutionSpec requires published status");
	}
	return normalized;
}

export function normalizeBindingExecutionSpec(value: unknown): BindingExecutionSpec {
	return normalizeBindingExecutionSpecValue(parseBindingExecutionSpec(value));
}

function normalizeQueryPlanValue(value: QueryPlan): QueryPlan {
	const dimensions = value.dimensions.map((dimension) => ({ dimensionId: dimension.dimensionId }));
	ensureUnique(
		dimensions.map((dimension) => dimension.dimensionId),
		"duplicate_id",
		"Duplicate QueryPlan dimension",
	);
	const measures = value.measures.map((measure) => ({
		measureId: measure.measureId,
		aggregation: measure.aggregation,
	}));
	ensureUnique(
		measures.map((measure) => measure.measureId),
		"duplicate_id",
		"Duplicate QueryPlan measure",
	);
	if (dimensions.length === 0 && measures.length === 0) {
		throw new AnalysisPlanError("invalid_contract", "QueryPlan must select a dimension or measure");
	}

	const joins = value.joins.map((join) => ({ relationshipPathId: join.relationshipPathId }));
	ensureUnique(
		joins.map((join) => join.relationshipPathId),
		"duplicate_id",
		"Duplicate QueryPlan relationship path",
	);

	const selectedDimensions = new Set(dimensions.map((dimension) => dimension.dimensionId));
	const selectedMeasures = new Set(measures.map((measure) => measure.measureId));
	for (const order of value.orderBy) {
		const selected = order.kind === "dimension" ? selectedDimensions : selectedMeasures;
		if (!selected.has(order.id))
			throw new AnalysisPlanError("invalid_reference", "QueryPlan order field is not selected");
	}
	ensureUnique(
		value.orderBy.map((order) => `${order.kind}\u0000${order.id}`),
		"duplicate_id",
		"Duplicate QueryPlan order field",
	);

	if (value.timeRange !== undefined && Date.parse(value.timeRange.from) >= Date.parse(value.timeRange.to)) {
		throw new AnalysisPlanError("invalid_contract", "QueryPlan time range must have a positive interval");
	}

	return {
		contractVersion: value.contractVersion,
		kind: "query_plan",
		queryPlanId: value.queryPlanId,
		version: value.version,
		executionSpec: {
			kind: "binding_execution_spec",
			id: value.executionSpec.id,
			version: value.executionSpec.version,
		},
		dimensions,
		measures,
		filters: value.filters.map((filter) => ({ ...filter })),
		...(value.timeRange === undefined
			? {}
			: {
					timeRange: {
						column: normalizeColumn(value.timeRange.column),
						from: value.timeRange.from,
						to: value.timeRange.to,
						boundary: value.timeRange.boundary,
					},
				}),
		joins,
		orderBy: value.orderBy.map((order) => ({ kind: order.kind, id: order.id, direction: order.direction })),
		limit: value.limit,
	};
}

export function normalizeQueryPlan(value: unknown): QueryPlan {
	return normalizeQueryPlanValue(parseQueryPlan(value));
}

function normalizeStep(step: AnalysisStep): AnalysisStep {
	const dependsOn = [...new Set(step.dependsOn)].sort(compareStrings);
	if (dependsOn.length !== step.dependsOn.length) {
		throw new AnalysisPlanError("duplicate_id", "Duplicate AnalysisPlan dependency");
	}
	if (step.kind === "query") {
		return {
			stepId: step.stepId,
			kind: "query",
			required: step.required,
			dependsOn,
			query: normalizeQueryPlanValue(step.query),
		};
	}
	if (step.kind === "knowledge") {
		const sourceResourceIds = [...new Set(step.knowledge.sourceResourceIds)].sort(compareStrings);
		if (sourceResourceIds.length !== step.knowledge.sourceResourceIds.length) {
			throw new AnalysisPlanError("duplicate_id", "Duplicate knowledge source reference");
		}
		return {
			stepId: step.stepId,
			kind: "knowledge",
			required: step.required,
			dependsOn,
			knowledge: { sourceResourceIds, query: step.knowledge.query.trim(), limit: step.knowledge.limit },
		};
	}
	if (step.kind === "transform") {
		const inputStepIds = [...new Set(step.transform.inputStepIds)].sort(compareStrings);
		if (inputStepIds.length !== step.transform.inputStepIds.length) {
			throw new AnalysisPlanError("duplicate_id", "Duplicate transform input step");
		}
		return {
			stepId: step.stepId,
			kind: "transform",
			required: step.required,
			dependsOn,
			transform: { operation: step.transform.operation, inputStepIds },
		};
	}
	const hybrid = {
		queryStepId: step.hybrid.queryStepId,
		knowledgeStepId: step.hybrid.knowledgeStepId,
		mode: step.hybrid.mode,
	};
	return { stepId: step.stepId, kind: "hybrid", required: step.required, dependsOn, hybrid };
}

function validatePlanGraph(steps: readonly AnalysisStep[]): void {
	const byId = new Map(steps.map((step) => [step.stepId, step]));
	for (const step of steps) {
		for (const dependency of step.dependsOn) {
			if (dependency === step.stepId || !byId.has(dependency)) {
				throw new AnalysisPlanError("missing_dependency", "AnalysisPlan dependency is not resolvable");
			}
		}
		if (step.kind === "transform") {
			for (const inputStepId of step.transform.inputStepIds) {
				if (!step.dependsOn.includes(inputStepId)) {
					throw new AnalysisPlanError("invalid_step", "Transform input must be a declared dependency");
				}
			}
		}
		if (step.kind === "hybrid") {
			if (
				!step.dependsOn.includes(step.hybrid.queryStepId) ||
				!step.dependsOn.includes(step.hybrid.knowledgeStepId)
			) {
				throw new AnalysisPlanError("invalid_step", "Hybrid inputs must be declared dependencies");
			}
			if (byId.get(step.hybrid.queryStepId)?.kind !== "query") {
				throw new AnalysisPlanError("invalid_step", "Hybrid query input must reference a query step");
			}
			if (byId.get(step.hybrid.knowledgeStepId)?.kind !== "knowledge") {
				throw new AnalysisPlanError("invalid_step", "Hybrid knowledge input must reference a knowledge step");
			}
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (stepId: string): void => {
		if (visiting.has(stepId)) throw new AnalysisPlanError("cycle", "AnalysisPlan dependency graph contains a cycle");
		if (visited.has(stepId)) return;
		visiting.add(stepId);
		const step = byId.get(stepId);
		if (step === undefined)
			throw new AnalysisPlanError("missing_dependency", "AnalysisPlan dependency is not resolvable");
		for (const dependency of step.dependsOn) visit(dependency);
		visiting.delete(stepId);
		visited.add(stepId);
	};
	for (const step of steps) visit(step.stepId);
}

export function normalizeAnalysisPlan(value: unknown): AnalysisPlan {
	const parsed = parseAnalysisPlan(value);
	const executionSpecs = parsed.executionSpecs
		.map((ref) => ({ kind: "binding_execution_spec" as const, id: ref.id, version: ref.version }))
		.sort((left, right) => compareStrings(refKey(left), refKey(right)));
	ensureUnique(executionSpecs.map(refKey), "duplicate_id", "Duplicate AnalysisPlan execution specification");

	const steps = parsed.steps.map(normalizeStep).sort((left, right) => compareStrings(left.stepId, right.stepId));
	ensureUnique(
		steps.map((step) => step.stepId),
		"duplicate_id",
		"Duplicate AnalysisPlan step",
	);
	validatePlanGraph(steps);

	const executionSpecKeys = new Set(executionSpecs.map(refKey));
	for (const step of steps) {
		if (step.kind !== "query") continue;
		if (!executionSpecKeys.has(refKey(step.query.executionSpec))) {
			throw new AnalysisPlanError(
				"invalid_reference",
				"QueryPlan execution specification is not declared by AnalysisPlan",
			);
		}
	}

	return {
		contractVersion: parsed.contractVersion,
		kind: "analysis_plan",
		planId: parsed.planId,
		version: parsed.version,
		contextPack: { kind: "context_pack", id: parsed.contextPack.id, version: parsed.contextPack.version },
		executionSpecs,
		steps,
		createdBy: {
			kind: parsed.createdBy.kind,
			...(parsed.createdBy.id === undefined ? {} : { id: parsed.createdBy.id }),
		},
		createdAt: parsed.createdAt,
		provenance: normalizeProvenance(parsed.provenance),
	};
}
