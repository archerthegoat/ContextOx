import Type, { type Static } from "typebox";
import { describe, expect, test, vi } from "vitest";
import {
	type ControlledDataToolDefinition,
	type ControlledToolExecution,
	ControlledToolRegistry,
	type ControlledToolRegistryOptions,
	digestRuntimeText,
	InMemoryRuntimeStateStore,
	LoopController,
	type LoopControllerOptions,
	type LoopControllerStartRequest,
	type LoopDecision,
	type LoopDriver,
	type LoopToolInvocation,
	type LoopTurnContext,
	RuntimeHost,
	type RuntimeHostBudget,
} from "../src/index.ts";

const InputSchema = Type.Object(
	{
		queryPlanId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
		queryPlanVersion: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" }),
	},
	{ additionalProperties: false },
);

const OutputSchema = Type.Object(
	{
		rows: Type.Array(
			Type.Object(
				{
					region: Type.String(),
					total: Type.Number(),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 10 },
		),
		metadata: Type.Object({}, { additionalProperties: true }),
	},
	{ additionalProperties: false },
);

type ToolInput = Static<typeof InputSchema>;
type ToolOutput = Static<typeof OutputSchema>;
type QueryPlanDefinition = ControlledDataToolDefinition<typeof InputSchema, typeof OutputSchema>;

function createClock(): () => string {
	return () => "2026-08-26T00:00:00.000Z";
}

function createNow(value = Date.parse("2026-08-26T00:00:00.000Z")): () => number {
	return () => value;
}

function createBudget(overrides: Partial<RuntimeHostBudget> = {}): RuntimeHostBudget {
	return { maxSteps: 5, maxRows: 100, maxBytes: 10_000, ...overrides };
}

function createStart(overrides: Partial<LoopControllerStartRequest> = {}): LoopControllerStartRequest {
	return {
		runId: "run-loop-1",
		ownerId: "local-owner",
		workspaceId: "default-workspace",
		question: "过去 30 天按区域统计订单额",
		budget: createBudget(),
		...overrides,
	};
}

function createOutput(): ToolOutput {
	return { rows: [{ region: "north", total: 10 }], metadata: {} };
}

function createDefinition(overrides: Partial<QueryPlanDefinition> = {}): QueryPlanDefinition {
	return {
		kind: "controlled_data_tool",
		toolId: "fixture.query",
		version: "1.0.0",
		label: "Fixture query",
		description: "Deterministic read-only fixture query",
		capability: "aggregate.fixture",
		readOnly: true,
		sourceTypes: ["database"],
		inputSchema: InputSchema,
		outputSchema: OutputSchema,
		policyCategory: "policy.data.read",
		timeoutMs: 1000,
		maxRows: 10,
		maxBytes: 10_000,
		requiresEvidence: true,
		execute: async () => ({ status: "complete", output: createOutput(), evidenceReady: true }),
		rowCount: (output) => output.rows.length,
		...overrides,
	};
}

function createInvocation(overrides: Partial<LoopToolInvocation> = {}): LoopToolInvocation {
	return {
		invocationId: "call-query-1",
		runId: "run-loop-1",
		ownerId: "local-owner",
		workspaceId: "default-workspace",
		toolId: "fixture.query",
		version: "1.0.0",
		sourceType: "database",
		input: { queryPlanId: "plan-1", queryPlanVersion: "1.0.0" } satisfies ToolInput,
		...overrides,
	};
}

function createRegistry(
	authorize: ControlledToolRegistryOptions["authorize"] = async () => "allow",
): ControlledToolRegistry {
	return new ControlledToolRegistry({ authorize, now: createClock() });
}

class QueueDriver implements LoopDriver {
	private readonly decisions: unknown[];
	readonly contexts: LoopTurnContext[] = [];

	constructor(decisions: readonly unknown[]) {
		this.decisions = [...decisions];
	}

	decide(context: LoopTurnContext): Promise<unknown> {
		this.contexts.push(context);
		return Promise.resolve(this.decisions.shift());
	}
}

function createController(
	driver: LoopDriver,
	registry: ControlledToolRegistry,
	overrides: Partial<LoopControllerOptions> = {},
): { controller: LoopController; host: RuntimeHost } {
	const host = new RuntimeHost({ store: new InMemoryRuntimeStateStore(), now: createClock() });
	const controller = new LoopController({
		host,
		registry,
		driver,
		maxTurns: 5,
		now: createNow(),
		...overrides,
	});
	return { controller, host };
}

describe("path-04 loop controller", () => {
	test("runs a deterministic plan-tool-result loop and exposes only bounded summaries", async () => {
		const registry = createRegistry();
		registry.register(createDefinition());
		const driver = new QueueDriver([
			{ type: "tool_call", planDigest: digestRuntimeText("plan-1"), invocation: createInvocation() },
			{ type: "complete", resultReady: true, evidenceReady: true },
		]);
		const { controller, host } = createController(driver, registry);

		const started = controller.start(createStart());
		const result = await controller.run();

		expect(started.status).toBe("planning");
		expect(result).toMatchObject({ status: "complete", turns: 2, retries: 0 });
		expect(result.snapshot).toMatchObject({
			status: "complete",
			used: { steps: 1, rows: 1, bytes: expect.any(Number) },
		});
		expect(result.lastToolResult).toMatchObject({ status: "complete", rows: 1, evidenceReady: true });
		expect(result.lastToolResult?.resultDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(driver.contexts.map((context) => context.phase)).toEqual(["planning", "executing"]);
		expect(driver.contexts[1]?.lastToolResult?.resultDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(host.getEvents("run-loop-1").map((event) => event.type)).toEqual([
			"run_created",
			"planning_started",
			"plan_ready",
			"tool_call_requested",
			"tool_call_completed",
			"run_completed",
		]);
		expect(JSON.stringify(host.getEvents("run-loop-1"))).not.toContain("过去 30 天按区域统计订单额");
		expect(JSON.stringify(host.getEvents("run-loop-1"))).not.toContain("plan-1");
	});

	test("pauses for clarification, resumes once, and ignores duplicate continuation", async () => {
		const registry = createRegistry();
		registry.register(createDefinition());
		const questionDigest = digestRuntimeText("需要确认时间范围");
		const answerDigest = digestRuntimeText("最近 30 天");
		const driver = new QueueDriver([
			{ type: "clarification_required", questionDigest },
			{
				type: "tool_call",
				planDigest: digestRuntimeText("plan-after-clarification"),
				invocation: createInvocation(),
			},
			{ type: "complete", resultReady: true, evidenceReady: true },
		]);
		const { controller, host } = createController(driver, registry);
		controller.start(createStart());

		const waiting = await controller.run();
		expect(waiting.status).toBe("awaiting_clarification");
		expect(waiting.clarificationDigest).toBe(questionDigest);
		expect(driver.contexts).toHaveLength(1);

		const completed = await controller.continue(answerDigest);
		expect(completed.status).toBe("complete");
		expect(completed.turns).toBe(3);
		expect(driver.contexts[1]?.clarificationDigest).toBe(answerDigest);
		const callsAfterCompletion = driver.contexts.length;
		expect(await controller.continue(answerDigest)).toMatchObject({ status: "complete", turns: 3 });
		expect(driver.contexts).toHaveLength(callsAfterCompletion);
		expect(host.getEvents("run-loop-1").map((event) => event.type)).toContain("clarification_received");

		const invalidController = createController(
			new QueueDriver([{ type: "clarification_required", questionDigest }]),
			registry,
		);
		invalidController.controller.start(createStart({ runId: "run-loop-invalid-clarification" }));
		await invalidController.controller.run();
		const invalid = await invalidController.controller.continue("not-a-digest");
		expect(invalid.status).toBe("blocked");
		expect(invalid.snapshot.terminalReason).toBe("invalid_runtime_event");
	});

	test("retries only an explicitly retryable executor failure and records the failed attempt", async () => {
		let executionCount = 0;
		const registry = createRegistry();
		registry.register(
			createDefinition({
				execute: async () => {
					executionCount += 1;
					if (executionCount === 1) throw new Error("fixture executor unavailable");
					return { status: "complete", output: createOutput(), evidenceReady: true };
				},
			}),
		);
		const driver = new QueueDriver([
			{ type: "tool_call", planDigest: digestRuntimeText("plan-retry"), invocation: createInvocation() },
			{
				type: "tool_call",
				invocation: createInvocation({ invocationId: "call-query-2" }),
			},
			{ type: "complete", resultReady: true, evidenceReady: true },
		]);
		const { controller, host } = createController(driver, registry, { maxRetries: 1 });
		controller.start(createStart());

		const result = await controller.run();

		expect(result.status).toBe("complete");
		expect(result.retries).toBe(1);
		expect(executionCount).toBe(2);
		expect(driver.contexts[1]?.retries).toBe(1);
		expect(driver.contexts[1]?.lastToolResult).toMatchObject({ status: "blocked", reason: "executor_failed" });
		expect(host.getEvents("run-loop-1").filter((event) => event.type === "tool_call_completed")).toHaveLength(2);
		expect(registry.getEvents("call-query-1").map((event) => event.type)).toEqual([
			"invocation_started",
			"invocation_blocked",
		]);
	});

	test("stops after retry exhaustion and does not ask the driver for an unbounded next turn", async () => {
		const registry = createRegistry();
		registry.register(
			createDefinition({
				execute: async () => {
					throw new Error("fixture executor unavailable");
				},
			}),
		);
		const driver = new QueueDriver([
			{ type: "tool_call", planDigest: digestRuntimeText("plan-retry-exhausted"), invocation: createInvocation() },
			{ type: "tool_call", invocation: createInvocation({ invocationId: "call-query-2" }) },
			{ type: "complete", resultReady: true, evidenceReady: true },
		]);
		const { controller, host } = createController(driver, registry, { maxRetries: 1 });
		controller.start(createStart());

		const result = await controller.run();

		expect(result.status).toBe("blocked");
		expect(result.snapshot.terminalReason).toBe("runtime_failed");
		expect(result.turns).toBe(2);
		expect(driver.contexts).toHaveLength(2);
		expect(host.getEvents("run-loop-1").at(-1)).toMatchObject({
			type: "run_blocked",
			details: { reason: "runtime_failed" },
		});
	});

	test("uses Host budget and loop turn budget as hard stops", async () => {
		let executionCount = 0;
		const registry = createRegistry();
		registry.register(
			createDefinition({
				execute: async () => {
					executionCount += 1;
					return { status: "complete", output: createOutput(), evidenceReady: true };
				},
			}),
		);
		const driver = new QueueDriver([
			{ type: "tool_call", planDigest: digestRuntimeText("plan-budget"), invocation: createInvocation() },
			{ type: "tool_call", invocation: createInvocation({ invocationId: "call-query-2" }) },
		]);
		const { controller } = createController(driver, registry, { maxTurns: 3 });
		controller.start(createStart({ budget: createBudget({ maxSteps: 1 }) }));

		const hostBudgetResult = await controller.run();
		expect(hostBudgetResult.status).toBe("blocked");
		expect(hostBudgetResult.snapshot.terminalReason).toBe("budget_exhausted");
		expect(executionCount).toBe(1);
		expect(driver.contexts).toHaveLength(2);

		const turnDriver = new QueueDriver([
			{
				type: "tool_call",
				planDigest: digestRuntimeText("plan-turn-budget"),
				invocation: createInvocation({ runId: "run-loop-turn-budget", invocationId: "call-query-turn-1" }),
			},
			{ type: "complete", resultReady: true, evidenceReady: true },
		]);
		const turnRegistry = createRegistry();
		turnRegistry.register(createDefinition());
		const turnRun = createController(turnDriver, turnRegistry, { maxTurns: 1 });
		turnRun.controller.start(createStart({ runId: "run-loop-turn-budget" }));
		const turnResult = await turnRun.controller.run();
		expect(turnResult.status).toBe("blocked");
		expect(turnResult.snapshot.terminalReason).toBe("budget_exhausted");
		expect(turnDriver.contexts).toHaveLength(1);
	});

	test("propagates cancellation to an active tool and converges to one cancelled terminal", async () => {
		let executionStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			executionStarted = resolve;
		});
		const registry = createRegistry();
		registry.register(
			createDefinition({
				execute: async (_input, context) =>
					new Promise<ControlledToolExecution<ToolOutput>>((resolve) => {
						executionStarted?.();
						context.signal.addEventListener(
							"abort",
							() => resolve({ status: "partial", output: createOutput(), evidenceReady: true }),
							{ once: true },
						);
					}),
			}),
		);
		const driver = new QueueDriver([
			{ type: "tool_call", planDigest: digestRuntimeText("plan-cancel"), invocation: createInvocation() },
		]);
		const { controller, host } = createController(driver, registry);
		controller.start(createStart());
		const run = controller.run();
		await started;

		const cancelled = controller.cancel();
		const result = await run;

		expect(cancelled).toMatchObject({ status: "blocked", snapshot: { terminalReason: "cancelled" } });
		expect(result).toMatchObject({ status: "blocked", snapshot: { terminalReason: "cancelled" } });
		expect(host.getEvents("run-loop-1").map((event) => event.type)).toEqual([
			"run_created",
			"planning_started",
			"plan_ready",
			"tool_call_requested",
			"cancel_requested",
			"cancelled",
		]);
		expect(registry.getActiveInvocationIds()).toEqual([]);
	});

	test("does not wait for a non-cooperative driver after cancellation", async () => {
		let decisionStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			decisionStarted = resolve;
		});
		let releaseDecision: (() => void) | undefined;
		const pendingDecision = new Promise<unknown>((resolve) => {
			releaseDecision = () => resolve(undefined);
		});
		const driver: LoopDriver = {
			decide: async () => {
				decisionStarted?.();
				return pendingDecision;
			},
		};
		const registry = createRegistry();
		const { controller, host } = createController(driver, registry);
		controller.start(createStart());
		const run = controller.run();
		await started;

		const cancelled = controller.cancel();
		const result = await run;
		expect(cancelled.snapshot.terminalReason).toBe("cancelled");
		expect(result.snapshot.terminalReason).toBe("cancelled");
		releaseDecision?.();
		expect(host.getEvents("run-loop-1").map((event) => event.type)).toEqual([
			"run_created",
			"planning_started",
			"cancel_requested",
			"cancelled",
		]);
	});

	test("aborts an active tool when the controller deadline expires", async () => {
		vi.useFakeTimers();
		try {
			const initialTime = Date.parse("2026-08-26T00:00:00.000Z");
			let currentTime = initialTime;
			let executionStarted: (() => void) | undefined;
			const started = new Promise<void>((resolve) => {
				executionStarted = resolve;
			});
			const registry = createRegistry();
			registry.register(
				createDefinition({
					execute: async (_input, context) =>
						new Promise<ControlledToolExecution<ToolOutput>>((resolve) => {
							executionStarted?.();
							context.signal.addEventListener(
								"abort",
								() => resolve({ status: "partial", output: createOutput(), evidenceReady: true }),
								{ once: true },
							);
						}),
				}),
			);
			const driver = new QueueDriver([
				{ type: "tool_call", planDigest: digestRuntimeText("plan-deadline"), invocation: createInvocation() },
			]);
			const { controller } = createController(driver, registry, { now: () => currentTime });
			controller.start(createStart({ deadlineAt: new Date(initialTime + 10).toISOString() }));
			const run = controller.run();
			await started;

			currentTime = initialTime + 10;
			await vi.advanceTimersByTimeAsync(10);
			const result = await run;

			expect(result.status).toBe("blocked");
			expect(result.snapshot.terminalReason).toBe("deadline_exceeded");
		} finally {
			vi.useRealTimers();
		}
	});

	test("fails closed on expired deadlines, malformed decisions, mismatched ownership, and missing evidence", async () => {
		const registry = createRegistry();
		registry.register(createDefinition());

		const expiredDriver = new QueueDriver([{ type: "complete", resultReady: true, evidenceReady: true }]);
		const expired = createController(expiredDriver, registry, { now: createNow(1_000) });
		expired.controller.start(createStart({ runId: "run-loop-expired", deadlineAt: new Date(999).toISOString() }));
		expect((await expired.controller.run()).snapshot.terminalReason).toBe("deadline_exceeded");
		expect(expiredDriver.contexts).toHaveLength(0);

		const malformedDriver = new QueueDriver([{ type: "arbitrary_model_text", sql: "select * from orders" }]);
		const malformed = createController(malformedDriver, registry);
		malformed.controller.start(createStart({ runId: "run-loop-malformed" }));
		expect((await malformed.controller.run()).snapshot.terminalReason).toBe("invalid_runtime_event");

		const mismatchDriver = new QueueDriver([
			{
				type: "tool_call",
				planDigest: digestRuntimeText("plan-mismatch"),
				invocation: createInvocation({ ownerId: "other-owner" }),
			},
		]);
		const mismatch = createController(mismatchDriver, registry);
		mismatch.controller.start(createStart({ runId: "run-loop-mismatch" }));
		const mismatchResult = await mismatch.controller.run();
		expect(mismatchResult.snapshot.terminalReason).toBe("invalid_runtime_event");
		expect(registry.getEvents("call-query-1")).toEqual([]);

		const noEvidenceDriver = new QueueDriver([
			{
				type: "complete",
				planDigest: digestRuntimeText("plan-no-evidence"),
				resultReady: true,
				evidenceReady: false,
			},
		]);
		const noEvidence = createController(noEvidenceDriver, registry);
		noEvidence.controller.start(createStart({ runId: "run-loop-no-evidence" }));
		const noEvidenceResult = await noEvidence.controller.run();
		expect(noEvidenceResult.status).toBe("blocked");
		expect(noEvidenceResult.snapshot.terminalReason).toBe("evidence_required");
	});

	test("supports an explicit partial terminal without converting it to complete", async () => {
		const registry = createRegistry();
		const driver = new QueueDriver([
			{
				type: "partial",
				planDigest: digestRuntimeText("plan-partial"),
				resultReady: true,
				evidenceReady: true,
				reason: "source_unavailable",
			} satisfies LoopDecision,
		]);
		const { controller } = createController(driver, registry);
		controller.start(createStart());

		const result = await controller.run();

		expect(result.status).toBe("partial");
		expect(result.snapshot.terminalReason).toBe("source_unavailable");
	});
});
