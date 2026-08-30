import { createHash } from "node:crypto";
import { normalizeSourceBinding } from "./binding.ts";
import { normalizeContextPack } from "./context-pack.ts";
import {
	parseSourceSnapshot,
	type SnapshotColumn,
	type SnapshotForeignKey,
	type SourceBinding,
	type SourceRef,
	type SourceSnapshot,
} from "./contracts.ts";
import {
	type AggregateFunction,
	ANALYSIS_CONTRACT_VERSION,
	type BindingExecutionSpec,
	type ColumnRef,
	normalizeBindingExecutionSpec,
	normalizeQueryPlan,
	type QueryFilter,
	type QueryPlan,
	type QueryTimeRange,
	type ScalarValue,
} from "./plan.ts";
import type { ExecutionContext, QueryPreflightResult } from "./preflight.ts";

export type QueryParameterType = "string" | "number" | "boolean" | "null";
export type QueryParameterRole = "filter" | "time_range" | "limit";

export interface CompiledParameter {
	readonly index: number;
	readonly role: QueryParameterRole;
	readonly type: QueryParameterType;
	readonly value: ScalarValue;
}

export interface CompiledQuery {
	readonly contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
	readonly readOnly: true;
	readonly dialect: string;
	readonly text: string;
	readonly parameters: readonly CompiledParameter[];
	readonly source: SourceRef;
	readonly snapshot: {
		readonly kind: "source_snapshot";
		readonly id: string;
		readonly version: string;
	};
	readonly binding: {
		readonly kind: "source_binding";
		readonly id: string;
		readonly version: string;
	};
	readonly executionSpec: {
		readonly kind: "binding_execution_spec";
		readonly id: string;
		readonly version: string;
	};
	readonly queryPlan: {
		readonly kind: "query_plan";
		readonly id: string;
		readonly version: string;
	};
	readonly asOf: string;
	readonly planDigest: string;
	readonly queryDigest: string;
	readonly estimatedRows: number;
	readonly estimatedBytes: number;
	readonly estimatedCost: number;
	readonly limit: number;
	readonly warnings: readonly string[];
}

export type QueryCompilerErrorCode =
	| "preflight_required"
	| "invalid_context"
	| "unsupported_dialect"
	| "ambiguous_base_table"
	| "unsupported_column"
	| "unsupported_relationship"
	| "unsupported_filter"
	| "invalid_parameter"
	| "budget_exceeded"
	| "cancelled";

export class QueryCompilerError extends Error {
	readonly code: QueryCompilerErrorCode;

	constructor(code: QueryCompilerErrorCode, message: string) {
		super(message);
		this.name = "QueryCompilerError";
		this.code = code;
	}
}

export interface ReadOnlyQueryExecutionRequest {
	readonly compiledQuery: CompiledQuery;
	readonly context: ExecutionContext;
}

export interface ReadOnlyQueryExecutor<TOutput = unknown> {
	execute(request: ReadOnlyQueryExecutionRequest): Promise<TOutput>;
}

interface TableIndexEntry {
	readonly tableId: string;
	readonly tableName: string;
	readonly columns: ReadonlyMap<string, SnapshotColumn>;
}

interface ForeignKeyIndexEntry {
	readonly tableId: string;
	readonly foreignKey: SnapshotForeignKey;
}

interface ResolvedColumn {
	readonly tableId: string;
	readonly tableName: string;
	readonly columnId: string;
	readonly columnName: string;
}

interface NormalizedCompilationInputs {
	readonly queryPlan: QueryPlan;
	readonly executionSpec: BindingExecutionSpec;
	readonly binding: SourceBinding;
	readonly snapshot: SourceSnapshot;
	readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function qualifiedColumn(column: ResolvedColumn): string {
	return `${quoteIdentifier(column.tableName)}.${quoteIdentifier(column.columnName)}`;
}

function normalizeCompilationInputs(value: unknown): NormalizedCompilationInputs {
	if (!isRecord(value) || value.status !== "ready") {
		throw new QueryCompilerError("preflight_required", "Query compilation requires a ready preflight result");
	}
	try {
		const snapshot = parseSourceSnapshot(value.snapshot);
		const binding = normalizeSourceBinding(value.binding, snapshot);
		const executionSpec = normalizeBindingExecutionSpec(value.executionSpec);
		const queryPlan = normalizeQueryPlan(value.queryPlan);
		const contextPack = normalizeContextPack(value.contextPack);
		if (contextPack.status !== "published") {
			throw new QueryCompilerError("preflight_required", "Compilation requires a published Context Pack");
		}
		if (binding.status !== "published" || binding.approval?.decision !== "approved") {
			throw new QueryCompilerError("preflight_required", "Compilation requires an approved published Binding");
		}
		if (executionSpec.status !== "published" || executionSpec.approval?.decision !== "approved") {
			throw new QueryCompilerError(
				"preflight_required",
				"Compilation requires an approved published execution specification",
			);
		}
		if (
			queryPlan.executionSpec.id !== executionSpec.specId ||
			queryPlan.executionSpec.version !== executionSpec.version
		) {
			throw new QueryCompilerError(
				"preflight_required",
				"Preflight QueryPlan and execution specification do not match",
			);
		}
		if (
			executionSpec.binding.id !== binding.bindingId ||
			executionSpec.binding.version !== binding.version ||
			executionSpec.snapshot.id !== snapshot.snapshotId ||
			executionSpec.snapshot.version !== snapshot.version
		) {
			throw new QueryCompilerError("preflight_required", "Preflight references are inconsistent");
		}
		if (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === "string")) {
			throw new QueryCompilerError("preflight_required", "Preflight warnings are invalid");
		}
		return { queryPlan, executionSpec, binding, snapshot, warnings: [...value.warnings] };
	} catch (error) {
		if (error instanceof QueryCompilerError) throw error;
		throw new QueryCompilerError("preflight_required", "Preflight inputs are not valid");
	}
}

function createTableIndex(snapshot: SourceSnapshot): ReadonlyMap<string, TableIndexEntry> {
	const tables = new Map<string, TableIndexEntry>();
	for (const table of snapshot.tables) {
		if (tables.has(table.tableId)) {
			throw new QueryCompilerError("unsupported_column", "Snapshot contains duplicate table IDs");
		}
		const columns = new Map<string, SnapshotColumn>();
		for (const column of table.columns) {
			if (columns.has(column.columnId)) {
				throw new QueryCompilerError("unsupported_column", "Snapshot contains duplicate column IDs");
			}
			columns.set(column.columnId, column);
		}
		tables.set(table.tableId, { tableId: table.tableId, tableName: table.name, columns });
	}
	return tables;
}

function createForeignKeyIndex(snapshot: SourceSnapshot): ReadonlyMap<string, ForeignKeyIndexEntry> {
	const foreignKeys = new Map<string, ForeignKeyIndexEntry>();
	for (const table of snapshot.tables) {
		for (const foreignKey of table.foreignKeys) {
			if (foreignKeys.has(foreignKey.constraintId)) {
				throw new QueryCompilerError("unsupported_relationship", "Snapshot contains duplicate foreign key IDs");
			}
			foreignKeys.set(foreignKey.constraintId, { tableId: table.tableId, foreignKey });
		}
	}
	return foreignKeys;
}

function resolveColumn(
	column: ColumnRef,
	tables: ReadonlyMap<string, TableIndexEntry>,
	availableTables?: ReadonlySet<string>,
): ResolvedColumn {
	if (availableTables !== undefined && !availableTables.has(column.tableId)) {
		throw new QueryCompilerError(
			"unsupported_column",
			"Query references a table outside its approved relationship paths",
		);
	}
	const table = tables.get(column.tableId);
	if (table === undefined) throw new QueryCompilerError("unsupported_column", "Query references an unknown table");
	const snapshotColumn = table.columns.get(column.columnId);
	if (snapshotColumn === undefined)
		throw new QueryCompilerError("unsupported_column", "Query references an unknown column");
	return {
		tableId: table.tableId,
		tableName: table.tableName,
		columnId: snapshotColumn.columnId,
		columnName: snapshotColumn.name,
	};
}

function resolveRootTable(binding: SourceBinding, tables: ReadonlyMap<string, TableIndexEntry>): string {
	const targetTableIds = [...new Set(binding.targets.map((target) => target.tableId))].sort(compareStrings);
	if (targetTableIds.length !== 1) {
		throw new QueryCompilerError(
			"ambiguous_base_table",
			"Compilation requires one approved Binding target table; root-table inference is not allowed",
		);
	}
	if (!tables.has(targetTableIds[0]))
		throw new QueryCompilerError("unsupported_column", "Binding root table is not in Snapshot");
	return targetTableIds[0];
}

function resolveRelationshipJoins(
	queryPlan: QueryPlan,
	executionSpec: BindingExecutionSpec,
	rootTableId: string,
	tables: ReadonlyMap<string, TableIndexEntry>,
	foreignKeys: ReadonlyMap<string, ForeignKeyIndexEntry>,
): { readonly sql: readonly string[]; readonly availableTables: ReadonlySet<string> } {
	const paths = new Map(executionSpec.relationshipPaths.map((path) => [path.relationshipPathId, path]));
	const availableTables = new Set([rootTableId]);
	const usedTableNames = new Set([tables.get(rootTableId)?.tableName]);
	const sql: string[] = [];
	const joins = [...queryPlan.joins].sort((left, right) =>
		compareStrings(left.relationshipPathId, right.relationshipPathId),
	);
	for (const join of joins) {
		const path = paths.get(join.relationshipPathId);
		if (path === undefined)
			throw new QueryCompilerError("unsupported_relationship", "Query references an unknown relationship path");
		let currentTableId = rootTableId;
		for (const foreignKeyId of path.foreignKeyIds) {
			const entry = foreignKeys.get(foreignKeyId);
			if (entry === undefined)
				throw new QueryCompilerError(
					"unsupported_relationship",
					"Relationship path references an unknown foreign key",
				);
			const foreignKey = entry.foreignKey;
			const forward = path.direction === "forward";
			const nextStartTableId = forward ? entry.tableId : foreignKey.referencedTableId;
			const nextTableId = forward ? foreignKey.referencedTableId : entry.tableId;
			if (currentTableId !== nextStartTableId) {
				throw new QueryCompilerError(
					"unsupported_relationship",
					"Relationship path is not continuous from the Binding root",
				);
			}
			const nextTable = tables.get(nextTableId);
			const currentTable = tables.get(currentTableId);
			if (nextTable === undefined || currentTable === undefined) {
				throw new QueryCompilerError("unsupported_relationship", "Relationship path references an unknown table");
			}
			if (availableTables.has(nextTableId)) {
				throw new QueryCompilerError(
					"unsupported_relationship",
					"Relationship path would reuse an already joined table",
				);
			}
			if (usedTableNames.has(nextTable.tableName)) {
				throw new QueryCompilerError("unsupported_relationship", "Joined physical table names are ambiguous");
			}
			if (foreignKey.columns.length !== foreignKey.referencedColumns.length) {
				throw new QueryCompilerError("unsupported_relationship", "Composite relationship columns are not paired");
			}
			const conditions = foreignKey.columns.map((columnId, index) => {
				const referencedColumnId = foreignKey.referencedColumns[index];
				if (referencedColumnId === undefined) {
					throw new QueryCompilerError(
						"unsupported_relationship",
						"Composite relationship columns are not paired",
					);
				}
				const localColumn = resolveColumn({ tableId: entry.tableId, columnId }, tables);
				const referencedColumn = resolveColumn(
					{ tableId: foreignKey.referencedTableId, columnId: referencedColumnId },
					tables,
				);
				return `${qualifiedColumn(localColumn)} = ${qualifiedColumn(referencedColumn)}`;
			});
			sql.push(`JOIN ${quoteIdentifier(nextTable.tableName)} ON ${conditions.join(" AND ")}`);
			availableTables.add(nextTableId);
			usedTableNames.add(nextTable.tableName);
			currentTableId = nextTableId;
		}
	}
	return { sql, availableTables };
}

function aggregateSql(aggregation: AggregateFunction): string {
	switch (aggregation) {
		case "count":
			return "COUNT";
		case "sum":
			return "SUM";
		case "avg":
			return "AVG";
		case "min":
			return "MIN";
		case "max":
			return "MAX";
		default:
			throw new QueryCompilerError("unsupported_filter", "Query uses an unsupported aggregate");
	}
}

function parameterType(value: ScalarValue): QueryParameterType {
	if (value === null) return "null";
	if (typeof value === "string") return "string";
	if (typeof value === "number") return "number";
	return "boolean";
}

function assertParameterValue(value: ScalarValue): void {
	if (typeof value === "number" && !Number.isFinite(value)) {
		throw new QueryCompilerError("invalid_parameter", "Query parameter numbers must be finite");
	}
}

function compileFilter(
	filter: QueryFilter,
	resolve: (column: ColumnRef) => ResolvedColumn,
	addParameter: (value: ScalarValue, role: QueryParameterRole) => string,
): string {
	const column = qualifiedColumn(resolve(filter.column));
	switch (filter.operator) {
		case "is_null":
			return `${column} IS NULL`;
		case "is_not_null":
			return `${column} IS NOT NULL`;
		case "eq":
		case "neq":
		case "gt":
		case "gte":
		case "lt":
		case "lte": {
			if (filter.value === null) {
				throw new QueryCompilerError(
					"invalid_parameter",
					"Null comparison values must use an explicit null predicate",
				);
			}
			const operators = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
			return `${column} ${operators[filter.operator]} ${addParameter(filter.value, "filter")}`;
		}
		case "in":
			if (filter.values.some((value) => value === null)) {
				throw new QueryCompilerError("invalid_parameter", "Null IN values must use an explicit null predicate");
			}
			return `${column} IN (${filter.values.map((value) => addParameter(value, "filter")).join(", ")})`;
		case "between":
			if (filter.values.some((value) => value === null)) {
				throw new QueryCompilerError("invalid_parameter", "Null range values are not supported");
			}
			return `${column} BETWEEN ${addParameter(filter.values[0], "filter")} AND ${addParameter(filter.values[1], "filter")}`;
		default:
			throw new QueryCompilerError("unsupported_filter", "Query uses an unsupported filter operator");
	}
}

function compileTimeRange(
	timeRange: QueryTimeRange,
	resolve: (column: ColumnRef) => ResolvedColumn,
	addParameter: (value: ScalarValue, role: QueryParameterRole) => string,
): string {
	const column = qualifiedColumn(resolve(timeRange.column));
	const from = addParameter(timeRange.from, "time_range");
	const to = addParameter(timeRange.to, "time_range");
	switch (timeRange.boundary) {
		case "closed":
			return `${column} BETWEEN ${from} AND ${to}`;
		case "open":
			return `${column} > ${from} AND ${column} < ${to}`;
		case "half_open":
			return `${column} >= ${from} AND ${column} < ${to}`;
		default:
			throw new QueryCompilerError("unsupported_filter", "Query uses an unsupported time boundary");
	}
}

function estimateBytes(limit: number, outputColumnCount: number): number {
	return limit * (64 + outputColumnCount * 64);
}

function ensureContextBudget(context: ExecutionContext, limit: number): void {
	if (
		!Number.isInteger(context.budget.maxSteps) ||
		!Number.isInteger(context.budget.maxRows) ||
		!Number.isInteger(context.budget.maxBytes) ||
		context.budget.maxSteps < 1 ||
		context.budget.maxRows < 1 ||
		context.budget.maxBytes < 1
	) {
		throw new QueryCompilerError("invalid_context", "Compilation requires a positive execution budget");
	}
	if (limit > context.budget.maxRows)
		throw new QueryCompilerError("budget_exceeded", "Query limit exceeds the row budget");
}

export function compileQueryPlan(preflight: QueryPreflightResult, context: ExecutionContext): CompiledQuery {
	if (context.signal?.aborted === true) throw new QueryCompilerError("cancelled", "Query compilation was cancelled");
	const inputs = normalizeCompilationInputs(preflight);
	const { queryPlan, executionSpec, binding, snapshot } = inputs;
	if (snapshot.dialect !== "fixture-sql") {
		throw new QueryCompilerError("unsupported_dialect", `Dialect ${snapshot.dialect} is not enabled in analysis.v1`);
	}
	ensureContextBudget(context, queryPlan.limit);

	const tables = createTableIndex(snapshot);
	const foreignKeys = createForeignKeyIndex(snapshot);
	const rootTableId = resolveRootTable(binding, tables);
	const rootTable = tables.get(rootTableId);
	if (rootTable === undefined)
		throw new QueryCompilerError("unsupported_column", "Binding root table is not in Snapshot");
	const joins = resolveRelationshipJoins(queryPlan, executionSpec, rootTableId, tables, foreignKeys);
	const resolveAvailable = (column: ColumnRef): ResolvedColumn => resolveColumn(column, tables, joins.availableTables);
	const dimensions = new Map(executionSpec.dimensions.map((dimension) => [dimension.dimensionId, dimension]));
	const measures = new Map(executionSpec.measures.map((measure) => [measure.measureId, measure]));
	const selectedAliases = new Map<string, string>();
	const selectItems: string[] = [];
	const selectedDimensionColumns = new Map<string, ResolvedColumn>();

	for (const dimensionRef of [...queryPlan.dimensions].sort((left, right) =>
		compareStrings(left.dimensionId, right.dimensionId),
	)) {
		const dimension = dimensions.get(dimensionRef.dimensionId);
		if (dimension === undefined)
			throw new QueryCompilerError("unsupported_column", "Query references an unknown dimension");
		const column = resolveAvailable(dimension.column);
		const alias = `dimension_${dimension.dimensionId}`;
		if (selectedAliases.has(alias))
			throw new QueryCompilerError("unsupported_column", "Query output aliases are ambiguous");
		selectedAliases.set(`dimension\u0000${dimension.dimensionId}`, alias);
		selectedDimensionColumns.set(dimension.dimensionId, column);
		selectItems.push(`${qualifiedColumn(column)} AS ${quoteIdentifier(alias)}`);
	}

	for (const measureRef of [...queryPlan.measures].sort((left, right) =>
		compareStrings(left.measureId, right.measureId),
	)) {
		const measure = measures.get(measureRef.measureId);
		if (measure === undefined || !measure.aggregations.includes(measureRef.aggregation)) {
			throw new QueryCompilerError("unsupported_column", "Query references an unavailable measure aggregation");
		}
		const column = resolveAvailable(measure.column);
		const alias = `measure_${measure.measureId}`;
		if (selectedAliases.has(alias))
			throw new QueryCompilerError("unsupported_column", "Query output aliases are ambiguous");
		selectedAliases.set(`measure\u0000${measure.measureId}`, alias);
		selectItems.push(
			`${aggregateSql(measureRef.aggregation)}(${qualifiedColumn(column)}) AS ${quoteIdentifier(alias)}`,
		);
	}

	const parameters: CompiledParameter[] = [];
	const addParameter = (value: ScalarValue, role: QueryParameterRole): string => {
		assertParameterValue(value);
		const index = parameters.length + 1;
		parameters.push({ index, role, type: parameterType(value), value });
		return "?";
	};
	const whereConditions = [...queryPlan.filters]
		.sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)))
		.map((filter) => compileFilter(filter, resolveAvailable, addParameter));
	if (queryPlan.timeRange !== undefined)
		whereConditions.push(compileTimeRange(queryPlan.timeRange, resolveAvailable, addParameter));

	const groupBy = [...selectedDimensionColumns.values()].map(qualifiedColumn);
	const orderBy = queryPlan.orderBy.map((order) => {
		const alias = selectedAliases.get(`${order.kind}\u0000${order.id}`);
		if (alias === undefined) throw new QueryCompilerError("unsupported_column", "Query order field is not selected");
		return `${quoteIdentifier(alias)} ${order.direction.toUpperCase()}`;
	});
	const limitParameter = addParameter(queryPlan.limit, "limit");
	const clauses = [
		`SELECT ${selectItems.join(", ")}`,
		`FROM ${quoteIdentifier(rootTable.tableName)}`,
		...joins.sql,
		...(whereConditions.length === 0 ? [] : [`WHERE ${whereConditions.join(" AND ")}`]),
		...(groupBy.length === 0 ? [] : [`GROUP BY ${groupBy.join(", ")}`]),
		...(orderBy.length === 0 ? [] : [`ORDER BY ${orderBy.join(", ")}`]),
		`LIMIT ${limitParameter}`,
	];
	const text = clauses.join(" ");
	const estimatedRows = queryPlan.limit;
	const estimatedBytes = estimateBytes(estimatedRows, selectItems.length);
	if (estimatedBytes > context.budget.maxBytes) {
		throw new QueryCompilerError("budget_exceeded", "Estimated query bytes exceed the execution budget");
	}
	const source = { sourceId: snapshot.sourceId, version: snapshot.version };
	return {
		contractVersion: ANALYSIS_CONTRACT_VERSION,
		readOnly: true,
		dialect: snapshot.dialect,
		text,
		parameters,
		source,
		snapshot: { kind: "source_snapshot", id: snapshot.snapshotId, version: snapshot.version },
		binding: { kind: "source_binding", id: binding.bindingId, version: binding.version },
		executionSpec: { kind: "binding_execution_spec", id: executionSpec.specId, version: executionSpec.version },
		queryPlan: { kind: "query_plan", id: queryPlan.queryPlanId, version: queryPlan.version },
		asOf: context.asOf,
		planDigest: digest(queryPlan),
		queryDigest: digest({ text, parameters: parameters.map(({ role, type }) => ({ role, type })) }),
		estimatedRows,
		estimatedBytes,
		estimatedCost:
			1 +
			queryPlan.filters.length +
			queryPlan.joins.length +
			queryPlan.dimensions.length +
			queryPlan.measures.length,
		limit: queryPlan.limit,
		warnings: inputs.warnings,
	};
}
