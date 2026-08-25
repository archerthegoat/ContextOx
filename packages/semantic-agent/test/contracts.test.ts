import { describe, expect, test } from "vitest";
import {
	assertContract,
	CONTEXT_CONTRACT_VERSION,
	ContextContractValidationError,
	JSON_SCHEMA_DIALECT,
	parseContextPack,
	parseSourceBinding,
	parseSourceConnector,
	parseSourceSnapshot,
	SourceConnectorSchema,
} from "../src/index.ts";

const permission = { policyId: "policy-sales", policyVersion: "1.0.0" };
const sourceRef = { sourceId: "sales-db", version: "snapshot-1" };
const freshness = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
	maxAgeSeconds: 3600,
};
const provenance = {
	sources: [sourceRef],
	createdBy: { kind: "system" as const, id: "fixture-loader" },
	createdAt: "2026-08-25T00:05:00Z",
};

describe("path-02 context contracts", () => {
	test("accepts a source connector without credentials", () => {
		const connector = parseSourceConnector({
			contractVersion: CONTEXT_CONTRACT_VERSION,
			kind: "source_connector",
			connectorId: "fixture-connector",
			sourceId: "sales-db",
			sourceType: "database",
			displayName: "Deterministic sales fixture",
			capabilities: {
				testConnection: true,
				discoverSchema: true,
				readOnlyQuery: true,
				cancel: true,
				healthCheck: true,
			},
			permission,
		});

		expect(connector.sourceId).toBe("sales-db");
	});

	test("rejects credentials and unknown fields at the contract boundary", () => {
		expect(() =>
			parseSourceConnector({
				contractVersion: CONTEXT_CONTRACT_VERSION,
				kind: "source_connector",
				connectorId: "fixture-connector",
				sourceId: "sales-db",
				sourceType: "database",
				displayName: "Deterministic sales fixture",
				capabilities: {
					testConnection: true,
					discoverSchema: true,
					readOnlyQuery: true,
					cancel: true,
					healthCheck: true,
				},
				permission,
				password: "secret",
			}),
		).toThrow(ContextContractValidationError);
	});

	test("accepts a normalized source snapshot", () => {
		const snapshot = parseSourceSnapshot({
			contractVersion: CONTEXT_CONTRACT_VERSION,
			kind: "source_snapshot",
			snapshotId: "sales-snapshot",
			sourceId: "sales-db",
			version: "1.0.0",
			discoveredAt: "2026-08-25T00:05:00Z",
			freshness,
			dialect: "fixture-sql",
			structureFingerprint: "sha256:fixture-sales-v1",
			tables: [
				{
					tableId: "orders",
					name: "orders",
					columns: [
						{ columnId: "order-id", name: "order_id", dataType: "integer", nullable: false, ordinal: 0 },
						{ columnId: "order-total", name: "order_total", dataType: "decimal", nullable: false, ordinal: 1 },
					],
					primaryKey: ["order-id"],
					foreignKeys: [],
					rowCount: 3,
				},
			],
		});

		expect(snapshot.tables[0]?.columns).toHaveLength(2);
		expect(JSON_SCHEMA_DIALECT).toBe("https://json-schema.org/draft/2020-12/schema");
	});

	test("accepts a reviewed source binding and context pack", () => {
		const binding = parseSourceBinding({
			contractVersion: CONTEXT_CONTRACT_VERSION,
			kind: "source_binding",
			bindingId: "gross-sales",
			version: "1.0.0",
			sourceSnapshotId: "sales-snapshot",
			subject: {
				subjectId: "gross-sales",
				kind: "metric",
				label: "Gross sales",
				definition: "Sum of order totals before refunds.",
			},
			targets: [{ tableId: "orders", columnIds: ["order-total"] }],
			grain: "one row per order",
			timeSemantics: { columnId: "order-date", timezone: "UTC", boundary: "half_open" },
			status: "published",
			permission,
			provenance,
			freshness,
			approval: {
				reviewerId: "admin-a",
				reviewedAt: "2026-08-25T00:10:00Z",
				decision: "approved",
			},
		});

		const pack = parseContextPack({
			contractVersion: CONTEXT_CONTRACT_VERSION,
			kind: "context_pack",
			packId: "sales-context",
			version: "1.0.0",
			name: "Sales context",
			status: "published",
			sources: [sourceRef],
			bindings: [{ kind: "source_binding", id: binding.bindingId, version: binding.version }],
			resources: [
				{
					resourceId: "gross-sales-term",
					type: "term",
					label: "Gross sales",
					definition: "Order totals before refunds.",
					aliases: ["sales", "revenue before refunds"],
					sources: [sourceRef],
				},
			],
			permissions: [permission],
			provenance,
			freshness,
			effectiveFrom: "2026-08-25T00:10:00Z",
		});

		expect(pack.bindings[0]).toEqual({ kind: "source_binding", id: "gross-sales", version: "1.0.0" });
	});

	test("does not expose raw validation details", () => {
		expect(() => assertContract(SourceConnectorSchema, { password: "secret" }, "SourceConnector")).toThrow(
			"Invalid SourceConnector context contract",
		);
	});
});
