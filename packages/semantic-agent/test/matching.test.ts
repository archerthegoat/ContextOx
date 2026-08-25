import { describe, expect, test } from "vitest";
import {
	buildContextMatchCatalog,
	CONTEXT_CONTRACT_VERSION,
	matchContext,
	transitionSourceBinding,
	type VectorMatchRequest,
} from "../src/index.ts";

const salesSource = { sourceId: "sales-db", version: "snapshot-1" };
const glossarySource = { sourceId: "business-glossary", version: "2026.08" };
const permission = { policyId: "policy-sales", policyVersion: "1.0.0" };
const freshness = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
	maxAgeSeconds: 3600,
};

const draftBinding = {
	contractVersion: CONTEXT_CONTRACT_VERSION,
	kind: "source_binding" as const,
	bindingId: "gross-sales",
	version: "1.0.0",
	sourceSnapshotId: "sales-snapshot",
	subject: {
		subjectId: "gross-sales",
		kind: "metric" as const,
		label: "Gross Sales",
		definition: "Sum of order totals before refunds.",
	},
	targets: [{ tableId: "orders", columnIds: ["order-total"] }],
	grain: "one row per order",
	status: "draft" as const,
	permission,
	provenance: {
		sources: [salesSource],
		createdBy: { kind: "system" as const, id: "fixture-loader" },
		createdAt: "2026-08-25T00:05:00Z",
	},
	freshness,
};

const approval = {
	reviewerId: "reviewer-a",
	reviewedAt: "2026-08-25T00:10:00Z",
	decision: "approved" as const,
};

const publishedBinding = transitionSourceBinding(
	transitionSourceBinding(draftBinding, "submit_for_review"),
	"publish",
	approval,
);

const pack = {
	contractVersion: CONTEXT_CONTRACT_VERSION,
	kind: "context_pack" as const,
	packId: "sales-context",
	version: "1.0.0",
	name: "Sales context",
	status: "published" as const,
	sources: [salesSource, glossarySource],
	bindings: [{ kind: "source_binding" as const, id: "gross-sales", version: "1.0.0" }],
	resources: [
		{
			resourceId: "revenue-term",
			type: "term" as const,
			label: "Revenue",
			definition: "Sales before refunds.",
			aliases: ["sales", "revenue"],
			sources: [glossarySource],
		},
		{
			resourceId: "orders.order_total",
			type: "data_dictionary" as const,
			physicalName: "orders.order_total",
			description: "Order total column.",
			dataType: "decimal",
			source: salesSource,
			termIds: ["revenue-term"],
		},
		{
			resourceId: "refund-policy",
			type: "document" as const,
			title: "Refund policy",
			content: {
				uri: "fixture://docs/refund-policy",
				digest: "sha256:refund-policy-v1",
				mediaType: "text/markdown",
			},
			sources: [glossarySource],
		},
	],
	permissions: [permission],
	provenance: {
		sources: [salesSource, glossarySource],
		createdBy: { kind: "system" as const, id: "fixture-loader" },
		createdAt: "2026-08-25T00:05:00Z",
	},
	freshness,
	effectiveFrom: "2026-08-25T00:10:00Z",
	effectiveTo: "2026-09-01T00:00:00Z",
};

const context = {
	pack,
	bindings: [publishedBinding],
	at: "2026-08-25T00:20:00Z",
};

describe("path-02 context matching", () => {
	test("builds a stable candidate catalog and resolves stable IDs", () => {
		const result = buildContextMatchCatalog(context);
		expect(result.status).toBe("ready");
		if (result.status !== "ready") return;
		expect(result.catalog.candidates.map((candidate) => candidate.ref)).toEqual([
			{ kind: "data_dictionary", id: "orders.order_total", version: "1.0.0" },
			{ kind: "document", id: "refund-policy", version: "1.0.0" },
			{ kind: "source_binding", id: "gross-sales", version: "1.0.0" },
			{ kind: "term", id: "revenue-term", version: "1.0.0" },
		]);
		const resultById = matchContext(context, { query: "gross-sales" });
		expect(resultById).toMatchObject({
			status: "matched",
			matchKind: "id",
			candidate: { ref: { kind: "source_binding", id: "gross-sales", version: "1.0.0" } },
		});
	});

	test("normalizes human text and distinguishes aliases from physical names", () => {
		expect(matchContext(context, { query: "  SALES  " })).toMatchObject({
			status: "matched",
			matchKind: "alias",
			candidate: { ref: { kind: "term", id: "revenue-term" } },
		});
		expect(matchContext(context, { query: " orders.order_total " })).toMatchObject({
			status: "matched",
			matchKind: "physical_name",
			candidate: { ref: { kind: "data_dictionary", id: "orders.order_total" } },
		});
		expect(matchContext(context, { query: " revenue " })).toMatchObject({ status: "matched", matchKind: "label" });
		const aliasesForward = {
			...pack,
			resources: pack.resources.map((resource) =>
				resource.type === "term" ? { ...resource, aliases: ["SALES", "sales"] } : resource,
			),
		};
		const aliasesReversed = {
			...pack,
			resources: pack.resources.map((resource) =>
				resource.type === "term" ? { ...resource, aliases: ["sales", "SALES"] } : resource,
			),
		};
		const forwardCatalog = buildContextMatchCatalog({ ...context, pack: aliasesForward });
		const reversedCatalog = buildContextMatchCatalog({ ...context, pack: aliasesReversed });
		expect(forwardCatalog).toEqual(reversedCatalog);
	});

	test("uses higher-priority labels and reports same-tier ambiguity", () => {
		const labelWins = {
			...pack,
			resources: [
				...pack.resources,
				{
					resourceId: "sales-report",
					type: "document" as const,
					title: "Sales",
					content: {
						uri: "fixture://docs/sales",
						digest: "sha256:sales-v1",
						mediaType: "text/markdown",
					},
					sources: [glossarySource],
				},
			],
		};
		expect(matchContext({ ...context, pack: labelWins }, { query: "sales" })).toMatchObject({
			status: "matched",
			matchKind: "label",
			candidate: { ref: { kind: "document", id: "sales-report" } },
		});

		const ambiguousLabel = {
			...pack,
			resources: [
				...pack.resources,
				{
					resourceId: "revenue-term-2",
					type: "term" as const,
					label: "Revenue",
					definition: "Another revenue concept.",
					aliases: [],
					sources: [glossarySource],
				},
			],
		};
		const ambiguousResult = matchContext({ ...context, pack: ambiguousLabel }, { query: "revenue" });
		expect(ambiguousResult).toMatchObject({ status: "clarification_required", reason: "ambiguous_label" });
		if (ambiguousResult.status === "clarification_required") expect(ambiguousResult.candidates).toHaveLength(2);

		const sameId = {
			...pack,
			resources: [
				...pack.resources,
				{
					resourceId: "gross-sales",
					type: "term" as const,
					label: "Gross Sales",
					definition: "A duplicate ID in a separate candidate kind.",
					aliases: [],
					sources: [glossarySource],
				},
			],
		};
		const sameIdResult = matchContext({ ...context, pack: sameId }, { query: "gross-sales" });
		expect(sameIdResult).toMatchObject({ status: "clarification_required", reason: "ambiguous_id" });
	});

	test("blocks unavailable context and incomplete Binding closure", () => {
		expect(matchContext({ ...context, pack: { ...pack, status: "draft" } }, { query: "sales" })).toEqual({
			status: "blocked",
			reason: "invalid_context",
		});
		expect(matchContext({ ...context, bindings: [] }, { query: "sales" })).toEqual({
			status: "blocked",
			reason: "invalid_context",
		});
		expect(matchContext({ ...context, bindings: [draftBinding] }, { query: "sales" })).toEqual({
			status: "blocked",
			reason: "invalid_context",
		});
		const publishedV2 = { ...publishedBinding, version: "2.0.0" };
		const twoVersions = {
			pack: {
				...pack,
				bindings: [
					{ kind: "source_binding" as const, id: "gross-sales", version: "1.0.0" },
					{ kind: "source_binding" as const, id: "gross-sales", version: "2.0.0" },
				],
			},
			bindings: [publishedBinding, publishedV2],
			at: context.at,
		};
		expect(matchContext(twoVersions, { query: "sales" })).toEqual({
			status: "blocked",
			reason: "invalid_context",
		});
		expect(matchContext(context, { query: "   " })).toEqual({ status: "blocked", reason: "invalid_request" });
	});

	test("returns not-found without guessing", () => {
		expect(matchContext(context, { query: "unknown business concept" })).toEqual({
			status: "not_found",
			reason: "no_deterministic_match",
			warnings: [],
		});
	});

	test("keeps vector retrieval optional and non-authoritative", () => {
		let calls = 0;
		const adapter = {
			retrieve(request: VectorMatchRequest) {
				calls += 1;
				expect(request.query).toBe("total sales");
				expect(request.candidates.every((candidate) => !("definition" in candidate))).toBe(true);
				return [
					{
						candidate: { kind: "term" as const, id: "revenue-term", version: "1.0.0" },
						score: 0.82,
					},
				];
			},
		};
		const suggested = matchContext(context, { query: "total sales" }, adapter);
		expect(suggested).toMatchObject({ status: "suggested", authoritative: false });
		if (suggested.status === "suggested") expect(suggested.suggestions[0]?.score).toBe(0.82);

		const ambiguousPack = {
			...pack,
			resources: [
				...pack.resources,
				{
					resourceId: "revenue-term-2",
					type: "term" as const,
					label: "Revenue",
					definition: "Another revenue concept.",
					aliases: [],
					sources: [glossarySource],
				},
			],
		};
		const ambiguous = matchContext({ ...context, pack: ambiguousPack }, { query: "revenue" }, adapter);
		expect(ambiguous.status).toBe("clarification_required");
		expect(calls).toBe(1);
	});

	test("fails closed on vector adapter errors and invalid candidates", () => {
		const unavailable = matchContext(
			context,
			{ query: "total sales" },
			{
				retrieve: () => {
					throw new Error("provider secret");
				},
			},
		);
		expect(unavailable).toEqual({
			status: "not_found",
			reason: "vector_unavailable",
			warnings: ["vector_unavailable"],
		});
		const invalid = matchContext(
			context,
			{ query: "total sales" },
			{
				retrieve: () => [{ candidate: { kind: "term", id: "not-in-catalog", version: "1.0.0" }, score: 0.9 }],
			},
		);
		expect(invalid).toEqual({ status: "blocked", reason: "invalid_vector_result" });
	});
});
