import { describe, expect, test } from "vitest";
import {
	ANALYSIS_CONTRACT_VERSION,
	type CompiledQuery,
	createEvidenceEnvelope,
	createFixtureQueryStep,
	createPreflightedFixtureQueryStep,
	createResultEnvelope,
	type ExecutionContext,
	FixtureQueryExecutor,
	minimizeResult,
	type ResultCandidate,
	type ResultLineage,
	RuntimeStepError,
	type RuntimeStepOutput,
	runSerialAnalysis,
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
			columnId: "order-total",
			label: "Order total",
			dataType: "decimal",
			nullable: false,
			source: { tableId: "orders", columnId: "order-total" },
		},
	],
	rows: [
		[1, 120.5],
		[2, 80],
	],
	rowCount: 2,
};

const compiledQuery: CompiledQuery = {
	contractVersion: ANALYSIS_CONTRACT_VERSION,
	readOnly: true,
	dialect: "fixture-sql",
	text: 'SELECT "order_id", "order_total" FROM "orders" LIMIT ?',
	parameters: [{ index: 1, role: "limit", type: "number", value: 10 }],
	source: lineage.source,
	snapshot: lineage.snapshot,
	binding: lineage.binding,
	executionSpec: lineage.executionSpec,
	queryPlan: { kind: "query_plan", id: "sales-query", version: "1.0.0" },
	asOf: freshness.asOf,
	planDigest: `sha256:${"1".repeat(64)}`,
	queryDigest: `sha256:${"2".repeat(64)}`,
	estimatedRows: 2,
	estimatedBytes: 256,
	estimatedCost: 1,
	limit: 10,
	warnings: [],
};

const planRef = { kind: "analysis_plan" as const, id: "plan-sales", version: "1.0.0" };
const contextPack = { kind: "context_pack" as const, id: "sales-context", version: "1.0.0" };
const policyDecisions = [
	{
		permission: { policyId: "policy-sales", policyVersion: "1.0.0" },
		resource: { kind: "query_plan" as const, id: "sales-query", version: "1.0.0" },
		decision: "allow" as const,
	},
];

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
	return {
		runId: "run-sales-1",
		actor: { kind: "human", id: "user-a" },
		organizationId: "org-a",
		asOf: freshness.asOf,
		freshnessPolicy: "fresh_only",
		budget: { maxSteps: 5, maxRows: 10, maxBytes: 1000 },
		policyEvaluator: { evaluate: async () => ({ decision: "allow" as const }) },
		...overrides,
	};
}

function completeOutput(stepId: string, runId = "run-sales-1", maxRows = 10): RuntimeStepOutput {
	const minimized = minimizeResult(candidate, {
		ruleRefs: [],
		allowedColumnIds: ["order-id", "order-total"],
		maxRows,
		maxBytes: 1000,
	});
	if (minimized.status !== "ready") throw new Error("runtime fixture minimization failed");
	const result = createResultEnvelope({
		resultId: `${stepId}-result`,
		resultVersion: "1.0.0",
		runId,
		stepId,
		lineage,
		asOf: freshness.asOf,
		freshness,
		minimized,
	});
	const evidence = createEvidenceEnvelope({
		evidenceId: `${stepId}-evidence`,
		evidenceVersion: "1.0.0",
		planRef,
		contextPack,
		result,
		compiledQuery,
		policyDecisions,
	});
	return { result, evidence };
}

function fixtureStep(executor: FixtureQueryExecutor, maxRows = 10) {
	return createFixtureQueryStep({
		stepId: "step-query-1",
		required: true,
		dependsOn: [],
		compiledQuery,
		executor,
		lineage,
		freshness,
		minimization: {
			ruleRefs: [],
			allowedColumnIds: ["order-id", "order-total"],
			maxRows,
			maxBytes: 1000,
		},
		planRef,
		contextPack,
		policyDecisions,
		resultId: "result-sales-1",
		evidenceId: "evidence-sales-1",
	});
}

describe("path-03 runtime", () => {
	test("executes a deterministic fixture and retains complete result evidence", async () => {
		const executor = new FixtureQueryExecutor({
			cases: [{ queryDigest: compiledQuery.queryDigest, candidate }],
		});
		const step = fixtureStep(executor);

		const first = await runSerialAnalysis({ context: createContext(), steps: [step] });
		const second = await runSerialAnalysis({ context: createContext(), steps: [step] });

		expect(first.status).toBe("complete");
		expect(first.records[0]?.status).toBe("complete");
		expect(first.records[0]?.evidence?.status).toBe("complete");
		expect(first.used).toEqual({ steps: 1, rows: 2, bytes: 18 });
		expect(second.records).toEqual(first.records);
		expect(executor.executeCount).toBe(2);
		expect(executor.activeExecutions).toBe(0);
	});

	test("returns partial evidence when result minimization truncates rows", async () => {
		const executor = new FixtureQueryExecutor({
			cases: [{ queryDigest: compiledQuery.queryDigest, candidate }],
		});
		const result = await runSerialAnalysis({ context: createContext(), steps: [fixtureStep(executor, 1)] });

		expect(result.status).toBe("partial");
		expect(result.records[0]?.status).toBe("partial");
		expect(result.records[0]?.result?.truncated).toBe(true);
		expect(result.records[0]?.evidence?.integrity.status).toBe("incomplete");
		expect(result.used.rows).toBe(1);
	});

	test("does not call the executor when cancellation or deadline is already active", async () => {
		const executor = new FixtureQueryExecutor({
			cases: [{ queryDigest: compiledQuery.queryDigest, candidate }],
		});
		const controller = new AbortController();
		controller.abort();
		const cancelled = await runSerialAnalysis({
			context: createContext({ signal: controller.signal }),
			steps: [fixtureStep(executor)],
		});
		const deadline = await runSerialAnalysis({
			context: createContext(),
			steps: [fixtureStep(executor)],
			deadlineAt: "2026-01-01T00:00:00Z",
			now: () => Date.parse("2026-01-02T00:00:00Z"),
		});

		expect(cancelled).toMatchObject({ status: "blocked", failedStepIds: ["step-query-1"] });
		expect(cancelled.records[0]?.error).toBe("cancelled");
		expect(deadline.records[0]?.error).toBe("deadline_exceeded");
		expect(executor.executeCount).toBe(0);
	});

	test("does not call the executor when preflight is blocked", async () => {
		const executor = new FixtureQueryExecutor({
			cases: [{ queryDigest: compiledQuery.queryDigest, candidate }],
		});
		const step = createPreflightedFixtureQueryStep({
			stepId: "step-preflight-blocked",
			required: true,
			dependsOn: [],
			preflight: { status: "blocked", reason: "permission_denied" },
			executor,
			lineage,
			freshness,
			minimization: {
				ruleRefs: [],
				allowedColumnIds: ["order-id", "order-total"],
				maxRows: 10,
				maxBytes: 1000,
			},
			planRef,
			contextPack,
			policyDecisions,
			resultId: "result-preflight-blocked",
			evidenceId: "evidence-preflight-blocked",
		});
		const result = await runSerialAnalysis({ context: createContext(), steps: [step] });

		expect(result.status).toBe("blocked");
		expect(result.records[0]).toMatchObject({ status: "blocked", error: "permission_denied" });
		expect(executor.executeCount).toBe(0);
	});

	test("cancels an in-flight fixture and releases its active execution", async () => {
		const executor = new FixtureQueryExecutor({
			cases: [{ queryDigest: compiledQuery.queryDigest, candidate }],
			delayMs: 50,
		});
		const controller = new AbortController();
		const pending = runSerialAnalysis({
			context: createContext({ signal: controller.signal }),
			steps: [fixtureStep(executor)],
		});
		setTimeout(() => controller.abort(), 5);
		const result = await pending;

		expect(result.status).toBe("blocked");
		expect(result.records[0]?.error).toBe("cancelled");
		expect(executor.activeExecutions).toBe(0);
	});

	test("dispose terminates an active fixture execution and rejects new work", async () => {
		const executor = new FixtureQueryExecutor({
			cases: [{ queryDigest: compiledQuery.queryDigest, candidate }],
			delayMs: 50,
		});
		const pending = executor.execute({ compiledQuery, context: createContext() });
		setTimeout(() => executor.dispose(), 5);

		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
		expect(executor.activeExecutions).toBe(0);
		expect(executor.isDisposed).toBe(true);
		await expect(executor.execute({ compiledQuery, context: createContext() })).rejects.toMatchObject({
			code: "executor_failed",
		});
	});

	test("enforces step budget without starting later steps", async () => {
		const executed: string[] = [];
		const steps = [
			{
				stepId: "step-a",
				kind: "transform" as const,
				required: true,
				dependsOn: [],
				execute: async () => {
					executed.push("step-a");
					return completeOutput("step-a");
				},
			},
			{
				stepId: "step-b",
				kind: "transform" as const,
				required: false,
				dependsOn: [],
				execute: async () => {
					executed.push("step-b");
					return completeOutput("step-b");
				},
			},
		];
		const result = await runSerialAnalysis({
			context: createContext({ budget: { maxSteps: 1, maxRows: 10, maxBytes: 1000 } }),
			steps,
		});

		expect(result.status).toBe("partial");
		expect(executed).toEqual(["step-a"]);
		expect(result.records.find((record) => record.stepId === "step-b")).toMatchObject({
			status: "skipped",
			error: "budget_exceeded",
		});
	});

	test("does not release output that completes after the deadline", async () => {
		let clockReads = 0;
		const result = await runSerialAnalysis({
			context: createContext(),
			deadlineAt: "2026-08-26T00:00:00Z",
			now: () => {
				clockReads += 1;
				return clockReads <= 2 ? Date.parse("2026-08-25T23:59:59Z") : Date.parse("2026-08-26T00:00:00Z");
			},
			steps: [
				{
					stepId: "step-late",
					kind: "query",
					required: true,
					dependsOn: [],
					execute: async () => completeOutput("step-late"),
				},
			],
		});

		expect(result.status).toBe("blocked");
		expect(result.records[0]).toMatchObject({ status: "blocked", error: "deadline_exceeded" });
		expect(result.completedStepIds).toEqual([]);
	});

	test("keeps independent results after one executor fails and skips dependents", async () => {
		const executed: string[] = [];
		const steps = [
			{
				stepId: "step-fail",
				kind: "query" as const,
				required: true,
				dependsOn: [],
				execute: async () => {
					executed.push("step-fail");
					throw new RuntimeStepError("executor_failed");
				},
			},
			{
				stepId: "step-dependent",
				kind: "hybrid" as const,
				required: true,
				dependsOn: ["step-fail"],
				execute: async () => {
					executed.push("step-dependent");
					return completeOutput("step-dependent");
				},
			},
			{
				stepId: "step-independent",
				kind: "knowledge" as const,
				required: false,
				dependsOn: [],
				execute: async () => {
					executed.push("step-independent");
					return completeOutput("step-independent");
				},
			},
		];
		const result = await runSerialAnalysis({ context: createContext(), steps });

		expect(result.status).toBe("partial");
		expect(executed).toEqual(["step-fail", "step-independent"]);
		expect(result.records.find((record) => record.stepId === "step-fail")).toMatchObject({
			status: "blocked",
			error: "executor_failed",
		});
		expect(result.records.find((record) => record.stepId === "step-dependent")).toMatchObject({
			status: "skipped",
			error: "dependency_failed",
		});
		expect(result.completedStepIds).toEqual(["step-independent"]);
	});

	test("blocks an output that exceeds the aggregate row budget", async () => {
		const executor = new FixtureQueryExecutor({
			cases: [{ queryDigest: compiledQuery.queryDigest, candidate }],
		});
		const result = await runSerialAnalysis({
			context: createContext({ budget: { maxSteps: 1, maxRows: 1, maxBytes: 1000 } }),
			steps: [fixtureStep(executor, 10)],
		});

		expect(result.status).toBe("blocked");
		expect(result.records[0]).toMatchObject({ status: "blocked", error: "budget_exceeded" });
		expect(result.completedStepIds).toEqual([]);
	});

	test("rejects a successful step without evidence and rejects cyclic graphs", async () => {
		const output = completeOutput("step-no-evidence");
		const noEvidence = await runSerialAnalysis({
			context: createContext(),
			steps: [
				{
					stepId: "step-no-evidence",
					kind: "transform" as const,
					required: true,
					dependsOn: [],
					execute: async () => ({ result: output.result }),
				},
			],
		});

		expect(noEvidence.status).toBe("blocked");
		expect(noEvidence.records[0]).toMatchObject({ status: "blocked", error: "evidence_failed" });
		await expect(
			runSerialAnalysis({
				context: createContext(),
				steps: [
					{
						stepId: "step-a",
						kind: "transform" as const,
						required: true,
						dependsOn: ["step-b"],
						execute: async () => output,
					},
					{
						stepId: "step-b",
						kind: "transform" as const,
						required: true,
						dependsOn: ["step-a"],
						execute: async () => output,
					},
				],
			}),
		).rejects.toMatchObject({ code: "invalid_contract" });
	});
});
