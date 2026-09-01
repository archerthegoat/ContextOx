import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextOxResumeAdapter } from "../src/resume-adapter.ts";
import { ContextOxStore, type CreateApprovalInput } from "../src/store.ts";

function approvalInput(): CreateApprovalInput {
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
		examples: ["A customer with completed purchases is in scope"],
		counterexamples: ["A lead with no completed purchase is outside the scope"],
		impactSummary: "Creates the first governed operating-priority definition",
	};
}

describe("ContextOxResumeAdapter", () => {
	const cleanup: string[] = [];

	afterEach(() => {
		for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
	});

	function createApprovedDatabase(): { path: string; requestId: string } {
		const directory = mkdtempSync(join(tmpdir(), "contextox-resume-"));
		cleanup.push(directory);
		const path = join(directory, "contextox.sqlite");
		const store = new ContextOxStore(path);
		const created = store.createApproval(approvalInput());
		store.decide({
			requestId: created.request.id,
			expectedProposalVersion: created.request.proposalVersion,
			expectedProposalHash: created.request.proposalHash,
			actor: "owner-1",
			outcome: "approve",
		});
		store.close();
		return { path, requestId: created.request.id };
	}

	it("persists a rejected awaitable send and retries after reopening", async () => {
		const { path, requestId } = createApprovedDatabase();
		const failure = new Error("session send rejected exactly");
		const failingSender = vi.fn(async () => {
			throw failure;
		});
		const first = new ContextOxResumeAdapter(path, "owner-1", { sendUserMessage: failingSender });
		await expect(first.deliver(requestId)).rejects.toBe(failure);
		expect(failingSender).toHaveBeenCalledOnce();
		expect(first.listPending()[0]).toMatchObject({
			resumeDelivery: "pending",
			resumeRequestId: requestId,
			resumeError: failure.message,
		});

		const successfulSender = vi.fn(async () => {});
		const reopened = new ContextOxResumeAdapter(path, "owner-1", { sendUserMessage: successfulSender });
		expect(await reopened.deliver(requestId)).toMatchObject({ status: "dispatched" });
		expect(await reopened.deliver(requestId)).toMatchObject({ status: "already_dispatched" });
		expect(successfulSender).toHaveBeenCalledOnce();
		expect(reopened.listPending()).toEqual([]);
	});

	it("does not let another actor deliver the persisted decision", async () => {
		const { path, requestId } = createApprovedDatabase();
		const sender = vi.fn(async () => {});
		const adapter = new ContextOxResumeAdapter(path, "intruder", { sendUserMessage: sender });
		await expect(adapter.deliver(requestId)).rejects.toThrow("only the actor who made this decision may resume it");
		expect(sender).not.toHaveBeenCalled();
	});

	it("never delivers a rejected decision", async () => {
		const directory = mkdtempSync(join(tmpdir(), "contextox-reject-"));
		cleanup.push(directory);
		const path = join(directory, "contextox.sqlite");
		const store = new ContextOxStore(path);
		const created = store.createApproval(approvalInput());
		store.decide({
			requestId: created.request.id,
			expectedProposalVersion: created.request.proposalVersion,
			expectedProposalHash: created.request.proposalHash,
			actor: "owner-1",
			outcome: "reject",
			reason: "Insufficient evidence",
		});
		store.close();

		const sender = vi.fn(async () => {});
		const adapter = new ContextOxResumeAdapter(path, "owner-1", { sendUserMessage: sender });
		await expect(adapter.deliver(created.request.id)).rejects.toThrow("must not resume");
		expect(sender).not.toHaveBeenCalled();
		expect(adapter.listPending()).toEqual([]);
	});
});
