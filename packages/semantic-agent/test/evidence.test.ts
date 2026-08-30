import { describe, expect, test } from "vitest";
import {
	ANALYSIS_CONTRACT_VERSION,
	type CompiledQuery,
	createEvidenceEnvelope,
	createResultEnvelope,
	type EvidencePolicyDecision,
	minimizeResult,
	normalizeEvidenceEnvelope,
	type ResultCandidate,
	type ResultEnvelope,
	type ResultLineage,
} from "../src/index.ts";

const freshness = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
};

const lineage: ResultLineage = {
	source: { sourceId: "sales-db", version: "1.0.0" },
	snapshot: { kind: "source_snapshot", id: "sales-snapshot", version: "1.0.0" },
	binding: { kind: "source_binding", id: "gross-sales", version: "1.0.0" },
	executionSpec: { kind: "binding_execution_spec", id: "sales-exec", version: "1.0.0" },
};

const candidate: ResultCandidate = {
	columns: [
		{
			columnId: "order-id",
			label: "Order ID",
			dataType: "integer",
			nullable: false,
			source: { tableId: "orders", columnId: "order-id" },
		},
		{
			columnId: "order-total",
			label: "Order total",
			dataType: "decimal",
			nullable: false,
			source: { tableId: "orders", columnId: "order-total" },
		},
	],
	rows: [
		[1, 120.5],
		[2, 80],
	],
	rowCount: 2,
};

const compiledQuery: CompiledQuery = {
	contractVersion: ANALYSIS_CONTRACT_VERSION,
	readOnly: true,
	dialect: "fixture-sql",
	text: 'SELECT "order_id", "order_total" FROM "orders" WHERE "customer_id" = $1 LIMIT $2',
	parameters: [
		{ index: 1, role: "filter", type: "string", value: "secret-filter-value" },
		{ index: 2, role: "limit", type: "number", value: 10 },
	],
	source: lineage.source,
	snapshot: lineage.snapshot,
	binding: lineage.binding,
	executionSpec: lineage.executionSpec,
	queryPlan: { kind: "query_plan", id: "sales-query", version: "1.0.0" },
	asOf: freshness.asOf,
	planDigest: `sha256:${"1".repeat(64)}`,
	queryDigest: `sha256:${"2".repeat(64)}`,
	estimatedRows: 2,
	estimatedBytes: 256,
	estimatedCost: 0.2,
	limit: 10,
	warnings: [],
};

const policyDecisions: EvidencePolicyDecision[] = [
	{
		permission: { policyId: "policy-sales", policyVersion: "1.0.0" },
		resource: { kind: "query_plan", id: "sales-query", version: "1.0.0" },
		decision: "allow",
	},
	{
		permission: { policyId: "policy-sales", policyVersion: "1.0.0" },
		resource: { kind: "binding_execution_spec", id: "sales-exec", version: "1.0.0" },
		decision: "allow",
	},
];

function makeResult(maxRows = 10, canEvidence = true): ResultEnvelope {
	const minimized = minimizeResult(candidate, {
		ruleRefs: [],
		allowedColumnIds: ["order-id", "order-total"],
		maxRows,
		maxBytes: 1000,
	});
	if (minimized.status !== "ready") throw new Error("fixture minimization failed");
	return createResultEnvelope({
		resultId: "result-sales-1",
		resultVersion: "1.0.0",
		runId: "run-sales-1",
		stepId: "step-query-1",
		lineage,
		asOf: freshness.asOf,
		freshness,
		minimized,
		canEvidence,
	});
}

function evidenceInput(result: ResultEnvelope) {
	return {
		evidenceId: "evidence-sales-1",
		evidenceVersion: "1.0.0",
		planRef: { kind: "analysis_plan" as const, id: "plan-sales", version: "1.0.0" },
		contextPack: { kind: "context_pack" as const, id: "sales-context", version: "1.0.0" },
		result,
		compiledQuery,
		policyDecisions,
		transformations: [
			{ stepId: "step-query-1", operation: "project" as const },
			{ stepId: "step-query-1", operation: "redact" as const },
		],
		upstreamResultRefs: [{ resultId: "result-context-1", resultVersion: "1.0.0" }],
	};
}

describe("path-03 EvidenceEnvelope", () => {
	test("contains exact references and summaries without row or parameter values", () => {
		const evidence = createEvidenceEnvelope(evidenceInput(makeResult()));

		expect(evidence.status).toBe("complete");
		expect(evidence.result).toEqual({ resultId: "result-sales-1", resultVersion: "1.0.0" });
		expect(evidence.lineage).toEqual(lineage);
		expect(evidence.query).toEqual({
			queryDigest: compiledQuery.queryDigest,
			parameterSummary: [
				{ index: 1, role: "filter", type: "string" },
				{ index: 2, role: "limit", type: "number" },
			],
			readOnly: true,
		});
		expect(evidence.integrity).toEqual({
			status: "complete",
			digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
		});
		expect(evidence.transformations).toHaveLength(2);
		expect(JSON.stringify(evidence)).not.toContain("secret-filter-value");
		expect(JSON.stringify(evidence)).not.toContain("120.5");
		expect(normalizeEvidenceEnvelope(evidence)).toEqual(evidence);
		expect(createEvidenceEnvelope(evidenceInput(makeResult()))).toEqual(evidence);
	});

	test("propagates truncation as partial, incomplete evidence", () => {
		const evidence = createEvidenceEnvelope(evidenceInput(makeResult(1)));

		expect(evidence.status).toBe("partial");
		expect(evidence.integrity.status).toBe("incomplete");
		expect(evidence.warnings).toEqual(["partial_result", "result_truncated"]);
		expect(evidence.errors).toEqual([{ code: "partial_result" }]);
		expect(evidence.observations).toContainEqual({ kind: "truncated", value: true });
	});

	test("does not construct evidence when a result opts out", () => {
		expect(() => createEvidenceEnvelope(evidenceInput(makeResult(10, false)))).toThrow("not ready");
	});

	test("rejects tampered integrity and duplicate references", () => {
		const evidence = createEvidenceEnvelope(evidenceInput(makeResult()));
		const tampered = {
			...evidence,
			integrity: { ...evidence.integrity, digest: `sha256:${"0".repeat(64)}` },
		};
		expect(() => normalizeEvidenceEnvelope(tampered)).toThrow("integrity digest");

		expect(() =>
			createEvidenceEnvelope({
				...evidenceInput(makeResult()),
				upstreamResultRefs: [
					{ resultId: "result-context-1", resultVersion: "1.0.0" },
					{ resultId: "result-context-1", resultVersion: "1.0.0" },
				],
			}),
		).toThrow("Duplicate upstream");
		expect(() =>
			createEvidenceEnvelope({
				...evidenceInput(makeResult()),
				compiledQuery: {
					...compiledQuery,
					parameters: [...compiledQuery.parameters, { index: 1, role: "limit", type: "number", value: 20 }],
				},
			}),
		).toThrow("Duplicate query parameter");
		expect(() =>
			createEvidenceEnvelope({
				...evidenceInput(makeResult()),
				observations: [{ kind: "row_count", value: 2 }],
			}),
		).toThrow("Duplicate evidence observation");
	});
});
