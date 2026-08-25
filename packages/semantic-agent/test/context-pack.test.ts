import { describe, expect, test } from "vitest";
import {
	CONTEXT_CONTRACT_VERSION,
	ContextPackError,
	evaluateContextPack,
	exportContextPack,
	importContextPack,
	normalizeContextPack,
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

const pack = {
	contractVersion: CONTEXT_CONTRACT_VERSION,
	kind: "context_pack" as const,
	packId: "sales-context",
	version: "1.0.0",
	name: "Sales context",
	status: "published" as const,
	sources: [glossarySource, salesSource],
	bindings: [{ kind: "source_binding" as const, id: "gross-sales", version: "1.0.0" }],
	resources: [
		{
			resourceId: "orders.customer_id",
			type: "data_dictionary" as const,
			physicalName: "orders.customer_id",
			description: "Customer identifier on an order.",
			dataType: "integer",
			source: salesSource,
			termIds: ["customer-id"],
		},
		{
			resourceId: "customer-id",
			type: "term" as const,
			label: "Customer",
			definition: "A party that places an order.",
			aliases: ["customer id", "customer"],
			sources: [glossarySource],
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

describe("path-02 context pack", () => {
	test("normalizes pack collections and resource collections deterministically", () => {
		const normalized = normalizeContextPack(pack);
		const reordered = normalizeContextPack({
			...pack,
			sources: [...pack.sources].reverse(),
			bindings: [...pack.bindings].reverse(),
			resources: [...pack.resources].reverse().map((resource) => {
				if (resource.type === "term") {
					return {
						...resource,
						aliases: [...resource.aliases].reverse(),
						sources: [...resource.sources].reverse(),
					};
				}
				if (resource.type === "document") return { ...resource, sources: [...resource.sources].reverse() };
				return { ...resource, termIds: [...resource.termIds].reverse() };
			}),
			permissions: [...pack.permissions].reverse(),
			provenance: { ...pack.provenance, sources: [...pack.provenance.sources].reverse() },
		});

		expect(reordered).toEqual(normalized);
		expect(normalized.resources.map((resource) => resource.resourceId)).toEqual([
			"customer-id",
			"orders.customer_id",
			"refund-policy",
		]);
		expect(normalized.resources[0]?.type).toBe("term");
	});

	test("enforces globally unique resources and closed references", () => {
		expect(() =>
			normalizeContextPack({
				...pack,
				resources: [...pack.resources, { ...pack.resources[0], type: "term", label: "Duplicate" }],
			}),
		).toThrow(ContextPackError);

		expect(() =>
			normalizeContextPack({
				...pack,
				resources: pack.resources.map((resource) =>
					resource.type === "data_dictionary" ? { ...resource, termIds: ["missing-term"] } : resource,
				),
			}),
		).toThrow("Data dictionary term reference is unresolved");

		expect(() =>
			normalizeContextPack({
				...pack,
				bindings: [{ kind: "source_snapshot", id: "sales-snapshot", version: "1.0.0" }],
			}),
		).toThrow("Context Pack bindings must reference Source Binding resources");

		expect(() =>
			normalizeContextPack({
				...pack,
				sources: [salesSource],
				provenance: { ...pack.provenance, sources: [salesSource] },
			}),
		).toThrow("Resource source is not declared by the pack");
	});

	test("rejects invalid effective windows and unknown fields without exposing input", () => {
		expect(() => normalizeContextPack({ ...pack, effectiveTo: "2026-08-25T00:10:00Z" })).toThrow(
			"Context Pack effective window is invalid",
		);
		const secret = "context-pack-secret";
		let error: unknown;
		try {
			normalizeContextPack({ ...pack, password: secret });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(ContextPackError);
		expect(JSON.stringify(error)).not.toContain(secret);
	});

	test("exports canonical JSON and imports it with the same normalized value", () => {
		const normalized = normalizeContextPack(pack);
		const serialized = exportContextPack({ ...pack, resources: [...pack.resources].reverse() });

		expect(serialized).toBe(JSON.stringify(normalized));
		expect(importContextPack(serialized)).toEqual(normalized);
		expect(() => importContextPack("not-json")).toThrow("Invalid ContextPack JSON");
	});

	test("evaluates lifecycle, effective window, and freshness without making stale data authoritative", () => {
		expect(evaluateContextPack(pack, "2026-08-25T00:10:00Z")).toEqual({ status: "available", warnings: [] });
		expect(
			evaluateContextPack({ ...pack, freshness: { ...freshness, status: "stale" } }, "2026-08-26T00:00:00Z"),
		).toEqual({ status: "available", warnings: ["freshness_stale"] });
		expect(
			evaluateContextPack({ ...pack, freshness: { ...freshness, status: "unknown" } }, "2026-08-26T00:00:00Z"),
		).toEqual({ status: "available", warnings: ["freshness_unknown"] });
		expect(
			evaluateContextPack({ ...pack, freshness: { ...freshness, status: "expired" } }, "2026-08-26T00:00:00Z"),
		).toEqual({ status: "blocked", reason: "freshness_expired" });
		expect(evaluateContextPack(pack, "2026-08-25T00:09:59Z")).toEqual({
			status: "blocked",
			reason: "not_yet_effective",
		});
		expect(evaluateContextPack(pack, "2026-09-01T00:00:00Z")).toEqual({ status: "blocked", reason: "expired" });
	});

	test("blocks non-published lifecycle states", () => {
		for (const [status, reason] of [
			["draft", "draft"],
			["in_review", "in_review"],
			["revoked", "revoked"],
			["expired", "expired"],
			["rolled_back", "rolled_back"],
		] as const) {
			expect(evaluateContextPack({ ...pack, status }, "2026-08-26T00:00:00Z")).toEqual({
				status: "blocked",
				reason,
			});
		}
		expect(evaluateContextPack(pack, "not-a-date")).toEqual({ status: "blocked", reason: "invalid_time" });
	});
});
