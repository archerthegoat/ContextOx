import { describe, expect, test } from "vitest";
import {
	digestRuntimeText,
	InMemoryRuntimeStateStore,
	RuntimeHost,
	type RuntimeHostBudget,
	RuntimeHostError,
	type RuntimeHostEvent,
	type RuntimeHostStartRequest,
} from "../src/index.ts";

function createClock(): () => string {
	let seconds = 0;
	return () => {
		const value = new Date(Date.parse("2026-08-26T00:00:00Z") + seconds * 1000).toISOString();
		seconds += 1;
		return value;
	};
}

function createBudget(overrides: Partial<RuntimeHostBudget> = {}): RuntimeHostBudget {
	return { maxSteps: 5, maxRows: 100, maxBytes: 10_000, ...overrides };
}

function createStartRequest(overrides: Partial<RuntimeHostStartRequest> = {}): RuntimeHostStartRequest {
	return {
		runId: "run-host-1",
		ownerId: "local-owner",
		workspaceId: "default-workspace",
		question: "过去 30 天按区域统计订单额",
		budget: createBudget(),
		...overrides,
	};
}

function createHost(store = new InMemoryRuntimeStateStore()): RuntimeHost {
	return new RuntimeHost({ store, now: createClock() });
}

function startExecuting(host: RuntimeHost, request = createStartRequest()): void {
	host.start(request);
	host.apply(request.runId, { type: "planning_started" });
	host.apply(request.runId, { type: "plan_ready", planDigest: digestRuntimeText("plan-1") });
}

describe("path-04 runtime host", () => {
	test("creates a queued run without persisting the raw question", () => {
		const host = createHost();
		const snapshot = host.start(createStartRequest());

		expect(snapshot).toMatchObject({
			contractVersion: "runtime.v1",
			runId: "run-host-1",
			ownerId: "local-owner",
			workspaceId: "default-workspace",
			status: "queued",
			used: { steps: 0, rows: 0, bytes: 0 },
			activeToolCallIds: [],
			eventCount: 1,
		});
		expect(snapshot.questionDigest).toBe(digestRuntimeText("过去 30 天按区域统计订单额"));
		expect(JSON.stringify(host.getEvents("run-host-1"))).not.toContain("过去 30 天按区域统计订单额");
		expect(host.getEvents("run-host-1")[0]).toMatchObject({ type: "run_created", status: "queued", sequence: 1 });
	});

	test("runs a bounded tool lifecycle and only completes with evidence", () => {
		const host = createHost();
		startExecuting(host);

		const requested = host.apply("run-host-1", {
			type: "tool_call_requested",
			callId: "call-query-1",
			toolName: "read-only-query",
			inputDigest: digestRuntimeText("query-input"),
		});
		expect(requested.accepted).toBe(true);
		expect(requested.snapshot.activeToolCallIds).toEqual(["call-query-1"]);
		expect(requested.snapshot.used.steps).toBe(1);

		const completed = host.apply("run-host-1", {
			type: "tool_call_completed",
			callId: "call-query-1",
			status: "complete",
			rows: 3,
			bytes: 120,
			evidenceReady: true,
		});
		expect(completed.snapshot).toMatchObject({
			status: "executing",
			activeToolCallIds: [],
			used: { steps: 1, rows: 3, bytes: 120 },
		});

		const finished = host.apply("run-host-1", {
			type: "run_completed",
			resultReady: true,
			evidenceReady: true,
		});
		expect(finished.snapshot.status).toBe("complete");
		expect(finished.snapshot.terminalReason).toBeUndefined();
		expect(host.getEvents("run-host-1").map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	test("fails closed when a completion has no evidence", () => {
		const host = createHost();
		startExecuting(host);
		host.apply("run-host-1", {
			type: "tool_call_requested",
			callId: "call-query-1",
			toolName: "read-only-query",
			inputDigest: digestRuntimeText("query-input"),
		});

		const transition = host.apply("run-host-1", {
			type: "tool_call_completed",
			callId: "call-query-1",
			status: "complete",
			rows: 1,
			bytes: 10,
			evidenceReady: false,
		});

		expect(transition.snapshot.status).toBe("blocked");
		expect(transition.snapshot.terminalReason).toBe("evidence_required");
		expect(transition.snapshot.activeToolCallIds).toEqual([]);
	});

	test("does not allow a run to complete with a pending tool call", () => {
		const host = createHost();
		startExecuting(host);
		host.apply("run-host-1", {
			type: "tool_call_requested",
			callId: "call-query-1",
			toolName: "read-only-query",
			inputDigest: digestRuntimeText("query-input"),
		});

		const transition = host.apply("run-host-1", {
			type: "run_completed",
			resultReady: true,
			evidenceReady: true,
		});

		expect(transition.snapshot.status).toBe("blocked");
		expect(transition.snapshot.terminalReason).toBe("invalid_transition");
		expect(transition.snapshot.activeToolCallIds).toEqual([]);
	});

	test("blocks a second tool request before it can exceed the step budget", () => {
		const host = createHost();
		const request = createStartRequest({ budget: createBudget({ maxSteps: 1 }) });
		startExecuting(host, request);
		host.apply(request.runId, {
			type: "tool_call_requested",
			callId: "call-query-1",
			toolName: "read-only-query",
			inputDigest: digestRuntimeText("query-input-1"),
		});

		const transition = host.apply(request.runId, {
			type: "tool_call_requested",
			callId: "call-query-2",
			toolName: "read-only-query",
			inputDigest: digestRuntimeText("query-input-2"),
		});

		expect(transition.snapshot.status).toBe("blocked");
		expect(transition.snapshot.terminalReason).toBe("budget_exhausted");
		expect(transition.snapshot.activeToolCallIds).toEqual([]);
	});

	test("blocks a tool result that exceeds the row budget", () => {
		const host = createHost();
		const request = createStartRequest({ budget: createBudget({ maxRows: 2 }) });
		startExecuting(host, request);
		host.apply(request.runId, {
			type: "tool_call_requested",
			callId: "call-query-1",
			toolName: "read-only-query",
			inputDigest: digestRuntimeText("query-input"),
		});

		const transition = host.apply(request.runId, {
			type: "tool_call_completed",
			callId: "call-query-1",
			status: "complete",
			rows: 3,
			bytes: 10,
			evidenceReady: true,
		});

		expect(transition.snapshot.status).toBe("blocked");
		expect(transition.snapshot.terminalReason).toBe("budget_exhausted");
		expect(transition.snapshot.used.rows).toBe(0);
	});

	test("turns malformed runtime input into a terminal blocked run", () => {
		const host = createHost();
		startExecuting(host);
		host.apply("run-host-1", {
			type: "tool_call_requested",
			callId: "call-query-1",
			toolName: "read-only-query",
			inputDigest: digestRuntimeText("query-input"),
		});

		const transition = host.apply("run-host-1", {
			type: "tool_call_requested",
			callId: "call-query-1",
			toolName: "read-only-query",
			inputDigest: "not-a-digest",
		});

		expect(transition.accepted).toBe(false);
		expect(transition.snapshot.status).toBe("blocked");
		expect(transition.snapshot.terminalReason).toBe("invalid_runtime_event");
		expect(transition.snapshot.activeToolCallIds).toEqual([]);
		expect(transition.event?.type).toBe("invalid_runtime_event");
	});

	test("supports clarification and bounded disconnect recovery", () => {
		const host = createHost();
		startExecuting(host);

		const clarification = host.apply("run-host-1", {
			type: "clarification_required",
			questionDigest: digestRuntimeText("请确认时间范围"),
		});
		expect(clarification.snapshot.status).toBe("awaiting_clarification");
		expect(host.apply("run-host-1", { type: "clarification_received" }).snapshot.status).toBe("planning");
		expect(
			host.apply("run-host-1", { type: "plan_ready", planDigest: digestRuntimeText("plan-2") }).snapshot.status,
		).toBe("executing");

		expect(host.apply("run-host-1", { type: "runtime_disconnected" }).snapshot).toMatchObject({
			status: "reconnecting",
			resumeStatus: "executing",
		});
		expect(host.apply("run-host-1", { type: "runtime_reconnected" }).snapshot).toMatchObject({
			status: "executing",
		});
		expect(host.getRun("run-host-1").resumeStatus).toBeUndefined();
	});

	test("requires the owner to cancel and records cancellation as blocked", () => {
		const host = createHost();
		startExecuting(host);

		expect(() => host.cancel("run-host-1", "other-owner")).toThrowError(new RuntimeHostError("owner_mismatch"));
		expect(host.getRun("run-host-1").status).toBe("executing");
		expect(host.cancel("run-host-1", "local-owner").status).toBe("cancelling");
		expect(host.apply("run-host-1", { type: "cancelled" }).snapshot).toMatchObject({
			status: "blocked",
			terminalReason: "cancelled",
		});
		expect(host.cancel("run-host-1", "local-owner").status).toBe("blocked");
	});

	test("keeps a runtime failure partial only when a result is available", () => {
		const host = createHost();
		startExecuting(host);

		const transition = host.apply("run-host-1", {
			type: "runtime_failed",
			code: "runtime_unavailable",
			resultAvailable: true,
		});

		expect(transition.snapshot.status).toBe("partial");
		expect(transition.snapshot.terminalReason).toBe("runtime_unavailable");
		expect(transition.snapshot.activeToolCallIds).toEqual([]);
	});

	test("does not mutate snapshots or event history returned by the store", () => {
		const store = new InMemoryRuntimeStateStore();
		const host = createHost(store);
		const snapshot = host.start(createStartRequest());
		const activeToolCallIds = snapshot.activeToolCallIds as string[];
		activeToolCallIds.push("not-allowed");
		const events = host.getEvents("run-host-1") as RuntimeHostEvent[];
		events.pop();

		expect(host.getRun("run-host-1").activeToolCallIds).toEqual([]);
		expect(host.getEvents("run-host-1")).toHaveLength(1);
	});
});
