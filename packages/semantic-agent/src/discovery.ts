import { createHash } from "node:crypto";
import {
	assertContract,
	CONTEXT_CONTRACT_VERSION,
	ContextContractValidationError,
	type DateTime,
	DateTimeSchema,
	isContract,
	type ResourceId,
	ResourceIdSchema,
	type SnapshotColumn,
	type SnapshotForeignKey,
	type SnapshotTable,
	type SourceConnector,
	SourceConnectorSchema,
	type SourceSnapshot,
	SourceSnapshotSchema,
	type VersionId,
	VersionIdSchema,
} from "./contracts.ts";

export interface DiscoveredColumn {
	readonly columnId: string;
	readonly name: string;
	readonly dataType: string;
	readonly nullable: boolean;
	readonly ordinal: number;
}

export interface DiscoveredForeignKey {
	readonly constraintId: string;
	readonly columns: readonly string[];
	readonly referencedTableId: string;
	readonly referencedColumns: readonly string[];
}

export interface DiscoveredTable {
	readonly tableId: string;
	readonly name: string;
	readonly columns: readonly DiscoveredColumn[];
	readonly primaryKey?: readonly string[];
	readonly foreignKeys?: readonly DiscoveredForeignKey[];
	readonly rowCount?: number;
}

export interface DiscoveredSchema {
	readonly dialect: string;
	readonly tables: readonly DiscoveredTable[];
}

export interface SchemaDiscoveryContext {
	readonly connector: SourceConnector;
	readonly snapshotId: ResourceId;
	readonly version: VersionId;
}

export interface SchemaDiscoveryAdapter {
	discoverSchema(context: Readonly<SchemaDiscoveryContext>): Promise<unknown>;
}

export interface NormalizeSourceSnapshotRequest {
	readonly connector: SourceConnector;
	readonly snapshotId: ResourceId;
	readonly version: VersionId;
	readonly discoveredAt: DateTime;
	readonly freshness: SourceSnapshot["freshness"];
	readonly schema: unknown;
}

export interface DiscoverSourceSnapshotRequest extends Omit<NormalizeSourceSnapshotRequest, "schema"> {
	readonly adapter: SchemaDiscoveryAdapter;
}

export type SchemaDiscoveryErrorCode = "invalid_connector" | "invalid_schema";

export class SchemaDiscoveryError extends Error {
	readonly code: SchemaDiscoveryErrorCode;

	constructor(code: SchemaDiscoveryErrorCode, message: string) {
		super(message);
		this.name = "SchemaDiscoveryError";
		this.code = code;
	}
}

export type DiscoveryFailureReason =
	| "invalid_connector"
	| "unsupported_capability"
	| "invalid_schema"
	| "adapter_failed";

export type SourceDiscoveryResult =
	| { readonly status: "succeeded"; readonly snapshot: SourceSnapshot }
	| { readonly status: "blocked"; readonly reason: DiscoveryFailureReason };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSchema(message: string): never {
	throw new SchemaDiscoveryError("invalid_schema", message);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) invalidSchema(`${path} must be an object`);
	return value;
}

function readNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) invalidSchema(`${path} must be a non-empty string`);
	return value;
}

function readResourceId(value: unknown, path: string): ResourceId {
	if (!isContract(ResourceIdSchema, value)) invalidSchema(`${path} must be a valid resource ID`);
	return value;
}

function readNonNegativeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		invalidSchema(`${path} must be a non-negative integer`);
	}
	return value;
}

function readStringArray(value: unknown, path: string, minItems: number): string[] {
	if (!Array.isArray(value) || value.length < minItems)
		invalidSchema(`${path} must be an array with at least ${minItems} item(s)`);
	return value.map((item, index) => readResourceId(item, `${path}[${index}]`));
}

function readColumn(value: unknown, path: string): SnapshotColumn {
	const record = readRecord(value, path);
	return {
		columnId: readResourceId(record.columnId, `${path}.columnId`),
		name: readNonEmptyString(record.name, `${path}.name`),
		dataType: readNonEmptyString(record.dataType, `${path}.dataType`),
		nullable:
			typeof record.nullable === "boolean" ? record.nullable : invalidSchema(`${path}.nullable must be a boolean`),
		ordinal: readNonNegativeInteger(record.ordinal, `${path}.ordinal`),
	};
}

function readForeignKey(value: unknown, path: string): SnapshotForeignKey {
	const record = readRecord(value, path);
	return {
		constraintId: readResourceId(record.constraintId, `${path}.constraintId`),
		columns: readStringArray(record.columns, `${path}.columns`, 1),
		referencedTableId: readResourceId(record.referencedTableId, `${path}.referencedTableId`),
		referencedColumns: readStringArray(record.referencedColumns, `${path}.referencedColumns`, 1),
	};
}

function readTable(value: unknown, path: string): SnapshotTable {
	const record = readRecord(value, path);
	if (!Array.isArray(record.columns) || record.columns.length === 0)
		invalidSchema(`${path}.columns must not be empty`);
	const foreignKeys = record.foreignKeys === undefined ? [] : record.foreignKeys;
	if (!Array.isArray(foreignKeys)) invalidSchema(`${path}.foreignKeys must be an array`);
	const rowCount =
		record.rowCount === undefined ? undefined : readNonNegativeInteger(record.rowCount, `${path}.rowCount`);
	return {
		tableId: readResourceId(record.tableId, `${path}.tableId`),
		name: readNonEmptyString(record.name, `${path}.name`),
		columns: record.columns.map((column, index) => readColumn(column, `${path}.columns[${index}]`)),
		...(record.primaryKey === undefined
			? {}
			: { primaryKey: readStringArray(record.primaryKey, `${path}.primaryKey`, 1) }),
		foreignKeys: foreignKeys.map((foreignKey, index) => readForeignKey(foreignKey, `${path}.foreignKeys[${index}]`)),
		...(rowCount === undefined ? {} : { rowCount }),
	};
}

function readSchema(value: unknown): { readonly dialect: string; readonly tables: readonly SnapshotTable[] } {
	const record = readRecord(value, "schema");
	if (!Array.isArray(record.tables) || record.tables.length === 0) invalidSchema("schema.tables must not be empty");
	return {
		dialect: readNonEmptyString(record.dialect, "schema.dialect"),
		tables: record.tables.map((table, index) => readTable(table, `schema.tables[${index}]`)),
	};
}

function ensureUnique(values: readonly string[], path: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) invalidSchema(`${path} contains duplicate ID ${JSON.stringify(value)}`);
		seen.add(value);
	}
}

function validateReferences(tables: readonly SnapshotTable[]): void {
	ensureUnique(
		tables.map((table) => table.tableId),
		"schema.tables",
	);
	const tableById = new Map(tables.map((table) => [table.tableId, table]));

	for (const table of tables) {
		ensureUnique(
			table.columns.map((column) => column.columnId),
			`${table.tableId}.columns`,
		);
		ensureUnique(
			table.columns.map((column) => String(column.ordinal)),
			`${table.tableId}.columns.ordinal`,
		);
		ensureUnique(
			table.foreignKeys.map((foreignKey) => foreignKey.constraintId),
			`${table.tableId}.foreignKeys`,
		);
		ensureUnique(table.primaryKey ?? [], `${table.tableId}.primaryKey`);
		const columnIds = new Set(table.columns.map((column) => column.columnId));
		for (const columnId of table.primaryKey ?? []) {
			if (!columnIds.has(columnId))
				invalidSchema(`${table.tableId}.primaryKey references missing column ${JSON.stringify(columnId)}`);
		}
		for (const foreignKey of table.foreignKeys) {
			ensureUnique(foreignKey.columns, `${table.tableId}.${foreignKey.constraintId}.columns`);
			ensureUnique(foreignKey.referencedColumns, `${table.tableId}.${foreignKey.constraintId}.referencedColumns`);
			for (const columnId of foreignKey.columns) {
				if (!columnIds.has(columnId)) {
					invalidSchema(
						`${table.tableId}.${foreignKey.constraintId} references missing column ${JSON.stringify(columnId)}`,
					);
				}
			}
			const referencedTable = tableById.get(foreignKey.referencedTableId);
			if (!referencedTable) {
				invalidSchema(
					`${table.tableId}.${foreignKey.constraintId} references missing table ${JSON.stringify(foreignKey.referencedTableId)}`,
				);
			}
			const referencedColumnIds = new Set(referencedTable.columns.map((column) => column.columnId));
			for (const columnId of foreignKey.referencedColumns) {
				if (!referencedColumnIds.has(columnId)) {
					invalidSchema(
						`${table.tableId}.${foreignKey.constraintId} references missing target column ${JSON.stringify(columnId)}`,
					);
				}
			}
			if (foreignKey.columns.length !== foreignKey.referencedColumns.length) {
				invalidSchema(`${table.tableId}.${foreignKey.constraintId} has mismatched column counts`);
			}
		}
	}
}

function compareIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareById(left: { readonly tableId: string }, right: { readonly tableId: string }): number {
	return compareIds(left.tableId, right.tableId);
}

function normalizeTables(tables: readonly SnapshotTable[]): SnapshotTable[] {
	validateReferences(tables);
	return tables
		.map((table) => ({
			...table,
			columns: [...table.columns].sort(
				(left, right) => left.ordinal - right.ordinal || compareIds(left.columnId, right.columnId),
			),
			foreignKeys: [...table.foreignKeys].sort((left, right) => compareIds(left.constraintId, right.constraintId)),
		}))
		.sort(compareById);
}

function structureFingerprint(dialect: string, tables: readonly SnapshotTable[]): string {
	const structure = {
		dialect,
		tables: tables.map((table) => ({
			tableId: table.tableId,
			name: table.name,
			columns: table.columns.map(({ columnId, name, dataType, nullable, ordinal }) => ({
				columnId,
				name,
				dataType,
				nullable,
				ordinal,
			})),
			primaryKey: table.primaryKey ?? null,
			foreignKeys: table.foreignKeys.map(({ constraintId, columns, referencedTableId, referencedColumns }) => ({
				constraintId,
				columns,
				referencedTableId,
				referencedColumns,
			})),
		})),
	};
	return `sha256:${createHash("sha256").update(JSON.stringify(structure)).digest("hex")}`;
}

export function normalizeSourceSnapshot(request: NormalizeSourceSnapshotRequest): SourceSnapshot {
	if (!isContract(SourceConnectorSchema, request.connector)) {
		throw new SchemaDiscoveryError("invalid_connector", "connector does not satisfy SourceConnector contract");
	}
	if (!isContract(ResourceIdSchema, request.snapshotId) || !isContract(VersionIdSchema, request.version)) {
		invalidSchema("snapshot identity is invalid");
	}
	if (!isContract(DateTimeSchema, request.discoveredAt)) invalidSchema("discoveredAt is invalid");
	const { dialect, tables } = readSchema(request.schema);
	const normalizedTables = normalizeTables(tables);
	return assertContract(
		SourceSnapshotSchema,
		{
			contractVersion: CONTEXT_CONTRACT_VERSION,
			kind: "source_snapshot",
			snapshotId: request.snapshotId,
			sourceId: request.connector.sourceId,
			version: request.version,
			discoveredAt: request.discoveredAt,
			freshness: request.freshness,
			dialect,
			structureFingerprint: structureFingerprint(dialect, normalizedTables),
			tables: normalizedTables,
		},
		"SourceSnapshot",
	);
}

export async function discoverSourceSnapshot(request: DiscoverSourceSnapshotRequest): Promise<SourceDiscoveryResult> {
	if (!isContract(SourceConnectorSchema, request.connector)) return { status: "blocked", reason: "invalid_connector" };
	if (!request.connector.capabilities.discoverSchema) {
		return { status: "blocked", reason: "unsupported_capability" };
	}
	let schema: unknown;
	try {
		schema = await request.adapter.discoverSchema({
			connector: request.connector,
			snapshotId: request.snapshotId,
			version: request.version,
		});
	} catch {
		return { status: "blocked", reason: "adapter_failed" };
	}
	try {
		return { status: "succeeded", snapshot: normalizeSourceSnapshot({ ...request, schema }) };
	} catch (error) {
		if (error instanceof SchemaDiscoveryError && error.code === "invalid_connector") {
			return { status: "blocked", reason: "invalid_connector" };
		}
		if (error instanceof ContextContractValidationError || error instanceof SchemaDiscoveryError) {
			return { status: "blocked", reason: "invalid_schema" };
		}
		return { status: "blocked", reason: "invalid_schema" };
	}
}
