import { describe, expect, test } from "vitest";
import {
	InMemorySessionContextStore,
	normalizeSessionContext,
	SESSION_CONTEXT_CONTRACT_VERSION,
	type SessionContext,
	SessionContextError,
} from "../src/index.ts";

const fresh = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
};

const baseContext: SessionContext = {
	contractVersion: SESSION_CONTEXT_CONTRACT_VERSION,
	kind: "session_context",
	sessionId: "session-sales-1",
	traceId: "trace-sales-1",
	ownerId: "local-owner",
	workspaceId: "default-workspace",
	version: "1.0.0",
	status: "active",
	contextPack: { kind: "context_pack", id: "sales-context", version: "1.0.0" },
	plan: { kind: "analysis_plan", id: "sales-plan", version: "1.0.0" },
	items: [
		{
			itemId: "workspace-glossary",
			kind: "workspace_knowledge",
			version: "1.0.0",
			scope: "workspace",
			digest: `sha256:${"2".repeat(64)}`,
			freshness: fresh,
		},
		{
			itemId: "timezone-preference",
			kind: "preference",
			version: "1.0.0",
			scope: "session",
			digest: `sha256:${"1".repeat(64)}`,
			freshness: fresh,
		},
	],
	freshness: fresh,
	createdAt: "2026-08-25T00:05:00Z",
	updatedAt: "2026-08-25T00:05:00Z",
};

function expectSessionError(action: () => unknown, code: SessionContextError["code"]): void {
	try {
		action();
		throw new Error("expected SessionContextError");
	} catch (error) {
		expect(error).toBeInstanceOf(SessionContextError);
		expect((error as SessionContextError).code).toBe(code);
	}
}

describe("path-04 Session Context", () => {
	test("normalizes scoped references deterministically and does not retain raw values", () => {
		const normalized = normalizeSessionContext(baseContext);
		const reordered = normalizeSessionContext({
			...baseContext,
			items: [...baseContext.items].reverse(),
		});

		expect(reordered).toEqual(normalized);
		expect(normalized.items.map((item) => item.itemId)).toEqual(["timezone-preference", "workspace-glossary"]);
		const secret = "session-preference-secret";
		let error: unknown;
		try {
			normalizeSessionContext({ ...baseContext, rawValue: secret });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(SessionContextError);
		expect(JSON.stringify(error)).not.toContain(secret);
	});

	test("enforces owner, workspace, and optimistic version boundaries", () => {
		const store = new InMemorySessionContextStore();
		const normalized = store.register(baseContext);
		expect(
			store.get({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
			}),
		).toEqual(normalized);
		expectSessionError(
			() =>
				store.get({
					sessionId: baseContext.sessionId,
					ownerId: "other-owner",
					workspaceId: baseContext.workspaceId,
				}),
			"owner_mismatch",
		);
		expectSessionError(
			() =>
				store.get({
					sessionId: baseContext.sessionId,
					ownerId: baseContext.ownerId,
					workspaceId: "other-workspace",
				}),
			"workspace_mismatch",
		);

		const replacement: SessionContext = {
			...baseContext,
			version: "2.0.0",
			updatedAt: "2026-08-25T00:06:00Z",
		};
		const normalizedReplacement = normalizeSessionContext(replacement);
		expect(
			store.replace({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				expectedVersion: "1.0.0",
				context: replacement,
			}),
		).toEqual(normalizedReplacement);
		expectSessionError(
			() =>
				store.replace({
					sessionId: baseContext.sessionId,
					ownerId: baseContext.ownerId,
					workspaceId: baseContext.workspaceId,
					expectedVersion: "1.0.0",
					context: { ...replacement, version: "3.0.0" },
				}),
			"version_mismatch",
		);
		expect(
			store.resolve({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				version: "1.0.0",
				at: "2026-08-25T00:06:00Z",
			}),
		).toEqual({ status: "blocked", reason: "version_mismatch" });
	});

	test("blocks revoked or expired context and applies freshness policy", () => {
		const staleStore = new InMemorySessionContextStore();
		staleStore.register({ ...baseContext, freshness: { ...fresh, status: "stale" } });
		expect(
			staleStore.resolve({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				at: "2026-08-25T00:06:00Z",
				freshnessPolicy: "fresh_only",
			}),
		).toEqual({ status: "blocked", reason: "freshness_not_allowed" });
		expect(
			staleStore.resolve({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				at: "2026-08-25T00:06:00Z",
				freshnessPolicy: "allow_stale",
			}),
		).toMatchObject({ status: "available", warnings: ["freshness_stale"] });
		const expiredItemStore = new InMemorySessionContextStore();
		expiredItemStore.register({
			...baseContext,
			items: baseContext.items.map((item) =>
				item.itemId === "workspace-glossary" ? { ...item, freshness: { ...fresh, status: "expired" } } : item,
			),
		});
		expect(
			expiredItemStore.resolve({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				at: "2026-08-25T00:06:00Z",
				freshnessPolicy: "allow_unknown",
			}),
		).toEqual({ status: "blocked", reason: "freshness_expired" });

		expect(() =>
			normalizeSessionContext({
				...baseContext,
				items: baseContext.items.map((item) =>
					item.kind === "preference" ? { ...item, scope: "workspace" } : item,
				),
			}),
		).toThrow("item scope");

		const unknownStore = new InMemorySessionContextStore();
		unknownStore.register({ ...baseContext, freshness: { ...fresh, status: "unknown" } });
		expect(
			unknownStore.resolve({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				at: "2026-08-25T00:06:00Z",
				freshnessPolicy: "allow_unknown",
			}),
		).toMatchObject({ status: "available", warnings: ["freshness_unknown"] });

		const expiredStore = new InMemorySessionContextStore();
		expiredStore.register({ ...baseContext, freshness: { ...fresh, status: "expired" } });
		expect(
			expiredStore.resolve({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				at: "2026-08-25T00:06:00Z",
			}),
		).toEqual({ status: "blocked", reason: "freshness_expired" });

		const revokedStore = new InMemorySessionContextStore();
		revokedStore.register(baseContext);
		revokedStore.revoke({
			sessionId: baseContext.sessionId,
			ownerId: baseContext.ownerId,
			workspaceId: baseContext.workspaceId,
			expectedVersion: baseContext.version,
			at: "2026-08-25T00:06:00Z",
		});
		expect(
			revokedStore.resolve({
				sessionId: baseContext.sessionId,
				ownerId: baseContext.ownerId,
				workspaceId: baseContext.workspaceId,
				at: "2026-08-25T00:06:00Z",
			}),
		).toEqual({ status: "blocked", reason: "context_revoked" });
	});
});
