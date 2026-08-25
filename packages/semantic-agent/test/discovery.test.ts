import { describe, expect, test } from "vitest";
import {
	discoverSourceSnapshot,
	type NormalizeSourceSnapshotRequest,
	normalizeSourceSnapshot,
	parseSourceConnector,
	SchemaDiscoveryError,
} from "../src/index.ts";

const connector = parseSourceConnector({
	contractVersion: "context.v1",
	kind: "source_connector",
	connectorId: "fixture-connector",
	sourceId: "sales-db",
	sourceType: "database",
	displayName: "Deterministic sales fixture",
	capabilities: {
		testConnection: true,
		discoverSchema: true,
		readOnlyQuery: false,
		cancel: false,
		healthCheck: true,
	},
	permission: { policyId: "policy-sales", policyVersion: "1.0.0" },
});

const freshness = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
	maxAgeSeconds: 3600,
};

const schema = {
	dialect: "fixture-sql",
	tables: [
		{
			tableId: "customers",
			name: "customers",
			columns: [{ columnId: "customer-id", name: "customer_id", dataType: "integer", nullable: false, ordinal: 0 }],
			primaryKey: ["customer-id"],
			foreignKeys: [],
		},
		{
			tableId: "orders",
			name: "orders",
			columns: [
				{ columnId: "order-total", name: "order_total", dataType: "decimal", nullable: false, ordinal: 1 },
				{ columnId: "customer-id", name: "customer_id", dataType: "integer", nullable: false, ordinal: 2 },
				{ columnId: "order-id", name: "order_id", dataType: "integer", nullable: false, ordinal: 0 },
			],
			primaryKey: ["order-id"],
			foreignKeys: [
				{
					constraintId: "orders-customer",
					columns: ["customer-id"],
					referencedTableId: "customers",
					referencedColumns: ["customer-id"],
				},
			],
			rowCount: 3,
		},
	],
};

function request(schemaValue: unknown): NormalizeSourceSnapshotRequest {
	return {
		connector,
		snapshotId: "sales-snapshot",
		version: "1.0.0",
		discoveredAt: "2026-08-25T00:05:00Z",
		freshness,
		schema: schemaValue,
	};
}

describe("path-02 schema discovery", () => {
	test("normalizes order-independent schema input to one fingerprint", () => {
		const first = normalizeSourceSnapshot(request(schema));
		const second = normalizeSourceSnapshot(
			request({
				dialect: "fixture-sql",
				tables: [...schema.tables].reverse().map((table) => ({
					...table,
					columns: [...table.columns].reverse(),
					foreignKeys: [...(table.foreignKeys ?? [])].reverse(),
				})),
			}),
		);

		expect(second).toEqual(first);
		expect(first.structureFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(first.tables.map((table) => table.tableId)).toEqual(["customers", "orders"]);
		expect(first.tables[1]?.columns.map((column) => column.columnId)).toEqual([
			"order-id",
			"order-total",
			"customer-id",
		]);
	});

	test("changes the fingerprint for structure changes and preserves freshness metadata", () => {
		const first = normalizeSourceSnapshot(request(schema));
		const changed = normalizeSourceSnapshot(
			request({
				...schema,
				tables: schema.tables.map((table) =>
					table.tableId === "orders"
						? {
								...table,
								columns: [
									...table.columns,
									{
										columnId: "order-status",
										name: "status",
										dataType: "varchar",
										nullable: true,
										ordinal: 3,
									},
								],
							}
						: table,
				),
			}),
		);
		const rowCountOnly = normalizeSourceSnapshot(
			request({
				...schema,
				tables: schema.tables.map((table) => (table.tableId === "orders" ? { ...table, rowCount: 4 } : table)),
			}),
		);

		expect(changed.structureFingerprint).not.toBe(first.structureFingerprint);
		expect(changed.freshness).toEqual(freshness);
		expect(rowCountOnly.structureFingerprint).toBe(first.structureFingerprint);
	});

	test("rejects duplicate IDs and broken foreign-key references", () => {
		expect(() =>
			normalizeSourceSnapshot(
				request({
					...schema,
					tables: [...schema.tables, schema.tables[0]],
				}),
			),
		).toThrow(SchemaDiscoveryError);

		expect(() =>
			normalizeSourceSnapshot(
				request({
					...schema,
					tables: schema.tables.map((table) =>
						table.tableId === "orders"
							? {
									...table,
									foreignKeys: table.foreignKeys?.map((foreignKey) => ({
										...foreignKey,
										referencedColumns: ["missing-column"],
									})),
								}
							: table,
					),
				}),
			),
		).toThrow("missing target column");

		expect(() =>
			normalizeSourceSnapshot(
				request({
					...schema,
					tables: schema.tables.map((table) =>
						table.tableId === "orders"
							? {
									...table,
									foreignKeys: table.foreignKeys?.map((foreignKey) => ({
										...foreignKey,
										columns: ["customer-id", "customer-id"],
										referencedColumns: ["customer-id", "customer-id"],
									})),
								}
							: table,
					),
				}),
			),
		).toThrow("columns contains duplicate ID");
	});

	test("does not persist connector extras or raw schema extras", () => {
		const snapshot = normalizeSourceSnapshot(
			request({
				...schema,
				password: "connector-secret",
				tables: schema.tables.map((table) => ({ ...table, rawRows: [{ order_total: 100 }] })),
			}),
		);

		expect(JSON.stringify(snapshot)).not.toContain("connector-secret");
		expect(JSON.stringify(snapshot)).not.toContain("rawRows");
	});

	test("returns blocked without a snapshot when the adapter fails", async () => {
		const result = await discoverSourceSnapshot({
			...request(undefined),
			adapter: {
				discoverSchema: async () => {
					throw new Error("database password should not be returned");
				},
			},
		});

		expect(result).toEqual({ status: "blocked", reason: "adapter_failed" });
		expect(JSON.stringify(result)).not.toContain("password");
	});

	test("passes only contract-safe context to an adapter", async () => {
		let receivedContext: unknown;
		const result = await discoverSourceSnapshot({
			...request(undefined),
			adapter: {
				discoverSchema: async (context) => {
					receivedContext = context;
					return schema;
				},
			},
		});

		expect(result.status).toBe("succeeded");
		expect(receivedContext).toEqual({ connector, snapshotId: "sales-snapshot", version: "1.0.0" });
	});

	test("blocks a connector without schema-discovery capability before invoking the adapter", async () => {
		let called = false;
		const result = await discoverSourceSnapshot({
			...request(undefined),
			connector: {
				...connector,
				capabilities: { ...connector.capabilities, discoverSchema: false },
			},
			adapter: {
				discoverSchema: async () => {
					called = true;
					return schema;
				},
			},
		});

		expect(result).toEqual({ status: "blocked", reason: "unsupported_capability" });
		expect(called).toBe(false);
	});
});
