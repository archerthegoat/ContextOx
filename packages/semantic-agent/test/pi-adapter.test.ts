import type { Agent } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import {
	digestRuntimeText,
	PiRuntimeAdapter,
	type PiRuntimeAdapterResult,
	type PiToolResultObservation,
	RuntimeHost,
	type RuntimeHostBudget,
	type RuntimeHostStartRequest,
} from "../src/index.ts";
import { attachPiAgent } from "../src/internal/pi-agent-adapter.ts";

type FakePiEventListener = (event: unknown, signal: AbortSignal) => void;

class FakePiEventSource {
	private readonly listeners = new Set<FakePiEventListener>();

	subscribe(listener: FakePiEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: unknown): void {
		const signal = new AbortController().signal;
		for (const listener of this.listeners) listener(event, signal);
	}
}

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
		runId: "run-pi-adapter-1",
		ownerId: "local-owner",
		workspaceId: "default-workspace",
		question: "过去 30 天按区域统计订单额",
		budget: createBudget(),
		...overrides,
	};
}

function createHost(request = createStartRequest()): RuntimeHost {
	const host = new RuntimeHost({ now: createClock() });
	host.start(request);
	return host;
}

function startExecuting(host: RuntimeHost, runId: string): void {
	host.apply(runId, { type: "planning_started" });
	host.apply(runId, { type: "plan_ready", planDigest: digestRuntimeText("approved-plan") });
}

function createAdapter(
	host: RuntimeHost,
	request: RuntimeHostStartRequest,
	options: Pick<ConstructorParameters<typeof PiRuntimeAdapter>[0], "normalizeToolResult" | "onListenerError"> = {},
): PiRuntimeAdapter {
	return new PiRuntimeAdapter({ host, runId: request.runId, ...options });
}

describe("path-04 Pi runtime adapter", () => {
	test("maps lifecycle and message metadata without crossing raw content", () => {
		const request = createStartRequest();
		const host = createHost(request);
		const adapter = createAdapter(host, request);
		const rawQuestion = "SELECT customer_secret FROM private_table";
		const rawAnswer = "private answer that must stay outside the adapter result";

		expect(adapter.ingest({ type: "agent_start" }).snapshot.status).toBe("planning");
		const start = adapter.ingest({
			type: "message_start",
			message: { role: "user", content: rawQuestion },
		});
		const end = adapter.ingest({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: rawAnswer }], stopReason: "stop" },
		});

		expect(start.disposition).toBe("applied");
		expect(end.disposition).toBe("applied");
		expect(JSON.stringify(start)).not.toContain(rawQuestion);
		expect(JSON.stringify(end)).not.toContain(rawAnswer);
		expect(JSON.stringify(host.getEvents(request.runId))).not.toContain(rawQuestion);
		expect(JSON.stringify(host.getEvents(request.runId))).not.toContain(rawAnswer);
	});

	test("bridges a fake Pi stream and requires an AlphaOx tool summary", () => {
		const request = createStartRequest();
		const host = createHost(request);
		startExecuting(host, request.runId);
		const adapter = createAdapter(host, request);
		const source = new FakePiEventSource();
		const results: PiRuntimeAdapterResult[] = [];
		adapter.subscribe((result) => results.push(result));
		const attachment = adapter.attach(source);

		expect(attachment.attached).toBe(true);
		const rawSql = "SELECT account_secret FROM restricted_table";
		source.emit({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "read-only-query",
			args: { rawSql },
		});
		source.emit({
			type: "tool_execution_update",
			toolCallId: "call-1",
			toolName: "read-only-query",
			args: { rawSql },
			partialResult: { rows: [["secret-row"]] },
		});
		source.emit({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "read-only-query",
			isError: false,
			result: {},
		});

		expect(host.getRun(request.runId)).toMatchObject({ status: "blocked", terminalReason: "evidence_required" });
		expect(host.getRun(request.runId).activeToolCallIds).toEqual([]);
		expect(results.map((result) => result.sourceType)).toEqual([
			"tool_execution_start",
			"tool_execution_update",
			"tool_execution_end",
		]);
		expect(JSON.stringify(results)).not.toContain(rawSql);
		expect(JSON.stringify(results)).not.toContain("secret-row");

		attachment.detach();
		const resultCount = results.length;
		source.emit({ type: "agent_start" });
		expect(results).toHaveLength(resultCount);
	});

	test("passes only a sanitized successful tool summary to the Host", () => {
		const request = createStartRequest({ runId: "run-pi-adapter-summary" });
		const host = createHost(request);
		startExecuting(host, request.runId);
		let observation: PiToolResultObservation | undefined;
		const adapter = createAdapter(host, request, {
			normalizeToolResult: (value) => {
				observation = value;
				return { status: "complete", rows: 2, bytes: 80, evidenceReady: true };
			},
		});

		adapter.ingest({
			type: "tool_execution_start",
			toolCallId: "call-2",
			toolName: "read-only-query",
			args: { secret: "hidden" },
		});
		const completed = adapter.ingest({
			type: "tool_execution_end",
			toolCallId: "call-2",
			toolName: "read-only-query",
			isError: false,
			result: { rows: [["hidden"]], password: "hidden" },
		});

		expect(completed.disposition).toBe("applied");
		expect(completed.snapshot.activeToolCallIds).toEqual([]);
		expect(observation).toMatchObject({ callId: "call-2", toolName: "read-only-query", isError: false });
		expect(observation?.resultDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(JSON.stringify(observation)).not.toContain("hidden");
	});

	test("does not let a normal agent_end event claim AlphaOx complete", () => {
		const request = createStartRequest({ runId: "run-pi-adapter-end" });
		const host = createHost(request);
		startExecuting(host, request.runId);
		const adapter = createAdapter(host, request);

		const result = adapter.ingest({ type: "agent_end", messages: [] });

		expect(result).toMatchObject({ disposition: "ignored", reason: "terminal_result_required" });
		expect(result.snapshot.status).toBe("executing");
		expect(host.getEvents(request.runId).at(-1)?.type).toBe("plan_ready");

		const completed = host.apply(request.runId, { type: "run_completed", resultReady: true, evidenceReady: true });
		expect(completed.snapshot.status).toBe("complete");
	});

	test("fails closed for unknown events and malformed tool identities", () => {
		const unknownRequest = createStartRequest({ runId: "run-pi-adapter-unknown" });
		const unknownHost = createHost(unknownRequest);
		const unknownAdapter = createAdapter(unknownHost, unknownRequest);
		const unknown = unknownAdapter.ingest({ type: "future_event", payload: "raw secret" });

		expect(unknown).toMatchObject({ disposition: "blocked", reason: "invalid_pi_event" });
		expect(unknown.snapshot).toMatchObject({ status: "blocked", terminalReason: "invalid_runtime_event" });
		expect(JSON.stringify(unknown)).not.toContain("raw secret");

		const unsafeRequest = createStartRequest({ runId: "run-pi-adapter-unsafe" });
		const unsafeHost = createHost(unsafeRequest);
		startExecuting(unsafeHost, unsafeRequest.runId);
		const unsafeAdapter = createAdapter(unsafeHost, unsafeRequest);
		const unsafe = unsafeAdapter.ingest({
			type: "tool_execution_start",
			toolCallId: "call-unsafe",
			toolName: "tool/with-path",
			args: { code: "rm -rf" },
		});

		expect(unsafe).toMatchObject({ disposition: "blocked", reason: "invalid_tool_call" });
		expect(unsafe.snapshot).toMatchObject({ status: "blocked", terminalReason: "unsafe_tool_request" });
	});

	test("maps Pi runtime errors without exposing the provider error text", () => {
		const request = createStartRequest({ runId: "run-pi-adapter-error" });
		const host = createHost(request);
		startExecuting(host, request.runId);
		const adapter = createAdapter(host, request);
		const providerError = "provider token and private response";

		const result = adapter.ingest({
			type: "message_end",
			message: { role: "assistant", content: [], stopReason: "error", errorMessage: providerError },
		});

		expect(result).toMatchObject({ disposition: "blocked", reason: "runtime_failed" });
		expect(result.snapshot).toMatchObject({ status: "blocked", terminalReason: "runtime_failed" });
		expect(JSON.stringify(result)).not.toContain(providerError);
	});

	test("turns an unavailable event source into a blocked run", () => {
		const request = createStartRequest({ runId: "run-pi-adapter-source" });
		const host = createHost(request);
		const adapter = createAdapter(host, request);

		const attachment = adapter.attach({});

		expect(attachment.attached).toBe(false);
		expect(attachment.failure).toMatchObject({ disposition: "blocked", reason: "runtime_unavailable" });
		expect(host.getRun(request.runId)).toMatchObject({ status: "blocked", terminalReason: "runtime_unavailable" });
	});

	test("keeps the typed Pi bridge internal while attaching a fake Agent source", () => {
		const request = createStartRequest({ runId: "run-pi-adapter-bridge" });
		const host = createHost(request);
		const adapter = createAdapter(host, request);
		const source = new FakePiEventSource();
		const agent = source as unknown as Agent;

		const attachment = attachPiAgent(adapter, agent);
		expect(attachment.attached).toBe(true);
		source.emit({ type: "agent_start" });
		expect(host.getRun(request.runId).status).toBe("planning");
		attachment.detach();
	});
});
