import { describe, expect, test, vi } from "vitest";
import {
	ANALYSIS_CONTRACT_VERSION,
	type ExecutionContext,
	type PolicyDecision,
	preflightQueryPlan,
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
	targets: [
		{
			tableId: "orders",
			columnIds: ["order-id", "customer-id", "order-total", "order-date"],
		},
	],
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

describe("path-03 preflight", () => {
	test("allows a fully referenced, fresh, authorized query", async () => {
		const result = await preflightQueryPlan(request());

		expect(result.status).toBe("ready");
		if (result.status !== "ready") return;
		expect(result.checkedPermissions).toEqual([permission]);
		expect(result.warnings).toEqual([]);
	});

	test("blocks deny and unknown policy decisions before execution", async () => {
		const denied = await preflightQueryPlan(request({ context: createContext({ decision: "deny" }) }));
		const unknown = await preflightQueryPlan(request({ context: createContext({ decision: "unknown" }) }));

		expect(denied).toEqual({ status: "blocked", reason: "permission_denied" });
		expect(unknown).toEqual({ status: "blocked", reason: "unknown_permission" });
	});

	test("applies freshness policy and rejects an over-budget query", async () => {
		const stale = { ...freshness, status: "stale" as const };
		const staleResult = await preflightQueryPlan(
			request({
				snapshot: { ...snapshot, freshness: stale },
				binding: { ...binding, freshness: stale },
				executionSpec: { ...executionSpec, freshness: stale },
				contextPack: { ...contextPack, freshness: stale },
				context: { ...createContext(), freshnessPolicy: "allow_stale" },
			}),
		);
		const blockedStale = await preflightQueryPlan(
			request({
				snapshot: { ...snapshot, freshness: stale },
				context: createContext(),
			}),
		);
		const unknown = { ...freshness, status: "unknown" as const };
		const allowedUnknown = await preflightQueryPlan(
			request({
				snapshot: { ...snapshot, freshness: unknown },
				context: { ...createContext(), freshnessPolicy: "allow_unknown" },
			}),
		);
		const expired = await preflightQueryPlan(
			request({ snapshot: { ...snapshot, freshness: { ...freshness, status: "expired" } } }),
		);
		const overBudget = await preflightQueryPlan(
			request({ context: { ...createContext(), budget: { maxSteps: 1, maxRows: 10, maxBytes: 100000 } } }),
		);

		expect(staleResult.status).toBe("ready");
		if (staleResult.status === "ready") expect(staleResult.warnings).toEqual(["freshness_stale"]);
		expect(blockedStale).toEqual({ status: "blocked", reason: "freshness_not_allowed" });
		expect(allowedUnknown.status).toBe("ready");
		if (allowedUnknown.status === "ready") expect(allowedUnknown.warnings).toEqual(["freshness_unknown"]);
		expect(expired).toEqual({ status: "blocked", reason: "freshness_expired" });
		expect(overBudget).toEqual({ status: "blocked", reason: "budget_exceeded" });
	});

	test("blocks relation and grain mismatches", async () => {
		const relationMismatch = await preflightQueryPlan(
			request({
				executionSpec: {
					...executionSpec,
					relationshipPaths: [{ ...executionSpec.relationshipPaths[0], foreignKeyIds: ["unknown-fk"] }],
				},
			}),
		);
		const grainMismatch = await preflightQueryPlan(
			request({ queryPlan: { ...queryPlan, dimensions: [{ dimensionId: "unknown-dimension" }] } }),
		);
		const executionSpecMismatch = await preflightQueryPlan(
			request({
				queryPlan: {
					...queryPlan,
					executionSpec: { ...queryPlan.executionSpec, id: "other-execution-spec" },
				},
			}),
		);
		const timeBoundaryMismatch = await preflightQueryPlan(
			request({
				queryPlan: {
					...queryPlan,
					timeRange: { ...queryPlan.timeRange, boundary: "closed" as const },
				},
			}),
		);

		expect(relationMismatch).toEqual({ status: "blocked", reason: "relation_not_allowed" });
		expect(grainMismatch).toEqual({ status: "blocked", reason: "grain_mismatch" });
		expect(executionSpecMismatch).toEqual({ status: "blocked", reason: "version_mismatch" });
		expect(timeBoundaryMismatch).toEqual({ status: "blocked", reason: "grain_mismatch" });
	});

	test("rejects credentials and cancellation at the execution context boundary", async () => {
		const invalidContext = { ...createContext(), password: "secret" };
		const cancelledController = new AbortController();
		cancelledController.abort();

		const invalid = await preflightQueryPlan(request({ context: invalidContext }));
		const cancelled = await preflightQueryPlan(
			request({ context: { ...createContext(), signal: cancelledController.signal } }),
		);

		expect(invalid).toEqual({ status: "blocked", reason: "invalid_context" });
		expect(cancelled).toEqual({ status: "blocked", reason: "cancelled" });
	});
});
