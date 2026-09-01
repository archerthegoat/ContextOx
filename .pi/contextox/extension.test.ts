import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadExtensions } from "../../packages/coding-agent/src/core/extensions/loader.ts";
import type { ExtensionCommandContext, ExtensionContext } from "../../packages/coding-agent/src/core/extensions/types.ts";
import { ContextOxStore } from "./store.ts";

const extensionPath = fileURLToPath(new URL("../extensions/contextox.ts", import.meta.url));

function createContext(cwd: string, selectChoice: string): {
	command: ExtensionCommandContext;
	tool: ExtensionContext;
	notify: ReturnType<typeof vi.fn>;
} {
	const notify = vi.fn();
	const shared = {
		cwd,
		mode: "tui",
		hasUI: true,
		sessionManager: { getSessionId: () => "session-1" },
		ui: {
			notify,
			select: vi.fn(async () => selectChoice),
			input: vi.fn(async () => undefined),
			setWidget: vi.fn(),
		},
	};
	return {
		command: shared as unknown as ExtensionCommandContext,
		tool: shared as unknown as ExtensionContext,
		notify,
	};
}

describe("ContextOx Pi extension", () => {
	it("persists before terminating and recovers a decision after resume delivery fails", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "contextox-extension-"));
		try {
			const fixtureDirectory = join(
				cwd,
				"docs",
				"contextox",
				"validation",
				"high-potential-customer-v0.1",
				"input",
			);
			mkdirSync(fixtureDirectory, { recursive: true });
			writeFileSync(join(fixtureDirectory, "context.md"), "fixture context");
			writeFileSync(join(fixtureDirectory, "facts.json"), '{"fixture":"facts"}');

			const firstLoad = await loadExtensions([extensionPath], cwd);
			expect(firstLoad.errors).toEqual([]);
			expect(firstLoad.extensions).toHaveLength(1);
			const extension = firstLoad.extensions[0];
			if (!extension) throw new Error("ContextOx extension did not load");
			const fixtureTool = extension.tools.get("read_contextox_fixture")?.definition;
			const approvalTool = extension.tools.get("request_human_approval")?.definition;
			const reviewCommand = extension.commands.get("contextox-review");
			if (!fixtureTool || !approvalTool || !reviewCommand) {
				throw new Error("ContextOx extension registrations are incomplete");
			}

			const appendEntry = vi.fn();
			const setActiveTools = vi.fn();
			firstLoad.runtime.appendEntry = appendEntry;
			firstLoad.runtime.setActiveTools = setActiveTools;
			firstLoad.runtime.sendUserMessage = () => {
				throw new Error("simulated resume delivery failure");
			};
			const context = createContext(cwd, "Approve");
			const sessionStart = extension.handlers.get("session_start")?.[0];
			if (!sessionStart) throw new Error("ContextOx session_start handler is missing");
			await sessionStart({ type: "session_start" }, context.tool);
			expect(setActiveTools).not.toHaveBeenCalled();
			firstLoad.runtime.flagValues.set("contextox-actor", "owner-1");
			await sessionStart({ type: "session_start" }, context.tool);
			expect(setActiveTools).toHaveBeenCalledWith(["read_contextox_fixture", "request_human_approval"]);

			const fixtureResult = await fixtureTool.execute(
				"tool-fixture",
				{ source: "context" },
				undefined,
				undefined,
				context.tool,
			);
			expect(fixtureResult.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("fixture context") });

			const proposal = {
				missionId: "mission-1",
				proposalVersion: 1,
				requiredApprover: "owner-1",
				goal: "Define high-potential existing customers",
				title: "High-potential customer Contract",
				scope: "Customers with at least one completed purchase",
				rules: ["Aggregate payments by order before joining customer facts"],
				evidenceRefs: ["fixture://high-potential-customer-v0.1"],
				unknowns: ["Future purchase probability is not validated"],
				exceptions: ["Customers with only refunded orders are excluded"],
				examples: ["A customer with completed purchases is in scope"],
				counterexamples: ["A lead with no completed purchase is outside the scope"],
				impactSummary: "Creates the first governed operating-priority definition",
			};
			await expect(
				approvalTool.execute(
					"tool-without-tui",
					proposal,
					undefined,
					undefined,
					{ ...context.tool, mode: "print", hasUI: false } as ExtensionContext,
				),
			).rejects.toThrow("ContextOx approval requires Pi TUI");

			const toolResult = await approvalTool.execute(
				"tool-1",
				proposal,
				undefined,
				undefined,
				context.tool,
			);

			expect(toolResult.terminate).toBe(true);
			expect(appendEntry).toHaveBeenCalledOnce();
			const pendingStore = new ContextOxStore(join(cwd, ".contextox", "contextox.sqlite"));
			const pending = pendingStore.listPending();
			expect(pending).toHaveLength(1);
			expect(pending[0]?.status).toBe("pending");
			pendingStore.close();

			await reviewCommand.handler("", context.command);
			expect(context.notify).toHaveBeenCalledWith(
				expect.stringContaining("Decision persisted, but Agent resume failed"),
				"error",
			);

			const decidedStore = new ContextOxStore(join(cwd, ".contextox", "contextox.sqlite"));
			const persisted = decidedStore.getDecisionResult(pending[0]?.id ?? "missing");
			expect(persisted?.decision.outcome).toBe("approve");
			expect(persisted?.contract?.sourceRequestId).toBe(pending[0]?.id);
			decidedStore.close();

			const secondLoad = await loadExtensions([extensionPath], cwd);
			expect(secondLoad.errors).toEqual([]);
			const resumedMessages: string[] = [];
			secondLoad.runtime.sendUserMessage = (content) => {
				if (typeof content === "string") resumedMessages.push(content);
			};
			secondLoad.runtime.flagValues.set("contextox-actor", "owner-1");
			const reloadedCommand = secondLoad.extensions[0]?.commands.get("contextox-review");
			if (!reloadedCommand) throw new Error("Reloaded ContextOx command is missing");
			await reloadedCommand.handler(pending[0]?.id ?? "missing", createContext(cwd, "Cancel").command);

			expect(resumedMessages).toHaveLength(1);
			expect(resumedMessages[0]).toContain(`decision_id: ${persisted?.decision.id}`);
			expect(resumedMessages[0]).toContain(`contract_id: ${persisted?.contract?.id}`);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
