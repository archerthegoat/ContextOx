import Type, { type Static } from "typebox";
import { describe, expect, test } from "vitest";
import {
	type ControlledDataToolDefinition,
	type ControlledToolAuthorizationRequest,
	type ControlledToolExecution,
	type ControlledToolInvocationRequest,
	type ControlledToolLifecycleEvent,
	ControlledToolRegistry,
	ControlledToolRegistryError,
	type ControlledToolRegistryOptions,
	type SourceType,
} from "../src/index.ts";

const QueryPlanInputSchema = Type.Object(
	{
		queryPlanId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
		queryPlanVersion: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" }),
		region: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
	},
	{ additionalProperties: false },
);

const ResultSchema = Type.Object(
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

type QueryPlanInput = Static<typeof QueryPlanInputSchema>;
type ToolResult = Static<typeof ResultSchema>;
type QueryPlanDefinition = ControlledDataToolDefinition<typeof QueryPlanInputSchema, typeof ResultSchema>;

function createClock(): () => string {
	let seconds = 0;
	return () => {
		const value = new Date(Date.parse("2026-08-26T00:00:00Z") + seconds * 1000).toISOString();
		seconds += 1;
		return value;
	};
}

function createOutput(rows: ToolResult["rows"] = [{ region: "north", total: 10 }]): ToolResult {
	return { rows, metadata: {} };
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
		inputSchema: QueryPlanInputSchema,
		outputSchema: ResultSchema,
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

function createRequest(overrides: Partial<ControlledToolInvocationRequest> = {}): ControlledToolInvocationRequest {
	return {
		invocationId: "invocation-1",
		runId: "run-1",
		ownerId: "owner-1",
		workspaceId: "workspace-1",
		toolId: "fixture.query",
		version: "1.0.0",
		sourceType: "database",
		input: { queryPlanId: "plan-1", queryPlanVersion: "1.0.0" },
		remaining: { maxSteps: 3, maxRows: 10, maxBytes: 10_000 },
		...overrides,
	};
}

function createRegistry(
	authorize: ControlledToolRegistryOptions["authorize"] = async () => "allow",
	options: Omit<ControlledToolRegistryOptions, "authorize"> = {},
): ControlledToolRegistry {
	return new ControlledToolRegistry({ authorize, now: createClock(), ...options });
}

function expectBlocked(result: Awaited<ReturnType<ControlledToolRegistry["invoke"]>>, reason: string): void {
	expect(result.status).toBe("blocked");
	if (result.status !== "blocked") throw new Error("Expected a blocked tool invocation");
	expect(result.reason).toBe(reason);
	expect(result.event).toMatchObject({ type: "invocation_blocked", status: "blocked", reason });
}

describe("path-04 controlled data tool registry", () => {
	test("registers versioned read-only capabilities and returns isolated descriptors", () => {
		const registry = createRegistry();
		const registered = registry.register(createDefinition());

		expect(registered).toMatchObject({
			kind: "controlled_data_tool",
			toolId: "fixture.query",
			version: "1.0.0",
			readOnly: true,
			sourceTypes: ["database"],
			requiresEvidence: true,
		});
		expect(registry.listTools().map((tool) => `${tool.toolId}@${tool.version}`)).toEqual(["fixture.query@1.0.0"]);
		expect(registry.getTool("fixture.query", "1.0.0")).toMatchObject({ capability: "aggregate.fixture" });
		expect(() => registry.register(createDefinition())).toThrowError(
			new ControlledToolRegistryError("duplicate_tool"),
		);
		const unsafeInputSchema = Type.Object({ sql: Type.String() });
		expect(() =>
			registry.register({
				...createDefinition({ inputSchema: unsafeInputSchema as unknown as QueryPlanDefinition["inputSchema"] }),
			} as QueryPlanDefinition),
		).toThrowError(new ControlledToolRegistryError("invalid_definition"));

		const listed = registry.listTools();
		const sourceTypes = listed[0]?.sourceTypes as SourceType[];
		expect(() => sourceTypes.push("api")).toThrow();
		expect(registry.getTool("fixture.query", "1.0.0")?.sourceTypes).toEqual(["database"]);
	});

	test("executes only an authorized structured plan reference and records a redacted lifecycle", async () => {
		const authorizationRequests: ControlledToolAuthorizationRequest[] = [];
		const events: ControlledToolLifecycleEvent[] = [];
		let executedInput: QueryPlanInput | undefined;
		const registry = createRegistry(
			async (request) => {
				authorizationRequests.push(request);
				return "allow";
			},
			{ onEvent: (event) => events.push(event) },
		);
		registry.register(
			createDefinition({
				execute: async (input, context) => {
					executedInput = input;
					expect(context.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
					expect(context.signal.aborted).toBe(false);
					return { status: "complete", output: createOutput(), evidenceReady: true };
				},
			}),
		);

		const result = await registry.invoke(createRequest());

		expect(result).toMatchObject({
			status: "complete",
			toolId: "fixture.query",
			version: "1.0.0",
			sourceType: "database",
			rows: 1,
			evidenceReady: true,
		});
		expect(executedInput).toEqual({ queryPlanId: "plan-1", queryPlanVersion: "1.0.0" });
		expect(authorizationRequests).toHaveLength(1);
		expect(authorizationRequests[0]).not.toHaveProperty("input");
		expect(authorizationRequests[0]?.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(events.map((event) => event.type)).toEqual(["invocation_started", "invocation_completed"]);
		expect(events.map((event) => event.sequence)).toEqual([1, 2]);
		expect(JSON.stringify(events)).not.toContain("plan-1");
		expect(registry.getEvents("invocation-1")).toEqual(events);
		expect(registry.getActiveInvocationIds()).toEqual([]);
	});

	test("keeps a valid partial result distinct from complete", async () => {
		const registry = createRegistry();
		registry.register(
			createDefinition({
				execute: async () => ({ status: "partial", output: createOutput(), evidenceReady: true }),
			}),
		);

		const result = await registry.invoke(createRequest({ invocationId: "invocation-partial" }));

		expect(result).toMatchObject({ status: "partial", rows: 1, evidenceReady: true });
		expect(registry.getEvents("invocation-partial").at(-1)).toMatchObject({
			type: "invocation_partial",
			status: "partial",
		});
	});

	test("blocks unknown tools, version mismatches, unsupported sources, invalid input, and unsafe requests before execution", async () => {
		let authorizationCount = 0;
		let executionCount = 0;
		const registry = createRegistry(async () => {
			authorizationCount += 1;
			return "allow";
		});
		registry.register(
			createDefinition({
				execute: async () => {
					executionCount += 1;
					return { status: "complete", output: createOutput(), evidenceReady: true };
				},
			}),
		);

		const cases: readonly {
			readonly invocationId: string;
			readonly reason: string;
			readonly request: Partial<ControlledToolInvocationRequest>;
		}[] = [
			{ invocationId: "invocation-unknown", reason: "tool_not_registered", request: { toolId: "missing.tool" } },
			{ invocationId: "invocation-version", reason: "tool_version_mismatch", request: { version: "2.0.0" } },
			{ invocationId: "invocation-source", reason: "source_type_not_allowed", request: { sourceType: "api" } },
			{
				invocationId: "invocation-input",
				reason: "invalid_tool_input",
				request: { input: { queryPlanId: "plan-1", queryPlanVersion: "1.0.0", unknown: true } },
			},
			{
				invocationId: "invocation-unsafe",
				reason: "unsafe_tool_request",
				request: {
					input: { queryPlanId: "plan-1", queryPlanVersion: "1.0.0", region: "SELECT secret FROM table" },
				},
			},
		];

		for (const scenario of cases) {
			const result = await registry.invoke(
				createRequest({ invocationId: scenario.invocationId, ...scenario.request }),
			);
			expectBlocked(result, scenario.reason);
		}

		expect(authorizationCount).toBe(0);
		expect(executionCount).toBe(0);
	});

	test("fails closed for malformed invocation and cancellation before authorization", async () => {
		let authorizationCount = 0;
		let executionCount = 0;
		const registry = createRegistry(async () => {
			authorizationCount += 1;
			return "allow";
		});
		registry.register(
			createDefinition({
				execute: async () => {
					executionCount += 1;
					return { status: "complete", output: createOutput(), evidenceReady: true };
				},
			}),
		);

		const malformed = await registry.invoke(null as unknown as ControlledToolInvocationRequest);
		expectBlocked(malformed, "invalid_invocation");

		const controller = new AbortController();
		controller.abort();
		const cancelled = await registry.invoke(
			createRequest({ invocationId: "invocation-cancelled-before-auth", signal: controller.signal }),
		);
		expectBlocked(cancelled, "cancelled");
		expect(authorizationCount).toBe(0);
		expect(executionCount).toBe(0);
	});

	test("cancels pending authorization even when the policy promise does not settle", async () => {
		const controller = new AbortController();
		let authorizationStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			authorizationStarted = resolve;
		});
		const registry = createRegistry(async () => {
			authorizationStarted?.();
			return new Promise<"allow">(() => {});
		});
		registry.register(createDefinition());

		const invocation = registry.invoke(
			createRequest({ invocationId: "invocation-auth-cancelled", signal: controller.signal }),
		);
		await started;
		controller.abort();
		const result = await invocation;

		expectBlocked(result, "cancelled");
		expect(registry.getActiveInvocationIds()).toEqual([]);
	});

	test("blocks denied, unknown, and throwing authorization decisions without executing the tool", async () => {
		const decisions: readonly {
			readonly invocationId: string;
			readonly authorize: ControlledToolRegistryOptions["authorize"];
			readonly reason: string;
		}[] = [
			{ invocationId: "invocation-denied", authorize: async () => "deny", reason: "authorization_denied" },
			{ invocationId: "invocation-unknown", authorize: async () => "unknown", reason: "authorization_unknown" },
			{
				invocationId: "invocation-error",
				authorize: async () => {
					throw new Error("policy unavailable");
				},
				reason: "authorization_unknown",
			},
		];

		for (const decision of decisions) {
			let executionCount = 0;
			const registry = createRegistry(decision.authorize);
			registry.register(
				createDefinition({
					execute: async () => {
						executionCount += 1;
						return { status: "complete", output: createOutput(), evidenceReady: true };
					},
				}),
			);
			const result = await registry.invoke(createRequest({ invocationId: decision.invocationId }));
			expectBlocked(result, decision.reason);
			expect(executionCount).toBe(0);
			expect(registry.getEvents(decision.invocationId).map((event) => event.type)).toEqual([
				"invocation_started",
				"invocation_blocked",
			]);
		}
	});

	test("enforces output schema, unsafe output, row/byte budgets, and evidence readiness", async () => {
		const cases: readonly {
			readonly invocationId: string;
			readonly reason: string;
			readonly definition: QueryPlanDefinition;
		}[] = [
			{
				invocationId: "invocation-invalid-output",
				reason: "invalid_tool_result",
				definition: createDefinition({
					execute: async () => ({
						status: "complete",
						output: { rows: "not-an-array", metadata: {} } as unknown as ToolResult,
						evidenceReady: true,
					}),
				}),
			},
			{
				invocationId: "invocation-unsafe-output",
				reason: "invalid_tool_result",
				definition: createDefinition({
					execute: async () => ({
						status: "complete",
						output: { rows: [], metadata: { password: "hidden" } },
						evidenceReady: true,
					}),
				}),
			},
			{
				invocationId: "invocation-row-budget",
				reason: "budget_exceeded",
				definition: createDefinition({
					maxRows: 1,
					execute: async () => ({
						status: "complete",
						output: createOutput([
							{ region: "north", total: 10 },
							{ region: "south", total: 20 },
						]),
						evidenceReady: true,
					}),
				}),
			},
			{
				invocationId: "invocation-byte-budget",
				reason: "budget_exceeded",
				definition: createDefinition({ maxBytes: 10 }),
			},
			{
				invocationId: "invocation-evidence",
				reason: "evidence_required",
				definition: createDefinition({
					execute: async () => ({ status: "complete", output: createOutput(), evidenceReady: false }),
				}),
			},
		];

		for (const scenario of cases) {
			const registry = createRegistry();
			registry.register(scenario.definition);
			const request = createRequest({
				invocationId: scenario.invocationId,
				remaining:
					scenario.reason === "budget_exceeded" && scenario.invocationId === "invocation-row-budget"
						? { maxSteps: 3, maxRows: 1, maxBytes: 10_000 }
						: scenario.invocationId === "invocation-byte-budget"
							? { maxSteps: 3, maxRows: 10, maxBytes: 10 }
							: { maxSteps: 3, maxRows: 10, maxBytes: 10_000 },
			});
			const result = await registry.invoke(request);
			expectBlocked(result, scenario.reason);
		}
	});

	test("reports budget exhaustion when no steps remain", async () => {
		const registry = createRegistry();
		registry.register(createDefinition());

		const result = await registry.invoke(
			createRequest({
				invocationId: "invocation-no-steps",
				remaining: { maxSteps: 0, maxRows: 10, maxBytes: 10_000 },
			}),
		);

		expectBlocked(result, "budget_exceeded");
	});

	test("propagates cancellation to a running executor and records one blocked terminal event", async () => {
		const controller = new AbortController();
		let executionStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			executionStarted = resolve;
		});
		const registry = createRegistry();
		registry.register(
			createDefinition({
				execute: async (_input, context) => {
					executionStarted?.();
					return new Promise<ControlledToolExecution<ToolResult>>((resolve) => {
						context.signal.addEventListener(
							"abort",
							() => resolve({ status: "partial", output: createOutput(), evidenceReady: true }),
							{ once: true },
						);
					});
				},
			}),
		);

		const invocation = registry.invoke(
			createRequest({ invocationId: "invocation-cancelled", signal: controller.signal }),
		);
		await started;
		controller.abort();
		const result = await invocation;

		expectBlocked(result, "cancelled");
		expect(registry.getEvents("invocation-cancelled").map((event) => event.type)).toEqual([
			"invocation_started",
			"invocation_blocked",
		]);
		await Promise.resolve();
		expect(registry.getActiveInvocationIds()).toEqual([]);
	});

	test("aborts a timed-out executor and keeps the invocation from being reused", async () => {
		let aborted = false;
		const registry = createRegistry();
		registry.register(
			createDefinition({
				timeoutMs: 10,
				execute: async (_input, context) =>
					new Promise<ControlledToolExecution<ToolResult>>((resolve) => {
						context.signal.addEventListener(
							"abort",
							() => {
								aborted = true;
								resolve({ status: "complete", output: createOutput(), evidenceReady: true });
							},
							{ once: true },
						);
					}),
			}),
		);

		const result = await registry.invoke(createRequest({ invocationId: "invocation-timeout" }));

		expectBlocked(result, "timeout_exceeded");
		expect(aborted).toBe(true);
		expect(registry.getEvents("invocation-timeout").map((event) => event.type)).toEqual([
			"invocation_started",
			"invocation_blocked",
		]);
		await expect(registry.invoke(createRequest({ invocationId: "invocation-timeout" }))).resolves.toMatchObject({
			status: "blocked",
			reason: "duplicate_invocation",
		});
	});

	test("blocks a duplicate while the first invocation is active", async () => {
		let releaseExecution: (() => void) | undefined;
		const executionReady = new Promise<void>((resolve) => {
			releaseExecution = resolve;
		});
		const registry = createRegistry();
		registry.register(
			createDefinition({
				execute: async () => {
					await executionReady;
					return { status: "complete", output: createOutput(), evidenceReady: true };
				},
			}),
		);

		const first = registry.invoke(createRequest({ invocationId: "invocation-duplicate" }));
		await Promise.resolve();
		await Promise.resolve();
		const duplicate = await registry.invoke(createRequest({ invocationId: "invocation-duplicate" }));
		expectBlocked(duplicate, "duplicate_invocation");

		releaseExecution?.();
		expect((await first).status).toBe("complete");
	});

	test("isolates observer failures and cleans active state when the registry clock is invalid", async () => {
		const listenerErrors: unknown[] = [];
		const observerRegistry = createRegistry(async () => "allow", {
			onEvent: () => {
				throw new Error("observer failed");
			},
			onListenerError: (error) => listenerErrors.push(error),
		});
		observerRegistry.register(createDefinition());
		expect((await observerRegistry.invoke(createRequest({ invocationId: "invocation-observer" }))).status).toBe(
			"complete",
		);
		expect(listenerErrors).toHaveLength(2);

		const invalidClockRegistry = new ControlledToolRegistry({
			authorize: async () => "allow",
			now: () => "not-a-date",
		});
		invalidClockRegistry.register(createDefinition());
		await expect(
			invalidClockRegistry.invoke(createRequest({ invocationId: "invocation-invalid-clock" })),
		).rejects.toMatchObject({
			code: "invalid_registry_clock",
		});
		expect(invalidClockRegistry.getActiveInvocationIds()).toEqual([]);
	});
});
