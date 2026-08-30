import { describe, expect, test } from "vitest";
import {
	InMemoryTraceStore,
	normalizeTraceAppendInput,
	normalizeTraceEvent,
	TRACE_CONTRACT_VERSION,
	type TraceAppendInput,
	TraceError,
} from "../src/index.ts";

const scope = {
	traceId: "trace-sales-1",
	runId: "run-sales-1",
	ownerId: "local-owner",
	workspaceId: "default-workspace",
};

function input(overrides: Partial<TraceAppendInput> = {}): TraceAppendInput {
	return {
		...scope,
		occurredAt: "2026-08-25T00:06:00Z",
		type: "session_created",
		details: { category: "session", status: "started" },
		...overrides,
	};
}

function expectTraceError(action: () => unknown, code: TraceError["code"]): void {
	try {
		action();
		throw new Error("expected TraceError");
	} catch (error) {
		expect(error).toBeInstanceOf(TraceError);
		expect((error as TraceError).code).toBe(code);
	}
}

describe("path-04 Trace", () => {
	test("assigns deterministic sequence and event IDs to fixed redacted details", () => {
		const store = new InMemoryTraceStore();
		const first = store.append(input());
		expect(store.append(input())).toEqual(first);
		const second = store.append(
			input({
				occurredAt: "2026-08-25T00:06:01Z",
				type: "result_recorded",
				details: {
					category: "result",
					resourceId: "result-sales-1",
					version: "1.0.0",
					digest: `sha256:${"1".repeat(64)}`,
					status: "complete",
					rows: 2,
					bytes: 128,
				},
			}),
		);
		const events = store.getEvents(scope);

		expect(first.contractVersion).toBe(TRACE_CONTRACT_VERSION);
		expect(first.sequence).toBe(1);
		expect(second.sequence).toBe(2);
		expect(first.eventId).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(second.eventId).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(events.map((event) => event.sequence)).toEqual([1, 2]);
		expect(store.getEvents(scope)).toEqual(events);
		expect(store.attemptedWrites).toBe(2);
		expectTraceError(
			() => normalizeTraceEvent({ ...first, eventId: `sha256:${"0".repeat(64)}` }),
			"sequence_conflict",
		);
	});

	test("does not accept arbitrary prompt, SQL, credential, or output fields", () => {
		const secret = "customer-password";
		let error: unknown;
		try {
			normalizeTraceAppendInput({
				...input(),
				details: {
					category: "tool",
					prompt: secret,
					sql: "SELECT secret FROM users",
				},
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(TraceError);
		expect(JSON.stringify(error)).not.toContain(secret);
		expect(JSON.stringify(error)).not.toContain("SELECT secret");

		expectTraceError(
			() =>
				normalizeTraceAppendInput({
					...input(),
					details: { category: "result", rows: -1 },
				}),
			"invalid_trace",
		);
	});

	test("enforces immutable trace ownership and run scope", () => {
		const store = new InMemoryTraceStore();
		store.append(input());
		expectTraceError(() => store.getEvents({ ...scope, ownerId: "other-owner" }), "owner_mismatch");
		expectTraceError(() => store.getEvents({ ...scope, workspaceId: "other-workspace" }), "workspace_mismatch");
		expectTraceError(() => store.getEvents({ ...scope, runId: "other-run" }), "run_mismatch");
		expectTraceError(() => store.append(input({ runId: "other-run" })), "run_mismatch");
	});

	test("does not expose a partial write when the store fails", () => {
		const store = new InMemoryTraceStore({ failAfterWrites: 1 });
		store.append(input());
		expectTraceError(
			() =>
				store.append(
					input({
						type: "warning",
						details: { category: "runtime", status: "blocked", reason: "store_failed" },
					}),
				),
			"store_failed",
		);
		expect(store.getEvents(scope)).toHaveLength(1);
		expect(store.attemptedWrites).toBe(1);
	});
});
