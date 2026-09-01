import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_OX_TOOL_NAMES, createContextOxRuntime } from "../src/index.ts";

describe("createContextOxRuntime", () => {
	const cleanup: string[] = [];

	afterEach(() => {
		for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
	});

	it("loads only the inline ContextOx product extension and two allowlisted tools", async () => {
		const directory = mkdtempSync(join(tmpdir(), "contextox-runtime-"));
		cleanup.push(directory);
		const cwd = join(directory, "workspace");
		const agentDir = join(directory, "agent");
		const stateDir = join(directory, "state");
		mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
		mkdirSync(join(cwd, ".pi", "skills", "decoy"), { recursive: true });
		mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "extensions", "decoy.ts"), 'throw new Error("must not load");\n');
		writeFileSync(join(cwd, ".pi", "skills", "decoy", "SKILL.md"), "---\nname: decoy\n---\nMust not load.\n");
		writeFileSync(join(cwd, ".pi", "prompts", "decoy.md"), "Must not load.\n");
		writeFileSync(join(cwd, "AGENTS.md"), "Must not enter the ContextOx Agent prompt.\n");

		const modelRuntime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const created = await createContextOxRuntime({
			cwd,
			agentDir,
			databasePath: join(stateDir, "contextox.sqlite"),
			actorId: "owner-1",
			requiredApproverId: "owner-1",
			modelRuntime,
		});
		try {
			const loadedExtension = created.runtime.services.resourceLoader.getExtensions().extensions[0];
			expect(created.runtime.session.sessionManager.isPersisted()).toBe(false);
			expect(created.isolation).toEqual({
				extensionPaths: ["<inline:contextox>"],
				activeTools: [...CONTEXT_OX_TOOL_NAMES],
				skillCount: 0,
				promptCount: 0,
				themeCount: 0,
				contextFileCount: 0,
			});
			expect(created.runtime.session.getActiveToolNames()).toEqual([...CONTEXT_OX_TOOL_NAMES]);
			expect(created.runtime.session.getActiveToolNames()).not.toContain("read");
			expect(created.runtime.session.getActiveToolNames()).not.toContain("bash");
			expect(created.runtime.session.getActiveToolNames()).not.toContain("edit");
			expect(created.runtime.session.getActiveToolNames()).not.toContain("write");
			const approvalTool = created.runtime.session.getToolDefinition("request_human_approval");
			expect(approvalTool).toBeDefined();
			expect(JSON.stringify(approvalTool?.parameters)).not.toContain("requiredApprover");
			expect(JSON.stringify(approvalTool?.parameters)).not.toContain("actor");
			expect(loadedExtension?.handlers.has("user_bash")).toBe(true);
			expect(created.runtime.session.systemPrompt).not.toContain("Must not enter the ContextOx Agent prompt");
		} finally {
			await created.runtime.dispose();
		}
	});
});
