#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxToolCall,
	InMemoryCredentialStore,
	registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import { APP_NAME, APP_TITLE, type ExtensionAPI, InteractiveMode, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { CONTEXT_OX_VERSION } from "./extension.ts";
import { type ContextOxRuntimeOptions, createContextOxRuntime } from "./runtime.ts";

interface ContextOxCliOptions {
	actorId: string;
	requiredApproverId: string;
	cwd: string;
	stateDirectory: string;
	agentDirectory: string;
	initialMessage?: string;
	acceptanceFixture: boolean;
	diagnostics: boolean;
}

interface ParsedCli {
	action: "help" | "version" | "run";
	options?: ContextOxCliOptions;
}

interface FakeRuntimeInputs {
	faux: FauxProviderRegistration;
	modelRuntime: ModelRuntime;
	model: ReturnType<FauxProviderRegistration["getModel"]>;
	configureInlineExtension(pi: ExtensionAPI): void;
}

function helpText(): string {
	return `ContextOx - governed business-definition Agent

Usage:
  contextox --actor <actor-id> --approver <approver-id> [options] [initial mission]

Required:
  --actor <actor-id>       Local human actor for decisions
  --approver <actor-id>    Required approver injected into every approval request

Options:
  --state-dir <path>       Product state directory (default: <cwd>/.contextox)
  --agent-dir <path>       ContextOx model/auth directory (default: ~/.contextox/agent)
  --acceptance-fixture     Use the deterministic local fake provider; no model network
  --diagnostics            Print resource isolation and active-tool diagnostics
  -h, --help               Show this help
  -v, --version            Show the ContextOx version

This is the ContextOx product entrypoint. Pi Coding Agent runtime, TUI, and Agent Core run inside it.`;
}

function requiredOptionValue(args: string[], index: number, option: string): string {
	const value = args[index + 1]?.trim();
	if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
	return value;
}

function assignOnce(current: string | undefined, next: string, option: string): string {
	if (current !== undefined) throw new Error(`${option} may only be provided once`);
	return next;
}

function parseArgs(args: string[], cwd = process.cwd()): ParsedCli {
	if (args.includes("--help") || args.includes("-h")) return { action: "help" };
	if (args.includes("--version") || args.includes("-v")) return { action: "version" };

	let actorId: string | undefined;
	let requiredApproverId: string | undefined;
	let stateDirectory: string | undefined;
	let agentDirectory: string | undefined;
	let acceptanceFixture = false;
	let diagnostics = false;
	const messageParts: string[] = [];
	let positionalOnly = false;

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (positionalOnly) {
			messageParts.push(arg);
			continue;
		}
		if (arg === "--") {
			positionalOnly = true;
			continue;
		}
		if (arg === "--actor") {
			actorId = assignOnce(actorId, requiredOptionValue(args, index, arg), arg);
			index++;
			continue;
		}
		if (arg === "--approver") {
			requiredApproverId = assignOnce(requiredApproverId, requiredOptionValue(args, index, arg), arg);
			index++;
			continue;
		}
		if (arg === "--state-dir") {
			stateDirectory = assignOnce(stateDirectory, requiredOptionValue(args, index, arg), arg);
			index++;
			continue;
		}
		if (arg === "--agent-dir") {
			agentDirectory = assignOnce(agentDirectory, requiredOptionValue(args, index, arg), arg);
			index++;
			continue;
		}
		if (arg === "--acceptance-fixture") {
			acceptanceFixture = true;
			continue;
		}
		if (arg === "--diagnostics") {
			diagnostics = true;
			continue;
		}
		if (arg.startsWith("-")) throw new Error(`unknown ContextOx option: ${arg}`);
		messageParts.push(arg);
	}

	if (!actorId) throw new Error("--actor <actor-id> is required");
	if (!requiredApproverId) throw new Error("--approver <approver-id> is required");
	const resolvedCwd = resolve(cwd);
	return {
		action: "run",
		options: {
			actorId,
			requiredApproverId,
			cwd: resolvedCwd,
			stateDirectory: resolve(resolvedCwd, stateDirectory ?? ".contextox"),
			agentDirectory: resolve(agentDirectory ?? join(homedir(), ".contextox", "agent")),
			...(messageParts.length === 0 ? {} : { initialMessage: messageParts.join(" ") }),
			acceptanceFixture,
			diagnostics,
		},
	};
}

async function createFakeRuntimeInputs(): Promise<FakeRuntimeInputs> {
	process.env.PI_OFFLINE = "1";
	const faux = registerFauxProvider();
	const model = faux.getModel();
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("read_contextox_fixture", { source: "context" }), {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage(fauxToolCall("read_contextox_fixture", { source: "facts" }), {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage(
			fauxToolCall("request_human_approval", {
				missionId: "contextox-mvp-acceptance",
				proposalVersion: 1,
				goal: "Define high-potential existing customers",
				title: "High-potential customer Contract",
				scope: "Customers with at least one completed purchase",
				rules: ["Aggregate payments by order before joining customer facts"],
				evidenceRefs: [
					"fixture://high-potential-customer-v0.1/context",
					"fixture://high-potential-customer-v0.1/facts",
				],
				unknowns: ["Future purchase probability is not validated"],
				exceptions: ["Customers with only refunded orders are excluded"],
				examples: ["A customer with completed purchases is in scope"],
				counterexamples: ["A lead with no completed purchase is outside the scope"],
				impactSummary: "Creates the first governed operating-priority definition",
			}),
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("The persisted human decision was received by the embedded ContextOx Agent."),
	]);

	const credentials = new InMemoryCredentialStore();
	await credentials.modify(model.provider, async () => ({ type: "api_key", key: "contextox-faux-key" }));
	const modelRuntime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	return {
		faux,
		modelRuntime,
		model,
		configureInlineExtension(pi) {
			pi.registerProvider(model.provider, {
				baseUrl: model.baseUrl,
				apiKey: "contextox-faux-key",
				api: faux.api,
				models: faux.models.map((registeredModel) => ({
					id: registeredModel.id,
					name: registeredModel.name,
					api: registeredModel.api,
					reasoning: registeredModel.reasoning,
					input: registeredModel.input,
					cost: registeredModel.cost,
					contextWindow: registeredModel.contextWindow,
					maxTokens: registeredModel.maxTokens,
				})),
			});
		},
	};
}

function assertProductIdentity(): void {
	if (APP_NAME !== "ContextOx" || APP_TITLE !== "ContextOx") {
		throw new Error(
			`ContextOx product identity is not active (name=${APP_NAME}, title=${APP_TITLE}); start with ./contextox-test.sh`,
		);
	}
}

async function run(options: ContextOxCliOptions): Promise<void> {
	assertProductIdentity();
	const actorContext = Object.freeze({ actorId: options.actorId });
	const approvalPolicy = Object.freeze({ requiredApproverId: options.requiredApproverId });
	mkdirSync(options.agentDirectory, { recursive: true });
	mkdirSync(options.stateDirectory, { recursive: true });

	let fake: FakeRuntimeInputs | undefined;
	try {
		if (options.acceptanceFixture) fake = await createFakeRuntimeInputs();
		const runtimeOptions: ContextOxRuntimeOptions = {
			cwd: options.cwd,
			agentDir: options.agentDirectory,
			databasePath: join(options.stateDirectory, "contextox.sqlite"),
			actorId: actorContext.actorId,
			requiredApproverId: approvalPolicy.requiredApproverId,
			...(fake
				? {
						modelRuntime: fake.modelRuntime,
						model: fake.model,
						configureInlineExtension: fake.configureInlineExtension,
					}
				: {}),
		};
		const created = await createContextOxRuntime(runtimeOptions);
		if (options.diagnostics) {
			process.stderr.write(
				`${JSON.stringify(
					{
						product: "ContextOx",
						actor: actorContext.actorId,
						requiredApprover: approvalPolicy.requiredApproverId,
						stateDirectory: options.stateDirectory,
						isolation: created.isolation,
					},
					null,
					2,
				)}\n`,
			);
		}

		const pendingResume = created.resumeAdapter.listPending();
		const startupDiagnostics = [
			...created.runtime.diagnostics,
			...pendingResume.map((mission) => ({
				type: "warning" as const,
				message: `ContextOx resume pending for ${mission.resumeRequestId ?? mission.id}${mission.resumeError ? `: ${mission.resumeError}` : ""}`,
			})),
		];
		const mode = new InteractiveMode(created.runtime, {
			startupDiagnostics,
			modelFallbackMessage: created.runtime.modelFallbackMessage,
			initialMessage:
				options.initialMessage ??
				(options.acceptanceFixture
					? "Create the first ContextOx Contract from the allowlisted fixture."
					: undefined),
			initialImages: [],
			initialMessages: [],
		});
		await mode.run();
		await created.runtime.dispose();
	} finally {
		fake?.faux.unregister();
	}
}

async function main(): Promise<void> {
	const parsed = parseArgs(process.argv.slice(2));
	if (parsed.action === "help") {
		process.stdout.write(`${helpText()}\n`);
		return;
	}
	if (parsed.action === "version") {
		process.stdout.write(`${CONTEXT_OX_VERSION}\n`);
		return;
	}
	if (!parsed.options) throw new Error("ContextOx CLI options are missing");
	process.title = "contextox";
	await run(parsed.options);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`ContextOx failed: ${message}\n`);
	process.exitCode = 1;
});
