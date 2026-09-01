import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ContextOxStore, type CreateApprovalInput, type DecisionResult, type ProposalSnapshot } from "../src/store.ts";

const SNAPSHOT: ProposalSnapshot = {
	goal: "Define high-potential existing customers",
	title: "High-potential customer Contract",
	scope: "Customers with at least one completed purchase",
	rules: ["Aggregate payments by order before joining customer facts"],
	evidenceRefs: ["fixture://high-potential-customer-v0.1"],
	unknowns: ["Future purchase probability is not validated"],
	exceptions: ["Customers with only refunded orders are excluded"],
	examples: ["A customer with completed purchases is in scope"],
	counterexamples: ["A lead with no completed purchase is outside the scope"],
	impactSummary: "Creates the first governed operating-priority definition",
};

function approvalInput(overrides: Partial<CreateApprovalInput> = {}): CreateApprovalInput {
	return {
		...SNAPSHOT,
		missionId: "mission-1",
		proposalVersion: 1,
		requiredApprover: "owner-1",
		sessionId: "session-1",
		...overrides,
	};
}

function approve(store: ContextOxStore): DecisionResult {
	const created = store.createApproval(approvalInput());
	return store.decide({
		requestId: created.request.id,
		expectedProposalVersion: created.request.proposalVersion,
		expectedProposalHash: created.request.proposalHash,
		actor: "owner-1",
		outcome: "approve",
	});
}

describe("ContextOxStore", () => {
	const cleanup: string[] = [];

	afterEach(() => {
		for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
	});

	function databasePath(): string {
		const directory = mkdtempSync(join(tmpdir(), "contextox-store-"));
		cleanup.push(directory);
		return join(directory, "contextox.sqlite");
	}

	it("persists a frozen proposal before entering the human wait state", () => {
		const store = new ContextOxStore(databasePath());
		try {
			const result = store.createApproval(approvalInput());
			expect(result.created).toBe(true);
			expect(result.request.status).toBe("pending");
			expect(result.request.requiredApprover).toBe("owner-1");
			expect(result.mission).toMatchObject({
				status: "waiting_for_human",
				currentProposalVersion: 1,
				resumeDelivery: "none",
			});
			expect(store.listPending()).toEqual([result.request]);
		} finally {
			store.close();
		}
	});

	it("fails closed for a wrong actor or stale proposal identity", () => {
		const store = new ContextOxStore(databasePath());
		try {
			const created = store.createApproval(approvalInput());
			expect(() =>
				store.decide({
					requestId: created.request.id,
					expectedProposalVersion: 1,
					expectedProposalHash: created.request.proposalHash,
					actor: "model-supplied-actor",
					outcome: "approve",
				}),
			).toThrow("actor is not the required approver");
			expect(() =>
				store.decide({
					requestId: created.request.id,
					expectedProposalVersion: 1,
					expectedProposalHash: "sha256:stale",
					actor: "owner-1",
					outcome: "approve",
				}),
			).toThrow("proposal hash does not match");
			expect(store.getContractForMission("mission-1")).toBeUndefined();
			expect(store.getRequest(created.request.id)?.status).toBe("pending");
		} finally {
			store.close();
		}
	});

	it("creates one Contract v1 and a pending resume delivery for approval", () => {
		const store = new ContextOxStore(databasePath());
		try {
			const first = approve(store);
			expect(first.contract).toMatchObject({
				missionId: "mission-1",
				version: 1,
				sourceRequestId: first.request.id,
				approvedBy: "owner-1",
			});
			expect(first.mission).toMatchObject({
				status: "completed",
				resumeDelivery: "pending",
				resumeRequestId: first.request.id,
			});

			const replay = store.decide({
				requestId: first.request.id,
				expectedProposalVersion: first.request.proposalVersion,
				expectedProposalHash: first.request.proposalHash,
				actor: "owner-1",
				outcome: "approve",
			});
			expect(replay.replayed).toBe(true);
			expect(replay.contract?.id).toBe(first.contract?.id);
		} finally {
			store.close();
		}
	});

	it("records request_changes as active and reject as blocked without resuming rejected work", () => {
		const changesStore = new ContextOxStore(databasePath());
		try {
			const created = changesStore.createApproval(approvalInput());
			const changed = changesStore.decide({
				requestId: created.request.id,
				expectedProposalVersion: 1,
				expectedProposalHash: created.request.proposalHash,
				actor: "owner-1",
				outcome: "request_changes",
				reason: "Add the refund boundary",
			});
			expect(changed.mission).toMatchObject({ status: "active", resumeDelivery: "pending" });

			const next = changesStore.createApproval(
				approvalInput({
					proposalVersion: 2,
					rules: [...SNAPSHOT.rules, "Exclude fully refunded orders"],
				}),
			);
			expect(next.request.proposalVersion).toBe(2);
			expect(next.mission.status).toBe("waiting_for_human");
			expect(next.mission.resumeRequestId).toBe(created.request.id);
		} finally {
			changesStore.close();
		}

		const rejectStore = new ContextOxStore(databasePath());
		try {
			const created = rejectStore.createApproval(approvalInput());
			const rejected = rejectStore.decide({
				requestId: created.request.id,
				expectedProposalVersion: 1,
				expectedProposalHash: created.request.proposalHash,
				actor: "owner-1",
				outcome: "reject",
				reason: "The evidence is insufficient",
			});
			expect(rejected.contract).toBeUndefined();
			expect(rejected.mission).toMatchObject({ status: "blocked", resumeDelivery: "none" });
			expect(rejectStore.listPendingResumeDeliveries()).toEqual([]);
		} finally {
			rejectStore.close();
		}
	});

	it("keeps the raw resume error pending until an awaited delivery succeeds", () => {
		const path = databasePath();
		const store = new ContextOxStore(path);
		const approved = approve(store);
		const rawError = "transport rejected: session unavailable\nretry later";
		const failed = store.markResumeFailed(approved.request.id, rawError);
		expect(failed.mission).toMatchObject({ resumeDelivery: "pending", resumeError: rawError });
		store.close();

		const reopened = new ContextOxStore(path);
		try {
			expect(reopened.listPendingResumeDeliveries()).toHaveLength(1);
			const dispatched = reopened.markResumeDispatched(approved.request.id);
			expect(dispatched.mission).toMatchObject({ resumeDelivery: "dispatched" });
			expect(dispatched.mission.resumeError).toBeUndefined();
			expect(reopened.markResumeDispatched(approved.request.id).changed).toBe(false);
			expect(reopened.listPendingResumeDeliveries()).toEqual([]);
		} finally {
			reopened.close();
		}
	});

	it("migrates prototype schema v1 without changing its stored business facts", () => {
		const path = databasePath();
		const legacy = new DatabaseSync(path);
		legacy.exec(`
			CREATE TABLE missions (
				id TEXT PRIMARY KEY,
				goal TEXT NOT NULL,
				scope TEXT NOT NULL,
				status TEXT NOT NULL,
				current_proposal_version INTEGER NOT NULL,
				session_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE approval_requests (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL REFERENCES missions(id),
				proposal_version INTEGER NOT NULL,
				proposal_hash TEXT NOT NULL,
				snapshot_json TEXT NOT NULL,
				required_approver TEXT NOT NULL,
				status TEXT NOT NULL,
				created_at TEXT NOT NULL,
				decided_at TEXT,
				UNIQUE (mission_id, proposal_version)
			);
			CREATE TABLE decisions (
				id TEXT PRIMARY KEY,
				request_id TEXT NOT NULL UNIQUE REFERENCES approval_requests(id),
				expected_proposal_version INTEGER NOT NULL,
				expected_proposal_hash TEXT NOT NULL,
				actor TEXT NOT NULL,
				outcome TEXT NOT NULL,
				reason TEXT NOT NULL,
				decided_at TEXT NOT NULL
			);
			CREATE TABLE contract_versions (
				id TEXT PRIMARY KEY,
				mission_id TEXT NOT NULL REFERENCES missions(id),
				version INTEGER NOT NULL,
				snapshot_json TEXT NOT NULL,
				decision_id TEXT NOT NULL UNIQUE REFERENCES decisions(id),
				created_at TEXT NOT NULL,
				UNIQUE (mission_id, version)
			);
			INSERT INTO missions VALUES (
				'mission-old', 'Legacy goal', 'Legacy scope', 'active', 0, 'session-old',
				'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
			);
			PRAGMA user_version = 1;
		`);
		legacy.close();

		const migrated = new ContextOxStore(path);
		try {
			expect(migrated.getMission("mission-old")).toMatchObject({
				goal: "Legacy goal",
				scope: "Legacy scope",
				status: "active",
				resumeDelivery: "none",
			});
		} finally {
			migrated.close();
		}
	});
});
