import { describe, expect, test } from "vitest";
import {
	ANALYSIS_CONTRACT_VERSION,
	AnalysisContractValidationError,
	AnalysisPlanError,
	normalizeAnalysisPlan,
	normalizeBindingExecutionSpec,
	normalizeQueryPlan,
	parseBindingExecutionSpec,
} from "../src/index.ts";

const permission = { policyId: "policy-sales", policyVersion: "1.0.0" };
const provenance = {
	sources: [{ sourceId: "sales-db", version: "1.0.0" }],
	createdBy: { kind: "human" as const, id: "reviewer-a" },
	createdAt: "2026-08-25T00:05:00Z",
};
const freshness = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
};

const executionSpec = {
	contractVersion: ANALYSIS_CONTRACT_VERSION,
	kind: "binding_execution_spec" as const,
	specId: "sales-exec",
	version: "1.0.0",
	binding: { kind: "source_binding" as const, id: "gross-sales", version: "1.0.0" },
	snapshot: { kind: "source_snapshot" as const, id: "sales-snapshot", version: "1.0.0" },
	grainKeys: [
		{ tableId: "orders", columnId: "order-id" },
		{ tableId: "orders", columnId: "customer-id" },
	],
	measures: [
		{
			measureId: "gross-sales",
			column: { tableId: "orders", columnId: "order-total" },
			aggregations: ["sum" as const, "count" as const],
		},
	],
	dimensions: [{ dimensionId: "order-date", column: { tableId: "orders", columnId: "order-date" } }],
	timeColumns: [
		{
			timeColumnId: "order-date",
			column: { tableId: "orders", columnId: "order-date" },
			timezone: "UTC",
			boundary: "half_open" as const,
		},
	],
	relationshipPaths: [
		{
			relationshipPathId: "customer-orders",
			foreignKeyIds: ["fk-customer"],
			direction: "forward" as const,
			cardinality: "many_to_one" as const,
		},
	],
	status: "published" as const,
	permission,
	provenance,
	freshness,
	approval: {
		reviewerId: "reviewer-a",
		reviewedAt: "2026-08-25T00:10:00Z",
		decision: "approved" as const,
	},
};

const queryPlan = {
	contractVersion: ANALYSIS_CONTRACT_VERSION,
	kind: "query_plan" as const,
	queryPlanId: "sales-query",
	version: "1.0.0",
	executionSpec: { kind: "binding_execution_spec" as const, id: "sales-exec", version: "1.0.0" },
	dimensions: [{ dimensionId: "order-date" }],
	measures: [{ measureId: "gross-sales", aggregation: "sum" as const }],
	filters: [
		{
			column: { tableId: "orders", columnId: "customer-id" },
			operator: "eq" as const,
			value: "customer-a",
		},
	],
	timeRange: {
		column: { tableId: "orders", columnId: "order-date" },
		from: "2026-08-01T00:00:00Z",
		to: "2026-09-01T00:00:00Z",
		boundary: "half_open" as const,
	},
	joins: [{ relationshipPathId: "customer-orders" }],
	orderBy: [{ kind: "measure" as const, id: "gross-sales", direction: "desc" as const }],
	limit: 100,
};

function analysisPlanWithSteps(steps: readonly unknown[]) {
	return {
		contractVersion: ANALYSIS_CONTRACT_VERSION,
		kind: "analysis_plan" as const,
		planId: "sales-analysis",
		version: "1.0.0",
		contextPack: { kind: "context_pack" as const, id: "sales-context", version: "1.0.0" },
		executionSpecs: [{ kind: "binding_execution_spec" as const, id: "sales-exec", version: "1.0.0" }],
		steps,
		createdBy: { kind: "human" as const, id: "reviewer-a" },
		createdAt: "2026-08-25T00:15:00Z",
		provenance,
	};
}

describe("path-03 analysis contracts", () => {
	test("normalizes an approved BindingExecutionSpec deterministically", () => {
		const normalized = normalizeBindingExecutionSpec({
			...executionSpec,
			grainKeys: [...executionSpec.grainKeys].reverse(),
			measures: [
				{
					...executionSpec.measures[0],
					aggregations: [...executionSpec.measures[0].aggregations].reverse(),
				},
			],
		});

		expect(normalized.grainKeys.map((column) => column.columnId)).toEqual(["customer-id", "order-id"]);
		expect(normalized.measures[0]?.aggregations).toEqual(["count", "sum"]);
	});

	test("rejects unknown fields and invalid publication approval", () => {
		expect(() => parseBindingExecutionSpec({ ...executionSpec, credentials: "secret" })).toThrow(
			AnalysisContractValidationError,
		);
		expect(() =>
			normalizeBindingExecutionSpec({
				...executionSpec,
				approval: { ...executionSpec.approval, decision: "rejected" as const },
			}),
		).toThrow(AnalysisPlanError);
	});

	test("normalizes a typed QueryPlan and rejects ambiguous order fields", () => {
		const normalized = normalizeQueryPlan(queryPlan);
		expect(normalized.queryPlanId).toBe("sales-query");
		expect(normalized.filters[0]?.operator).toBe("eq");
		expect(() =>
			normalizeQueryPlan({
				...queryPlan,
				orderBy: [{ kind: "dimension" as const, id: "unknown-dimension", direction: "asc" as const }],
			}),
		).toThrow(AnalysisPlanError);
	});

	test("normalizes a plan DAG and validates typed step dependencies", () => {
		const normalized = normalizeAnalysisPlan(
			analysisPlanWithSteps([
				{
					stepId: "step-hybrid",
					kind: "hybrid" as const,
					required: true,
					dependsOn: ["step-knowledge", "step-query"],
					hybrid: {
						queryStepId: "step-query",
						knowledgeStepId: "step-knowledge",
						mode: "compare" as const,
					},
				},
				{
					stepId: "step-query",
					kind: "query" as const,
					required: true,
					dependsOn: [],
					query: queryPlan,
				},
				{
					stepId: "step-knowledge",
					kind: "knowledge" as const,
					required: false,
					dependsOn: [],
					knowledge: { sourceResourceIds: ["sales-doc"], query: "refund policy", limit: 10 },
				},
			]),
		);

		expect(normalized.steps.map((step) => step.stepId)).toEqual(["step-hybrid", "step-knowledge", "step-query"]);
	});

	test("blocks missing dependencies, cycles and undeclared execution specs", () => {
		expect(() =>
			normalizeAnalysisPlan(
				analysisPlanWithSteps([
					{
						stepId: "step-query",
						kind: "query" as const,
						required: true,
						dependsOn: ["missing"],
						query: queryPlan,
					},
				]),
			),
		).toThrow(AnalysisPlanError);

		expect(() =>
			normalizeAnalysisPlan(
				analysisPlanWithSteps([
					{
						stepId: "step-a",
						kind: "transform" as const,
						required: true,
						dependsOn: ["step-b"],
						transform: { operation: "project" as const, inputStepIds: ["step-b"] },
					},
					{
						stepId: "step-b",
						kind: "transform" as const,
						required: true,
						dependsOn: ["step-a"],
						transform: { operation: "project" as const, inputStepIds: ["step-a"] },
					},
				]),
			),
		).toThrow(AnalysisPlanError);

		expect(() =>
			normalizeAnalysisPlan(
				analysisPlanWithSteps([
					{
						stepId: "step-query",
						kind: "query" as const,
						required: true,
						dependsOn: [],
						query: {
							...queryPlan,
							executionSpec: { kind: "binding_execution_spec" as const, id: "other", version: "1.0.0" },
						},
					},
				]),
			),
		).toThrow(AnalysisPlanError);
	});
});
