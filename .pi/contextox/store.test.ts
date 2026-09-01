import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ContextOxStore, type CreateApprovalInput } from "./store.ts";

function approvalInput(overrides: Partial<CreateApprovalInput> = {}): CreateApprovalInput {
	return {
		missionId: "mission-1",
		proposalVersion: 1,
		requiredApprover: "owner-1",
		sessionId: "session-1",
		goal: "Define high-potential existing customers",
		title: "High-potential customer Contract",
		scope: "Customers with at least one completed purchase",
		rules: ["Aggregate payments by order before joining customer facts"],
		evidenceRefs: ["fixture://high-potential-customer-v0.1"],
		unknowns: ["Future purchase probability is not validated"],
		exceptions: ["Customers with only refunded orders are excluded"],
		examples: ["A customer with two completed orders satisfies the purchase-history scope"],
		counterexamples: ["A lead with no completed purchase is outside the scope"],
		impactSummary: "Creates the first governed operating-priority definition",
		...overrides,
	};
}

function temporaryDatabase(): { directory: string; path: string } {
	const directory = mkdtempSync(join(tmpdir(), "contextox-store-"));
	return { directory, path: join(directory, "contextox.sqlite") };
}

test("persists one idempotent pending approval across process restart", () => {
	const temporary = temporaryDatabase();
	try {
		const firstStore = new ContextOxStore(temporary.path);
		const first = firstStore.createApproval(approvalInput());
		const replay = firstStore.createApproval(approvalInput());
		assert.equal(first.created, true);
		assert.equal(replay.created, false);
		assert.equal(replay.request.id, first.request.id);
		firstStore.close();

		const reopenedStore = new ContextOxStore(temporary.path);
		assert.deepEqual(reopenedStore.listPending().map((request) => request.id), [first.request.id]);
		reopenedStore.close();
	} finally {
		rmSync(temporary.directory, { recursive: true, force: true });
	}
});

test("creates exactly one Contract v1 for an exact approval and replays it idempotently", () => {
	const temporary = temporaryDatabase();
	const store = new ContextOxStore(temporary.path);
	try {
		const { request } = store.createApproval(approvalInput());
		const decision = {
			requestId: request.id,
			expectedProposalVersion: request.proposalVersion,
			expectedProposalHash: request.proposalHash,
			actor: request.requiredApprover,
			outcome: "approve" as const,
			reason: "",
		};

		const first = store.decide(decision);
		const replay = store.decide(decision);
		assert.equal(first.request.status, "approved");
		assert.equal(first.contract?.version, 1);
		assert.equal(first.contract?.decisionId, first.decision.id);
		assert.equal(first.contract?.sourceRequestId, request.id);
		assert.equal(first.contract?.proposalHash, request.proposalHash);
		assert.equal(first.contract?.approvedBy, request.requiredApprover);
		assert.equal(first.contract?.approvedAt, first.decision.decidedAt);
		assert.equal(replay.replayed, true);
		assert.equal(replay.contract?.id, first.contract?.id);
		assert.equal(store.getDecisionResult(request.id)?.decision.id, first.decision.id);
		assert.throws(
			() => store.decide({ ...decision, outcome: "reject", reason: "changed my mind" }),
			/conflicting decision/,
		);
	} finally {
		store.close();
		rmSync(temporary.directory, { recursive: true, force: true });
	}
});

test("fails closed for the wrong actor, stale hash, or missing approval", () => {
	const temporary = temporaryDatabase();
	const store = new ContextOxStore(temporary.path);
	try {
		const { request } = store.createApproval(approvalInput());
		assert.equal(store.getContractForMission(request.missionId), undefined);
		assert.throws(
			() =>
				store.decide({
					requestId: request.id,
					expectedProposalVersion: request.proposalVersion,
					expectedProposalHash: request.proposalHash,
					actor: "someone-else",
					outcome: "approve",
				}),
			/not the required approver/,
		);
		assert.throws(
			() =>
				store.decide({
					requestId: request.id,
					expectedProposalVersion: request.proposalVersion,
					expectedProposalHash: "sha256:stale",
					actor: request.requiredApprover,
					outcome: "approve",
				}),
			/proposal hash does not match/,
		);
		assert.equal(store.getContractForMission(request.missionId), undefined);
		assert.equal(store.getRequest(request.id)?.status, "pending");
	} finally {
		store.close();
		rmSync(temporary.directory, { recursive: true, force: true });
	}
});

test("records rejection without creating a Contract", () => {
	const temporary = temporaryDatabase();
	const store = new ContextOxStore(temporary.path);
	try {
		const { request } = store.createApproval(approvalInput());
		const result = store.decide({
			requestId: request.id,
			expectedProposalVersion: request.proposalVersion,
			expectedProposalHash: request.proposalHash,
			actor: request.requiredApprover,
			outcome: "reject",
			reason: "The evidence does not support this rule",
		});

		assert.equal(result.request.status, "rejected");
		assert.equal(result.contract, undefined);
		assert.equal(store.getContractForMission(request.missionId), undefined);
	} finally {
		store.close();
		rmSync(temporary.directory, { recursive: true, force: true });
	}
});

test("rolls back an approval request when SQLite rejects the write", () => {
	const temporary = temporaryDatabase();
	const initializedStore = new ContextOxStore(temporary.path);
	initializedStore.close();
	const breaker = new DatabaseSync(temporary.path);
	breaker.exec(`
		CREATE TRIGGER fail_approval_request
		BEFORE INSERT ON approval_requests
		BEGIN
			SELECT RAISE(ABORT, 'simulated approval write failure');
		END;
	`);
	breaker.close();

	const store = new ContextOxStore(temporary.path);
	try {
		assert.throws(() => store.createApproval(approvalInput()), /simulated approval write failure/);
		assert.deepEqual(store.listPending(), []);
		assert.equal(store.getContractForMission("mission-1"), undefined);
	} finally {
		store.close();
		rmSync(temporary.directory, { recursive: true, force: true });
	}
});

test("requires a new proposal version after request_changes", () => {
	const temporary = temporaryDatabase();
	const store = new ContextOxStore(temporary.path);
	try {
		const first = store.createApproval(approvalInput()).request;
		const changed = store.decide({
			requestId: first.id,
			expectedProposalVersion: first.proposalVersion,
			expectedProposalHash: first.proposalHash,
			actor: first.requiredApprover,
			outcome: "request_changes",
			reason: "Clarify the exclusion rule",
		});
		assert.equal(changed.request.status, "changes_requested");

		assert.throws(() => store.createApproval(approvalInput()), /different or closed approval content/);
		const second = store.createApproval(
			approvalInput({ proposalVersion: 2, rules: ["Exclude refunded orders before customer aggregation"] }),
		).request;
		assert.equal(second.status, "pending");
		assert.equal(second.proposalVersion, 2);
		assert.equal(store.getContractForMission(first.missionId), undefined);

		const approved = store.decide({
			requestId: second.id,
			expectedProposalVersion: second.proposalVersion,
			expectedProposalHash: second.proposalHash,
			actor: second.requiredApprover,
			outcome: "approve",
		});
		assert.equal(approved.contract?.sourceRequestId, second.id);
		assert.equal(store.getDecisionResult(first.id)?.contract, undefined);
		assert.equal(
			store.decide({
				requestId: first.id,
				expectedProposalVersion: first.proposalVersion,
				expectedProposalHash: first.proposalHash,
				actor: first.requiredApprover,
				outcome: "request_changes",
				reason: "Clarify the exclusion rule",
			}).contract,
			undefined,
		);
	} finally {
		store.close();
		rmSync(temporary.directory, { recursive: true, force: true });
	}
});

test("invalidates a pending request when a newer frozen proposal replaces it", () => {
	const temporary = temporaryDatabase();
	const store = new ContextOxStore(temporary.path);
	try {
		const first = store.createApproval(approvalInput()).request;
		const second = store.createApproval(
			approvalInput({ proposalVersion: 2, impactSummary: "Supersedes the first frozen proposal" }),
		).request;

		assert.equal(store.getRequest(first.id)?.status, "invalidated");
		assert.deepEqual(store.listPending().map((request) => request.id), [second.id]);
		assert.throws(
			() =>
				store.decide({
					requestId: first.id,
					expectedProposalVersion: first.proposalVersion,
					expectedProposalHash: first.proposalHash,
					actor: first.requiredApprover,
					outcome: "approve",
				}),
			/not pending/,
		);
	} finally {
		store.close();
		rmSync(temporary.directory, { recursive: true, force: true });
	}
});
