import { describe, expect, test } from "vitest";
import {
	ANALYSIS_CONTRACT_VERSION,
	createEvidenceEnvelope,
	createResultEnvelope,
	EvidenceStoreError,
	InMemoryEvidenceStore,
	minimizeResult,
	type ResultEnvelope,
	type ResultLineage,
	STORED_EVIDENCE_CONTRACT_VERSION,
	type StoredEvidence,
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

function makeResult(): ResultEnvelope {
	const minimized = minimizeResult(
		{
			columns: [
				{
					columnId: "order-total",
					label: "Order total",
					dataType: "decimal",
					nullable: false,
				},
			],
			rows: [[120.5]],
			rowCount: 1,
		},
		{ ruleRefs: [], allowedColumnIds: ["order-total"], maxRows: 10, maxBytes: 1000 },
	);
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
	});
}

function makeEvidence(): StoredEvidence["evidence"] {
	return createEvidenceEnvelope({
		evidenceId: "evidence-sales-1",
		evidenceVersion: "1.0.0",
		planRef: { kind: "analysis_plan", id: "sales-plan", version: "1.0.0" },
		contextPack: { kind: "context_pack", id: "sales-context", version: "1.0.0" },
		result: makeResult(),
		policyDecisions: [
			{
				permission: { policyId: "policy-sales", policyVersion: "1.0.0" },
				resource: { kind: "binding_execution_spec", id: "sales-exec", version: "1.0.0" },
				decision: "allow",
			},
		],
	});
}

function makeRecord(overrides: Partial<StoredEvidence> = {}): StoredEvidence {
	return {
		contractVersion: STORED_EVIDENCE_CONTRACT_VERSION,
		kind: "stored_evidence",
		evidence: makeEvidence(),
		ownerId: "local-owner",
		workspaceId: "default-workspace",
		traceId: "trace-sales-1",
		recordedAt: "2026-08-25T00:06:00Z",
		...overrides,
	};
}

function expectStoreError(action: () => unknown, code: EvidenceStoreError["code"]): void {
	try {
		action();
		throw new Error("expected EvidenceStoreError");
	} catch (error) {
		expect(error).toBeInstanceOf(EvidenceStoreError);
		expect((error as EvidenceStoreError).code).toBe(code);
	}
}

describe("path-04 Evidence store", () => {
	test("stores normalized evidence by owner/workspace and is idempotent", () => {
		const store = new InMemoryEvidenceStore();
		const record = makeRecord();
		const written = store.put(record);
		expect(written).toEqual(record);
		expect(store.put(record)).toEqual(record);
		expect(store.attemptedWrites).toBe(1);
		expect(
			store.get({
				ownerId: record.ownerId,
				workspaceId: record.workspaceId,
				runId: record.evidence.runId,
				evidenceId: record.evidence.evidenceId,
			}),
		).toEqual(record);
		expect(store.list({ ownerId: record.ownerId, workspaceId: record.workspaceId })).toEqual([record]);
	});

	test("blocks scope, trace, conflict, and integrity mismatches", () => {
		const store = new InMemoryEvidenceStore();
		const record = makeRecord();
		store.put(record);
		expectStoreError(
			() =>
				store.get({
					ownerId: "other-owner",
					workspaceId: record.workspaceId,
					runId: record.evidence.runId,
					evidenceId: record.evidence.evidenceId,
				}),
			"owner_mismatch",
		);
		expectStoreError(
			() =>
				store.put({
					...record,
					traceId: "trace-other",
				}),
			"trace_mismatch",
		);
		expectStoreError(
			() =>
				store.put({
					...record,
					recordedAt: "2026-08-25T00:07:00Z",
				}),
			"evidence_conflict",
		);
		expectStoreError(
			() =>
				store.put({
					...record,
					evidence: {
						...record.evidence,
						integrity: { ...record.evidence.integrity, digest: `sha256:${"0".repeat(64)}` },
					},
				}),
			"invalid_evidence",
		);
	});

	test("fails closed on injected store failure without a partial record", () => {
		const store = new InMemoryEvidenceStore({ failAfterWrites: 0 });
		const record = makeRecord();
		expectStoreError(() => store.put(record), "store_failed");
		expect(store.attemptedWrites).toBe(0);
		expect(store.list({ ownerId: record.ownerId, workspaceId: record.workspaceId })).toEqual([]);
		const secret = "credential-value";
		expectStoreError(
			() =>
				store.put({
					...record,
					credential: secret,
				}),
			"invalid_evidence",
		);
		expect(JSON.stringify(store.list({ ownerId: record.ownerId, workspaceId: record.workspaceId }))).not.toContain(
			secret,
		);
	});

	test("keeps the Path3 envelope contract instead of copying result rows", () => {
		const evidence = makeEvidence();
		expect(evidence.contractVersion).toBe(ANALYSIS_CONTRACT_VERSION);
		expect(JSON.stringify(evidence)).not.toContain("120.5");
		expect(evidence.result).toEqual({ resultId: "result-sales-1", resultVersion: "1.0.0" });
	});
});
