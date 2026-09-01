import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ResumeAttempt } from "./resume-adapter.ts";
import {
	type ApprovalOutcome,
	type ApprovalRequestRecord,
	type ApprovalStatus,
	ContextOxStore,
	type DecisionResult,
} from "./store.ts";

export const CONTEXT_OX_TOOL_NAMES = ["read_contextox_fixture", "request_human_approval"] as const;
export const CONTEXT_OX_VERSION = "0.0.3";

const STATUS_WIDGET = "contextox-status";

type FixtureSource = "context" | "facts";

const FIXTURE_INPUTS: Record<FixtureSource, { label: string; relativePath: string }> = {
	context: {
		label: "ContextOx fixture context",
		relativePath: "../fixtures/high-potential-customer-v0.1/context.md",
	},
	facts: {
		label: "ContextOx fixture facts",
		relativePath: "../fixtures/high-potential-customer-v0.1/facts.json",
	},
};

interface FixtureToolDetails {
	source: FixtureSource;
	relativePath: string;
	sha256: string;
	bytes: number;
}

interface ApprovalToolDetails {
	status: "pending";
	missionId: string;
	proposalVersion: number;
	requestId: string;
	proposalHash: string;
	created: boolean;
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

export interface ContextOxExtensionOptions {
	databasePath: string;
	actorId: string;
	requiredApproverId: string;
	resumeDecision(requestId: string): Promise<ResumeAttempt>;
}

const ApprovalParameters = Type.Object({
	missionId: Type.String({ minLength: 1, description: "Stable ContextOx Mission identifier" }),
	proposalVersion: Type.Integer({ minimum: 1, description: "Monotonically increasing frozen proposal version" }),
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

function withStore<T>(databasePath: string, run: (store: ContextOxStore) => T): T {
	const store = new ContextOxStore(databasePath);
	try {
		return run(store);
	} finally {
		store.close();
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readFixture(source: FixtureSource): { content: string; details: FixtureToolDetails } {
	const fixture = FIXTURE_INPUTS[source];
	const path = fileURLToPath(new URL(fixture.relativePath, import.meta.url));
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		throw new Error(`ContextOx fixture input is not a regular file: ${fixture.relativePath}`);
	}
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

function refreshStatusWidget(options: ContextOxExtensionOptions, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (!existsSync(options.databasePath)) {
		ctx.ui.setWidget(STATUS_WIDGET, undefined);
		return;
	}

	try {
		const state = withStore(options.databasePath, (store) => ({
			pendingApprovals: store.listPending(),
			pendingResume: store.listPendingResumeDeliveries(),
		}));
		const lines: string[] = [];
		if (state.pendingApprovals.length > 0) {
			lines.push(
				`ContextOx: ${state.pendingApprovals.length} approval request${state.pendingApprovals.length === 1 ? "" : "s"} waiting`,
				"Run /contextox-review to decide.",
			);
		}
		for (const mission of state.pendingResume) {
			lines.push(
				`Resume pending: ${mission.resumeRequestId ?? "missing-request-id"}`,
				...(mission.resumeError ? [`Last error: ${mission.resumeError}`] : []),
				`Run /contextox-resume ${mission.resumeRequestId ?? "<request-id>"}.`,
			);
		}
		ctx.ui.setWidget(STATUS_WIDGET, lines.length === 0 ? undefined : lines, { placement: "aboveEditor" });
	} catch (error) {
		ctx.ui.setWidget(STATUS_WIDGET, [`ContextOx state error: ${errorMessage(error)}`], {
			placement: "aboveEditor",
		});
	}
}

function formatList(items: readonly string[]): string {
	return items.length === 0 ? "- None" : items.map((item) => `- ${item}`).join("\n");
}

function reviewText(request: ApprovalRequestRecord): string {
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
		formatList(request.snapshot.rules),
		"",
		"Evidence:",
		formatList(request.snapshot.evidenceRefs),
		"",
		"Known unknowns:",
		formatList(request.snapshot.unknowns),
		"",
		"Exceptions:",
		formatList(request.snapshot.exceptions),
		"",
		"Examples:",
		formatList(request.snapshot.examples),
		"",
		"Counterexamples:",
		formatList(request.snapshot.counterexamples),
		"",
		`Impact: ${request.snapshot.impactSummary}`,
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

	const labels = pending.map(
		(request) => `${request.snapshot.title} · ${request.missionId} · v${request.proposalVersion} · ${request.id}`,
	);
	const selected = await ctx.ui.select("Choose a ContextOx approval", labels);
	if (!selected) return undefined;
	return pending[labels.indexOf(selected)];
}

async function deliverDecision(
	options: ContextOxExtensionOptions,
	requestId: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	try {
		const attempt = await options.resumeDecision(requestId);
		ctx.ui.notify(
			attempt.status === "dispatched" ? "ContextOx resumed the Agent" : "This decision was already delivered",
			"info",
		);
	} catch (error) {
		ctx.ui.notify(
			`Decision persisted, but Agent resume failed: ${errorMessage(error)}. Run /contextox-resume ${requestId} to retry.`,
			"error",
		);
	}
}

async function reviewApproval(
	pi: ExtensionAPI,
	options: ContextOxExtensionOptions,
	args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("ContextOx review requires ContextOx TUI", "error");
		return;
	}

	let pending: ApprovalRequestRecord[];
	try {
		pending = withStore(options.databasePath, (store) => store.listPending());
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
		result = withStore(options.databasePath, (store) =>
			store.decide({
				requestId: request.id,
				expectedProposalVersion: request.proposalVersion,
				expectedProposalHash: request.proposalHash,
				actor: options.actorId,
				outcome,
				reason,
			}),
		);
	} catch (error) {
		ctx.ui.notify(`ContextOx decision failed: ${errorMessage(error)}`, "error");
		refreshStatusWidget(options, ctx);
		return;
	}

	if (!result.replayed) pi.appendEntry<ApprovalCardData>("contextox-approval", cardFromDecision(result));
	refreshStatusWidget(options, ctx);
	if (result.decision.outcome === "reject") {
		ctx.ui.notify("ContextOx rejected the proposal; the Mission is blocked and the Agent was not resumed", "info");
		return;
	}
	await deliverDecision(options, request.id, ctx);
	refreshStatusWidget(options, ctx);
}

async function resumeApproval(
	options: ContextOxExtensionOptions,
	args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("ContextOx resume requires ContextOx TUI", "error");
		return;
	}
	const requestId = args.trim();
	if (!requestId) {
		ctx.ui.notify("Usage: /contextox-resume <request-id>", "error");
		return;
	}
	await deliverDecision(options, requestId, ctx);
	refreshStatusWidget(options, ctx);
}

export function createContextOxExtension(options: ContextOxExtensionOptions): ExtensionFactory {
	return (pi) => {
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
			name: CONTEXT_OX_TOOL_NAMES[0],
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

			async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
				const fixture = readFixture(params.source);
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

			renderResult(result, _renderOptions, theme) {
				return new Text(
					`${theme.fg("success", result.details.relativePath)}\n${theme.fg("muted", `${result.details.bytes} bytes · ${result.details.sha256}`)}`,
					0,
					0,
				);
			},
		});

		const approvalTool = defineTool<typeof ApprovalParameters, ApprovalToolDetails>({
			name: CONTEXT_OX_TOOL_NAMES[1],
			label: "Request Human Approval",
			description:
				"Freeze a complete ContextOx Contract proposal, persist it for the product-configured human approver, and stop this Agent turn until a decision is recorded.",
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
					throw new Error("ContextOx approval requires ContextOx TUI");
				}
				const result = withStore(options.databasePath, (store) =>
					store.createApproval({
						...params,
						requiredApprover: options.requiredApproverId,
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
				refreshStatusWidget(options, ctx);
				return {
					content: [
						{
							type: "text",
							text: `Proposal ${request.proposalHash} is persisted as ${request.id} and waiting for ${request.requiredApprover}. Run /contextox-review in ContextOx TUI.`,
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
			},

			renderCall(args, theme) {
				return new Text(
					`${theme.fg("toolTitle", theme.bold("ContextOx approval"))} ${theme.fg("muted", `${args.missionId} · v${args.proposalVersion}`)}\n${theme.fg("text", args.title)}`,
					0,
					0,
				);
			},

			renderResult(result, _renderOptions, theme) {
				return new Text(
					`${theme.fg("success", result.details.status)}\n${theme.fg("muted", `${result.details.requestId} · ${result.details.proposalHash}`)}`,
					0,
					0,
				);
			},
		});

		pi.registerTool(fixtureTool);
		pi.registerTool(approvalTool);
		pi.registerCommand("contextox-review", {
			description: "Review one persisted ContextOx approval request",
			handler: async (args, ctx) => reviewApproval(pi, options, args, ctx),
		});
		pi.registerCommand("contextox-resume", {
			description: "Retry one pending ContextOx Agent resume delivery",
			handler: async (args, ctx) => resumeApproval(options, args, ctx),
		});
		pi.on("user_bash", () => ({
			result: {
				output: "ContextOx blocks direct shell execution; only product-approved tools are available.",
				exitCode: 126,
				cancelled: false,
				truncated: false,
			},
		}));

		pi.on("session_start", (_event, ctx) => {
			pi.setActiveTools([...CONTEXT_OX_TOOL_NAMES]);
			if (ctx.mode === "tui") {
				ctx.ui.setTitle("ContextOx");
				ctx.ui.setHeader(
					(_tui, theme) =>
						new Text(
							[
								theme.bold(theme.fg("accent", `ContextOx v${CONTEXT_OX_VERSION}`)),
								theme.fg("text", "Governed business-definition Agent"),
								theme.fg("muted", "/contextox-review · /contextox-resume"),
								theme.fg("muted", "Only allowlisted fixture evidence and human approval tools are active."),
							].join("\n"),
							1,
							0,
						),
				);
			}
			refreshStatusWidget(options, ctx);
		});
	};
}
