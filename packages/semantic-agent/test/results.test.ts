import { describe, expect, test } from "vitest";
import {
	ANALYSIS_CONTRACT_VERSION,
	createResultEnvelope,
	minimizeResult,
	normalizeResultEnvelope,
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
			columnId: "customer-name",
			label: "Customer",
			dataType: "string",
			nullable: true,
			source: { tableId: "customers", columnId: "customer-name" },
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
		[1, "secret-customer", 120.5],
		[2, "another-customer", 80],
	],
	rowCount: 2,
};

function readyResult(overrides: Partial<Parameters<typeof createResultEnvelope>[0]> = {}): ResultEnvelope {
	const minimized = minimizeResult(candidate, {
		ruleRefs: [{ ruleId: "redact-customer", version: "1.0.0" }],
		allowedColumnIds: ["order-id", "order-total"],
		maxRows: 10,
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
		...overrides,
	});
}

describe("path-03 ResultEnvelope", () => {
	test("minimizes columns and applies row and byte budgets deterministically", () => {
		const minimized = minimizeResult(candidate, {
			ruleRefs: [{ ruleId: "redact-customer", version: "1.0.0" }],
			allowedColumnIds: ["order-id", "order-total"],
			maxRows: 1,
			maxBytes: 1000,
		});

		expect(minimized).toEqual({
			status: "ready",
			columns: [candidate.columns[0], candidate.columns[2]],
			rows: [[1, 120.5]],
			rowCount: 2,
			returnedCount: 1,
			truncated: true,
			ruleRefs: [{ ruleId: "redact-customer", version: "1.0.0" }],
			removedColumnIds: ["customer-name"],
			warnings: ["privacy_minimized", "result_truncated"],
		});

		const byteLimited = minimizeResult(candidate, {
			ruleRefs: [],
			allowedColumnIds: ["order-id", "order-total"],
			maxRows: 10,
			maxBytes: 5,
		});
		expect(byteLimited.status).toBe("ready");
		if (byteLimited.status !== "ready") return;
		expect(byteLimited.returnedCount).toBe(0);
		expect(byteLimited.truncated).toBe(true);
		expect(byteLimited.warnings).toContain("result_truncated");
	});

	test("blocks invalid candidates and policies instead of releasing an unminimized result", () => {
		expect(
			minimizeResult(
				{ ...candidate, rows: [[1]] },
				{
					ruleRefs: [],
					allowedColumnIds: ["order-id"],
					maxRows: 10,
					maxBytes: 1000,
				},
			),
		).toEqual({ status: "blocked", reason: "invalid_candidate" });
		expect(
			minimizeResult(candidate, {
				ruleRefs: [],
				allowedColumnIds: ["unknown-column"],
				maxRows: 10,
				maxBytes: 1000,
			}),
		).toEqual({ status: "blocked", reason: "invalid_candidate" });
		expect(
			minimizeResult(candidate, {
				ruleRefs: [],
				allowedColumnIds: [],
				maxRows: 10,
				maxBytes: 1000,
			}),
		).toEqual({ status: "blocked", reason: "privacy_blocked" });
	});

	test("creates a complete envelope for an empty result and a partial envelope for truncation", () => {
		const emptyCandidate: ResultCandidate = { columns: candidate.columns, rows: [], rowCount: 0 };
		const emptyMinimized = minimizeResult(emptyCandidate, {
			ruleRefs: [],
			allowedColumnIds: ["order-id"],
			maxRows: 10,
			maxBytes: 1000,
		});
		if (emptyMinimized.status !== "ready") throw new Error("empty fixture minimization failed");
		const empty = readyResult({ minimized: emptyMinimized });
		expect(empty.status).toBe("complete");
		expect(empty.rows).toEqual([]);
		expect(empty.truncated).toBe(false);

		const partialMinimized = minimizeResult(candidate, {
			ruleRefs: [],
			allowedColumnIds: ["order-id", "customer-name", "order-total"],
			maxRows: 1,
			maxBytes: 1000,
		});
		if (partialMinimized.status !== "ready") throw new Error("partial fixture minimization failed");
		const partial = readyResult({ minimized: partialMinimized });
		expect(partial.status).toBe("partial");
		expect(partial.truncated).toBe(true);
		expect(partial.warnings).toEqual([{ code: "result_truncated" }]);
	});

	test("rejects row shape and status inconsistencies", () => {
		const result = readyResult();
		expect(() => normalizeResultEnvelope({ ...result, rows: [[1]] })).toThrow("row width");
		expect(() => normalizeResultEnvelope({ ...result, status: "complete", truncated: true })).toThrow("truncation");
		expect(() =>
			normalizeResultEnvelope({
				...result,
				status: "blocked",
				rows: [],
				rowCount: 0,
				returnedCount: 0,
				truncated: false,
				canTransform: true,
				canEvidence: false,
			}),
		).toThrow("downstream");
	});

	test("keeps the versioned result contract strict", () => {
		const result = readyResult();
		expect(result.contractVersion).toBe(ANALYSIS_CONTRACT_VERSION);
		expect(() => normalizeResultEnvelope({ ...result, unexpected: "raw-output" })).toThrow("Invalid ResultEnvelope");
	});
});
