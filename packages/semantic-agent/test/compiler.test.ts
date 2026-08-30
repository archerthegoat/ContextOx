import { describe, expect, test, vi } from "vitest";
import {
	ANALYSIS_CONTRACT_VERSION,
	compileQueryPlan,
	type ExecutionContext,
	type PolicyDecision,
	preflightQueryPlan,
	QueryCompilerError,
	type ReadOnlyQueryExecutor,
} from "../src/index.ts";

const permission = { policyId: "policy-sales", policyVersion: "1.0.0" };
const sourceRef = { sourceId: "sales-db", version: "1.0.0" };
const freshness = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
};
const provenance = {
	sources: [sourceRef],
	createdBy: { kind: "system" as const, id: "fixture-loader" },
	createdAt: "2026-08-25T00:05:00Z",
};

const snapshot = {
	contractVersion: "context.v1" as const,
	kind: "source_snapshot" as const,
	snapshotId: "sales-snapshot",
	sourceId: "sales-db",
	version: "1.0.0",
	discoveredAt: "2026-08-25T00:05:00Z",
	freshness,
	dialect: "fixture-sql",
	structureFingerprint: "sha256:fixture-sales-v1",
	tables: [
		{
			tableId: "orders",
			name: "orders",
			columns: [
				{ columnId: "order-id", name: "order_id", dataType: "integer", nullable: false, ordinal: 0 },
				{ columnId: "customer-id", name: "customer_id", dataType: "integer", nullable: false, ordinal: 1 },
				{ columnId: "order-total", name: "order_total", dataType: "decimal", nullable: false, ordinal: 2 },
				{ columnId: "order-date", name: "order_date", dataType: "timestamp", nullable: false, ordinal: 3 },
			],
			primaryKey: ["order-id"],
			foreignKeys: [
				{
					constraintId: "fk-customer",
					columns: ["customer-id"],
					referencedTableId: "customers",
					referencedColumns: ["customer-id"],
				},
			],
		},
		{
			tableId: "customers",
			name: "customers",
			columns: [{ columnId: "customer-id", name: "customer_id", dataType: "integer", nullable: false, ordinal: 0 }],
			primaryKey: ["customer-id"],
			foreignKeys: [],
		},
	],
};

const binding = {
	contractVersion: "context.v1" as const,
	kind: "source_binding" as const,
	bindingId: "gross-sales",
	version: "1.0.0",
	sourceSnapshotId: "sales-snapshot",
	subject: {
		subjectId: "gross-sales",
		kind: "metric" as const,
		label: "Gross sales",
		definition: "Sum of order totals.",
	},
	targets: [{ tableId: "orders", columnIds: ["order-id", "customer-id", "order-total", "order-date"] }],
	grain: "one row per order",
	timeSemantics: { columnId: "order-date", timezone: "UTC", boundary: "half_open" as const },
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
			aggregations: ["sum" as const],
		},
	],
	dimensions: [{ dimensionId: "customer-id", column: { tableId: "orders", columnId: "customer-id" } }],
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
	dimensions: [{ dimensionId: "customer-id" }],
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

const contextPack = {
	contractVersion: "context.v1" as const,
	kind: "context_pack" as const,
	packId: "sales-context",
	version: "1.0.0",
	name: "Sales context",
	status: "published" as const,
	sources: [sourceRef],
	bindings: [{ kind: "source_binding" as const, id: "gross-sales", version: "1.0.0" }],
	resources: [],
	permissions: [permission],
	provenance,
	freshness,
	effectiveFrom: "2026-08-25T00:00:00Z",
};

function createContext(decision: PolicyDecision = { decision: "allow" }): ExecutionContext {
	return {
		runId: "run-sales-1",
		actor: { kind: "human", id: "user-a" },
		organizationId: "org-a",
		asOf: "2026-08-25T00:15:00Z",
		freshnessPolicy: "fresh_only",
		budget: { maxSteps: 1, maxRows: 1000, maxBytes: 100000 },
		policyEvaluator: { evaluate: vi.fn(async () => decision) },
	};
}

function request(overrides: Partial<Parameters<typeof preflightQueryPlan>[0]> = {}) {
	return {
		queryPlan,
		executionSpec,
		binding,
		snapshot,
		contextPack,
		context: createContext(),
		...overrides,
	};
}

async function readyQuery(overrides: Partial<Parameters<typeof preflightQueryPlan>[0]> = {}) {
	const context = (overrides.context as ExecutionContext | undefined) ?? createContext();
	const result = await preflightQueryPlan(request({ ...overrides, context }));
	expect(result.status).toBe("ready");
	if (result.status !== "ready") throw new Error("fixture preflight did not become ready");
	return { result, context };
}

describe("path-03 compiler", () => {
	test("compiles a ready plan into deterministic parameterized read-only SQL", async () => {
		const { result, context } = await readyQuery();
		const compiled = compileQueryPlan(result, context);

		expect(compiled.readOnly).toBe(true);
		expect(compiled.text).toBe(
			'SELECT "orders"."customer_id" AS "dimension_customer-id", SUM("orders"."order_total") AS "measure_gross-sales" FROM "orders" JOIN "customers" ON "orders"."customer_id" = "customers"."customer_id" WHERE "orders"."customer_id" = ? AND "orders"."order_date" >= ? AND "orders"."order_date" < ? GROUP BY "orders"."customer_id" ORDER BY "measure_gross-sales" DESC LIMIT ?',
		);
		expect(compiled.parameters).toEqual([
			{ index: 1, role: "filter", type: "string", value: "customer-a" },
			{ index: 2, role: "time_range", type: "string", value: "2026-08-01T00:00:00Z" },
			{ index: 3, role: "time_range", type: "string", value: "2026-09-01T00:00:00Z" },
			{ index: 4, role: "limit", type: "number", value: 100 },
		]);
		expect(compiled.estimatedRows).toBe(100);
		expect(compiled.estimatedBytes).toBe(19200);
		expect(compiled.queryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	test("keeps values out of SQL text and canonicalizes filter order", async () => {
		const injection = "customer-a' OR 1=1 --";
		const filters = [
			{ column: { tableId: "orders", columnId: "customer-id" }, operator: "eq" as const, value: injection },
			{ column: { tableId: "orders", columnId: "order-total" }, operator: "gt" as const, value: 10 },
		];
		const first = await readyQuery({ queryPlan: { ...queryPlan, filters } });
		const second = await readyQuery({ queryPlan: { ...queryPlan, filters: [...filters].reverse() } });
		const firstCompiled = compileQueryPlan(first.result, first.context);
		const secondCompiled = compileQueryPlan(second.result, second.context);

		expect(firstCompiled.text).not.toContain(injection);
		expect(firstCompiled.parameters.map((parameter) => parameter.value)).toContain(injection);
		expect(firstCompiled.text).toBe(secondCompiled.text);
		expect(firstCompiled.queryDigest).toBe(secondCompiled.queryDigest);
	});

	test("blocks unsupported dialects, over-budget estimates, and missing preflight", async () => {
		const dialect = await readyQuery({ snapshot: { ...snapshot, dialect: "postgres" } });
		expect(() => compileQueryPlan(dialect.result, dialect.context)).toThrowError(QueryCompilerError);
		try {
			compileQueryPlan(dialect.result, dialect.context);
		} catch (error) {
			expect(error).toMatchObject({ code: "unsupported_dialect" });
		}

		const lowBudget = await readyQuery({
			context: { ...createContext(), budget: { maxSteps: 1, maxRows: 1000, maxBytes: 100 } },
		});
		expect(() => compileQueryPlan(lowBudget.result, lowBudget.context)).toThrowError(QueryCompilerError);
		try {
			compileQueryPlan(lowBudget.result, lowBudget.context);
		} catch (error) {
			expect(error).toMatchObject({ code: "budget_exceeded" });
		}

		expect(() => compileQueryPlan({ status: "blocked", reason: "permission_denied" }, createContext())).toThrowError(
			QueryCompilerError,
		);
		try {
			compileQueryPlan({ status: "blocked", reason: "permission_denied" }, createContext());
		} catch (error) {
			expect(error).toMatchObject({ code: "preflight_required" });
		}
	});

	test("keeps the executor boundary read-only and structured", async () => {
		const { result, context } = await readyQuery();
		const compiled = compileQueryPlan(result, context);
		const executor: ReadOnlyQueryExecutor<string> = {
			execute: vi.fn(async ({ compiledQuery }) => {
				expect(compiledQuery.readOnly).toBe(true);
				expect(compiledQuery.text.startsWith("SELECT ")).toBe(true);
				return "fixture-result";
			}),
		};

		expect(await executor.execute({ compiledQuery: compiled, context })).toBe("fixture-result");
		expect(executor.execute).toHaveBeenCalledOnce();
	});
});
