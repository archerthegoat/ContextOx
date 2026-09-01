import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	ContextOxStore,
	type ApprovalOutcome,
	type ApprovalRequestRecord,
	type ApprovalStatus,
	type DecisionResult,
} from "../contextox/store.ts";

const DATABASE_DIRECTORY = ".contextox";
const DATABASE_FILE = "contextox.sqlite";
const PENDING_WIDGET = "contextox-pending";

type FixtureSource = "context" | "facts";

const FIXTURE_INPUTS: Record<FixtureSource, { label: string; relativePath: string }> = {
	context: {
		label: "ContextOx fixture context",
		relativePath: "docs/contextox/validation/high-potential-customer-v0.1/input/context.md",
	},
	facts: {
		label: "ContextOx fixture facts",
		relativePath: "docs/contextox/validation/high-potential-customer-v0.1/input/facts.json",
	},
};

interface FixtureToolDetails {
	source: FixtureSource;
	relativePath: string;
	sha256: string;
	bytes: number;
}

interface ApprovalToolDetails {
	status: "pending" | "blocked";
	missionId: string;
	proposalVersion: number;
	requestId?: string;
	proposalHash?: string;
	created?: boolean;
	error?: string;
}

interface ApprovalCardData {
	requestId: string;
	missionId: string;
	proposalVersion: number;
	proposalHash: string;
	title: string;
	requiredApprover: string;
	status: ApprovalStatus;
	reason?: string;
	contractId?: string;
	timestamp: string;
}

const ApprovalParameters = Type.Object({
	missionId: Type.String({ minLength: 1, description: "Stable ContextOx Mission identifier" }),
	proposalVersion: Type.Integer({ minimum: 1, description: "Monotonically increasing frozen proposal version" }),
	requiredApprover: Type.String({ minLength: 1, description: "Actor ID that must make the human decision" }),
	goal: Type.String({ minLength: 1, description: "Business goal this proposal serves" }),
	title: Type.String({ minLength: 1, description: "Short title for the proposed Contract" }),
	scope: Type.String({ minLength: 1, description: "Exact business scope of the proposed Contract" }),
	rules: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		description: "Proposed business rules",
	}),
	evidenceRefs: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		description: "Traceable evidence references supporting or challenging the proposal",
	}),
	unknowns: Type.Array(Type.String({ minLength: 1 }), {
		description: "Known unknowns that remain visible to the approver",
	}),
	exceptions: Type.Array(Type.String({ minLength: 1 }), {
		description: "Explicit exceptions to the proposed rules",
	}),
	examples: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		description: "Positive examples that should satisfy the proposed Contract",
	}),
	counterexamples: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		description: "Counterexamples that should not satisfy the proposed Contract",
	}),
	impactSummary: Type.String({ minLength: 1, description: "Known and uncertain downstream impact" }),
});

const FixtureParameters = Type.Object({
	source: Type.Union([Type.Literal("context"), Type.Literal("facts")], {
		description: "One of the two allowlisted initial ContextOx fixture sources",
	}),
});

function databasePath(cwd: string): string {
	return join(cwd, DATABASE_DIRECTORY, DATABASE_FILE);
}

function withStore<T>(cwd: string, run: (store: ContextOxStore) => T): T {
	const store = new ContextOxStore(databasePath(cwd));
	try {
		return run(store);
	} finally {
		store.close();
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readFixture(cwd: string, source: FixtureSource): { content: string; details: FixtureToolDetails } {
	const fixture = FIXTURE_INPUTS[source];
	const path = join(cwd, fixture.relativePath);
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`ContextOx fixture input is not a regular file: ${fixture.relativePath}`);
	const bytes = readFileSync(path);
	const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	return {
		content: `${fixture.label}\nsource: ${fixture.relativePath}\n${sha256}\n\n${bytes.toString("utf8")}`,
		details: {
			source,
			relativePath: fixture.relativePath,
			sha256,
			bytes: bytes.length,
		},
	};
}

function refreshPendingWidget(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (!existsSync(databasePath(ctx.cwd))) {
		ctx.ui.setWidget(PENDING_WIDGET, undefined);
		return;
	}

	try {
		const pending = withStore(ctx.cwd, (store) => store.listPending());
		ctx.ui.setWidget(
			PENDING_WIDGET,
			pending.length === 0
				? undefined
				: [
						`ContextOx: ${pending.length} approval request${pending.length === 1 ? "" : "s"} waiting`,
						"Run /contextox-review to decide.",
					],
			{ placement: "aboveEditor" },
		);
	} catch (error) {
		ctx.ui.setWidget(PENDING_WIDGET, [`ContextOx state error: ${errorMessage(error)}`], { placement: "aboveEditor" });
	}
}

function reviewText(request: ApprovalRequestRecord): string {
	const list = (items: readonly string[]) => (items.length === 0 ? "- None" : items.map((item) => `- ${item}`).join("\n"));
	return [
		`ContextOx approval ${request.id}`,
		`Mission: ${request.missionId}`,
		`Proposal: v${request.proposalVersion} · ${request.proposalHash}`,
		`Required approver: ${request.requiredApprover}`,
		"",
		`Title: ${request.snapshot.title}`,
		`Goal: ${request.snapshot.goal}`,
		`Scope: ${request.snapshot.scope}`,
		"",
		"Rules:",
		list(request.snapshot.rules),
		"",
		"Evidence:",
		list(request.snapshot.evidenceRefs),
		"",
		"Known unknowns:",
		list(request.snapshot.unknowns),
		"",
		"Exceptions:",
		list(request.snapshot.exceptions),
		"",
		"Examples:",
		list(request.snapshot.examples),
		"",
		"Counterexamples:",
		list(request.snapshot.counterexamples),
		"",
		`Impact: ${request.snapshot.impactSummary}`,
	].join("\n");
}

function decisionMessage(result: DecisionResult): string {
	return [
		"ContextOx human decision has been persisted.",
		`mission_id: ${result.request.missionId}`,
		`request_id: ${result.request.id}`,
		`proposal_version: ${result.request.proposalVersion}`,
		`proposal_hash: ${result.request.proposalHash}`,
		`outcome: ${result.decision.outcome}`,
		`decision_id: ${result.decision.id}`,
		...(result.contract ? [`contract_id: ${result.contract.id}`, `contract_version: ${result.contract.version}`] : []),
		...(result.decision.reason ? [`reason: ${result.decision.reason}`] : []),
		"Continue this Mission from the persisted decision. Do not treat a pending request as approval and do not publish externally.",
	].join("\n");
}

function cardFromDecision(result: DecisionResult): ApprovalCardData {
	return {
		requestId: result.request.id,
		missionId: result.request.missionId,
		proposalVersion: result.request.proposalVersion,
		proposalHash: result.request.proposalHash,
		title: result.request.snapshot.title,
		requiredApprover: result.request.requiredApprover,
		status: result.request.status,
		...(result.decision.reason ? { reason: result.decision.reason } : {}),
		...(result.contract ? { contractId: result.contract.id } : {}),
		timestamp: result.decision.decidedAt,
	};
}

function resumeAgent(pi: ExtensionAPI, ctx: ExtensionCommandContext, result: DecisionResult): void {
	try {
		pi.sendUserMessage(decisionMessage(result));
	} catch (error) {
		ctx.ui.notify(
			`Decision persisted, but Agent resume failed: ${errorMessage(error)}. Run /contextox-review ${result.request.id} to retry.`,
			"error",
		);
	}
}

async function chooseRequest(
	args: string,
	pending: ApprovalRequestRecord[],
	ctx: ExtensionCommandContext,
): Promise<ApprovalRequestRecord | undefined> {
	const requestedId = args.trim();
	if (requestedId) {
		const request = pending.find((candidate) => candidate.id === requestedId);
		if (!request) ctx.ui.notify(`No pending ContextOx approval has ID ${requestedId}`, "error");
		return request;
	}
	if (pending.length === 0) {
		ctx.ui.notify("No pending ContextOx approvals", "info");
		return undefined;
	}
	if (pending.length === 1) return pending[0];

	const options = pending.map(
		(request) => `${request.snapshot.title} · ${request.missionId} · v${request.proposalVersion} · ${request.id}`,
	);
	const selected = await ctx.ui.select("Choose a ContextOx approval", options);
	if (!selected) return undefined;
	return pending[options.indexOf(selected)];
}

async function reviewApproval(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("ContextOx review requires Pi TUI", "error");
		return;
	}

	const actorFlag = pi.getFlag("contextox-actor");
	const actor = typeof actorFlag === "string" ? actorFlag.trim() : "";
	if (!actor) {
		ctx.ui.notify("Start Pi with --contextox-actor <actor-id> before reviewing approvals", "error");
		return;
	}
	const requestedId = args.trim();
	if (requestedId) {
		let persistedDecision: DecisionResult | undefined;
		try {
			persistedDecision = withStore(ctx.cwd, (store) => store.getDecisionResult(requestedId));
		} catch (error) {
			ctx.ui.notify(`ContextOx state error: ${errorMessage(error)}`, "error");
			return;
		}
		if (persistedDecision) {
			if (persistedDecision.decision.actor !== actor) {
				ctx.ui.notify("Only the actor who made this persisted decision may resume it", "error");
				return;
			}
			resumeAgent(pi, ctx, persistedDecision);
			return;
		}
	}

	let pending: ApprovalRequestRecord[];
	try {
		pending = withStore(ctx.cwd, (store) => store.listPending());
	} catch (error) {
		ctx.ui.notify(`ContextOx state error: ${errorMessage(error)}`, "error");
		return;
	}
	const request = await chooseRequest(args, pending, ctx);
	if (!request) return;

	const choice = await ctx.ui.select(reviewText(request), ["Approve", "Request changes", "Reject", "Cancel"]);
	if (!choice || choice === "Cancel") return;

	const outcome: ApprovalOutcome =
		choice === "Approve" ? "approve" : choice === "Request changes" ? "request_changes" : "reject";
	let reason = "";
	if (outcome !== "approve") {
		reason = (await ctx.ui.input("Reason required", "State the concrete reason"))?.trim() ?? "";
		if (!reason) {
			ctx.ui.notify("Decision cancelled because no reason was provided", "warning");
			return;
		}
	}

	let result: DecisionResult;
	try {
		result = withStore(ctx.cwd, (store) =>
			store.decide({
				requestId: request.id,
				expectedProposalVersion: request.proposalVersion,
				expectedProposalHash: request.proposalHash,
				actor,
				outcome,
				reason,
			}),
		);
	} catch (error) {
		ctx.ui.notify(`ContextOx decision failed: ${errorMessage(error)}`, "error");
		refreshPendingWidget(ctx);
		return;
	}

	if (!result.replayed) pi.appendEntry<ApprovalCardData>("contextox-approval", cardFromDecision(result));
	refreshPendingWidget(ctx);
	resumeAgent(pi, ctx, result);
}

export default function contextOxExtension(pi: ExtensionAPI) {
	pi.registerFlag("contextox-actor", {
		type: "string",
		description: "Local actor ID used for ContextOx human decisions",
	});

	pi.registerEntryRenderer<ApprovalCardData>("contextox-approval", (entry, { expanded }, theme) => {
		const data = entry.data;
		if (!data) return new Text(theme.fg("warning", "ContextOx approval entry has no data"), 0, 0);
		const lines = [
			theme.fg("toolTitle", theme.bold(`ContextOx · ${data.status}`)),
			theme.fg("text", `${data.title} · ${data.missionId} · v${data.proposalVersion}`),
			theme.fg("muted", `Approver: ${data.requiredApprover}`),
		];
		if (expanded) {
			lines.push(theme.fg("dim", data.requestId), theme.fg("dim", data.proposalHash));
			if (data.contractId) lines.push(theme.fg("success", `Contract v1: ${data.contractId}`));
			if (data.reason) lines.push(theme.fg("muted", `Reason: ${data.reason}`));
			lines.push(theme.fg("dim", data.timestamp));
		}
		return new Text(lines.join("\n"), 0, 0);
	});

	const fixtureTool = defineTool<typeof FixtureParameters, FixtureToolDetails>({
		name: "read_contextox_fixture",
		label: "Read ContextOx Fixture",
		description:
			"Read one allowlisted initial source for the ContextOx high-potential-customer fixture. Evaluation files and arbitrary paths are not exposed.",
		promptSnippet: "Read the allowlisted ContextOx fixture context or facts",
		promptGuidelines: [
			"Read both ContextOx fixture sources before proposing a Contract.",
			"Treat fixture facts, simulated statements, Agent inferences, unknowns, and human decisions as different evidence classes.",
		],
		parameters: FixtureParameters,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const fixture = readFixture(ctx.cwd, params.source);
			return {
				content: [{ type: "text", text: fixture.content }],
				details: fixture.details,
			};
		},

		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ContextOx fixture"))} ${theme.fg("muted", args.source)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			if (!result.details.relativePath) return new Text(theme.fg("error", "ContextOx fixture read failed"), 0, 0);
			return new Text(
				`${theme.fg("success", result.details.relativePath)}\n${theme.fg("muted", `${result.details.bytes} bytes · ${result.details.sha256}`)}`,
				0,
				0,
			);
		},
	});

	const approvalTool = defineTool<typeof ApprovalParameters, ApprovalToolDetails>({
		name: "request_human_approval",
		label: "Request Human Approval",
		description:
			"Freeze a complete ContextOx Contract proposal, persist it for the required human approver, and stop this Agent turn until a decision is recorded in Pi TUI.",
		promptSnippet: "Persist a frozen ContextOx proposal and wait for an explicit human decision",
		promptGuidelines: [
			"Call request_human_approval only after the proposal, evidence, unknowns, exceptions, examples, counterexamples, and impact are ready for a decision.",
			"Call request_human_approval as the only tool in its tool-call batch.",
			"Use proposalVersion 1 for the first proposal and increment it after requested changes or invalidation.",
			"A pending request is not approval. After this tool succeeds, stop and wait for /contextox-review.",
		],
		parameters: ApprovalParameters,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				throw new Error("ContextOx approval requires Pi TUI");
			}

			try {
				const result = withStore(ctx.cwd, (store) =>
					store.createApproval({
						...params,
						sessionId: ctx.sessionManager.getSessionId(),
					}),
				);
				const request = result.request;
				if (result.created) {
					pi.appendEntry<ApprovalCardData>("contextox-approval", {
						requestId: request.id,
						missionId: request.missionId,
						proposalVersion: request.proposalVersion,
						proposalHash: request.proposalHash,
						title: request.snapshot.title,
						requiredApprover: request.requiredApprover,
						status: request.status,
						timestamp: request.createdAt,
					});
				}
				refreshPendingWidget(ctx);
				return {
					content: [
						{
							type: "text",
							text: `Proposal ${request.proposalHash} is persisted as ${request.id} and waiting for ${request.requiredApprover}. Run /contextox-review in Pi TUI.`,
						},
					],
					details: {
						status: "pending",
						missionId: request.missionId,
						proposalVersion: request.proposalVersion,
						requestId: request.id,
						proposalHash: request.proposalHash,
						created: result.created,
					} satisfies ApprovalToolDetails,
					terminate: true,
				};
			} catch (error) {
				throw error;
			}
		},

		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ContextOx approval"))} ${theme.fg("muted", `${args.missionId} · v${args.proposalVersion}`)}\n${theme.fg("text", args.title)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details;
			const line =
				details.status === "pending"
					? `${details.requestId} · ${details.proposalHash}`
					: details.error ?? "approval blocked";
			return new Text(
				`${theme.fg(details.status === "pending" ? "success" : "error", details.status)}\n${theme.fg("muted", line)}`,
				0,
				0,
			);
		},
	});

	pi.registerTool(fixtureTool);
	pi.registerTool(approvalTool);
	pi.registerCommand("contextox-review", {
		description: "Review one persisted ContextOx approval request",
		handler: async (args, ctx) => reviewApproval(pi, args, ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		const actorFlag = pi.getFlag("contextox-actor");
		if (typeof actorFlag === "string" && actorFlag.trim()) {
			pi.setActiveTools([fixtureTool.name, approvalTool.name]);
		}
		refreshPendingWidget(ctx);
	});
}
