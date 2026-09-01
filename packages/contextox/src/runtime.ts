import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { CONTEXT_OX_TOOL_NAMES, createContextOxExtension } from "./extension.ts";
import { ContextOxResumeAdapter } from "./resume-adapter.ts";

const SYSTEM_PROMPT = `You are the embedded Agent engine inside ContextOx.
Work only on the current ContextOx Mission. Read both allowlisted fixture sources before proposing a Contract.
Keep source facts, Agent inferences, unknowns, exceptions, examples, and counterexamples distinct.
Use request_human_approval only when the frozen proposal is ready for an explicit human decision.
A pending approval is not approval. Do not publish externally.`;

export interface ContextOxRuntimeOptions {
	cwd: string;
	agentDir: string;
	databasePath: string;
	actorId: string;
	requiredApproverId: string;
	modelRuntime?: ModelRuntime;
	model?: Model<string>;
	configureInlineExtension?(pi: ExtensionAPI): void | Promise<void>;
	sendUserMessage?(runtime: AgentSessionRuntime, message: string): Promise<void>;
}

export interface ContextOxIsolationReport {
	extensionPaths: string[];
	activeTools: string[];
	skillCount: number;
	promptCount: number;
	themeCount: number;
	contextFileCount: number;
}

export interface ContextOxRuntimeResult {
	runtime: AgentSessionRuntime;
	resumeAdapter: ContextOxResumeAdapter;
	isolation: ContextOxIsolationReport;
}

function sorted(values: readonly string[]): string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}

function assertExactValues(actual: readonly string[], expected: readonly string[], label: string): void {
	const normalizedActual = sorted(actual);
	const normalizedExpected = sorted(expected);
	if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
		throw new Error(
			`${label} must be ${normalizedExpected.join(", ")}; got ${normalizedActual.join(", ") || "none"}`,
		);
	}
}

function inspectIsolation(runtime: AgentSessionRuntime): ContextOxIsolationReport {
	const loader = runtime.services.resourceLoader;
	const extensions = loader.getExtensions();
	if (extensions.errors.length > 0) {
		throw new Error(
			`ContextOx inline extension failed to load: ${extensions.errors.map((error) => `${error.path}: ${error.error}`).join("; ")}`,
		);
	}
	const extensionPaths = extensions.extensions.map((extension) => extension.path);
	assertExactValues(extensionPaths, ["<inline:contextox>"], "ContextOx extension sources");

	const activeTools = runtime.session.getActiveToolNames();
	assertExactValues(activeTools, CONTEXT_OX_TOOL_NAMES, "ContextOx active tools");

	const skills = loader.getSkills().skills;
	const prompts = loader.getPrompts().prompts;
	const themes = loader.getThemes().themes;
	const contextFiles = loader.getAgentsFiles().agentsFiles;
	if (skills.length > 0 || prompts.length > 0 || themes.length > 0 || contextFiles.length > 0) {
		throw new Error("ContextOx resource isolation failed: discovered project or global resources");
	}

	return {
		extensionPaths,
		activeTools,
		skillCount: skills.length,
		promptCount: prompts.length,
		themeCount: themes.length,
		contextFileCount: contextFiles.length,
	};
}

export async function createContextOxRuntime(options: ContextOxRuntimeOptions): Promise<ContextOxRuntimeResult> {
	let runtime: AgentSessionRuntime | undefined;
	const modelRuntime =
		options.modelRuntime ??
		(await ModelRuntime.create({
			authPath: join(options.agentDir, "auth.json"),
			modelsPath: join(options.agentDir, "models.json"),
			allowModelNetwork: false,
		}));
	const resumeAdapter = new ContextOxResumeAdapter(options.databasePath, options.actorId, {
		async sendUserMessage(message) {
			if (!runtime) throw new Error("ContextOx Agent runtime is not ready");
			if (options.sendUserMessage) {
				await options.sendUserMessage(runtime, message);
				return;
			}
			await runtime.session.sendUserMessage(message, { expandPromptTemplates: false });
		},
	});
	const contextOxExtension = createContextOxExtension({
		databasePath: options.databasePath,
		actorId: options.actorId,
		requiredApproverId: options.requiredApproverId,
		resumeDecision: (requestId) => resumeAdapter.deliver(requestId),
	});

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const settingsManager = SettingsManager.inMemory({
			lastChangelogVersion: VERSION,
			defaultProjectTrust: "never",
			enableInstallTelemetry: false,
			quietStartup: true,
		});
		const services = await createAgentSessionServices({
			cwd,
			agentDir: options.agentDir,
			settingsManager,
			modelRuntime,
			resourceLoaderOptions: {
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPrompt: SYSTEM_PROMPT,
				extensionFactories: [
					{
						name: "contextox",
						factory: async (pi) => {
							await options.configureInlineExtension?.(pi);
							await contextOxExtension(pi);
						},
					},
				],
			},
		});
		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model: options.model,
				tools: [...CONTEXT_OX_TOOL_NAMES],
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: options.cwd,
		agentDir: options.agentDir,
		sessionManager: SessionManager.inMemory(options.cwd),
	});
	const isolation = inspectIsolation(runtime);
	return { runtime, resumeAdapter, isolation };
}
