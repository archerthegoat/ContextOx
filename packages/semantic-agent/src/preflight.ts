import { normalizeSourceBinding } from "./binding.ts";
import { type ContextPackAvailabilityWarning, evaluateContextPack, normalizeContextPack } from "./context-pack.ts";
import {
	type ActorRef,
	ActorRefSchema,
	type ContextPack,
	DateTimeSchema,
	isContract,
	type PermissionRef,
	parseSourceSnapshot,
	type ResourceId,
	ResourceIdSchema,
	type SnapshotForeignKey,
	type SourceBinding,
	type SourceRef,
	type SourceSnapshot,
} from "./contracts.ts";
import {
	type BindingExecutionSpec,
	type ExecutionRelationshipPath,
	normalizeBindingExecutionSpec,
	normalizeQueryPlan,
	type QueryPlan,
} from "./plan.ts";

export type FreshnessPolicy = "fresh_only" | "allow_stale" | "allow_unknown";

export interface ExecutionBudget {
	readonly maxSteps: number;
	readonly maxRows: number;
	readonly maxBytes: number;
}

export type PolicyDecision =
	| { readonly decision: "allow" }
	| { readonly decision: "deny" }
	| { readonly decision: "unknown" };

export interface PolicyEvaluationRequest {
	readonly permission: PermissionRef;
	readonly actor: ActorRef;
	readonly organizationId?: ResourceId;
	readonly source: SourceRef;
	readonly resource: {
		readonly kind: "query_plan" | "binding_execution_spec";
		readonly id: ResourceId;
		readonly version: string;
	};
}

export interface PolicyEvaluator {
	evaluate(request: Readonly<PolicyEvaluationRequest>): Promise<PolicyDecision>;
}

export interface ExecutionContext {
	readonly runId: ResourceId;
	readonly actor: ActorRef;
	readonly organizationId?: ResourceId;
	readonly asOf: string;
	readonly freshnessPolicy: FreshnessPolicy;
	readonly budget: ExecutionBudget;
	readonly policyEvaluator: PolicyEvaluator;
	readonly signal?: AbortSignal;
}

export interface QueryPreflightRequest {
	readonly queryPlan: unknown;
	readonly executionSpec: unknown;
	readonly binding: unknown;
	readonly snapshot: unknown;
	readonly contextPack: unknown;
	readonly context: unknown;
}

export type PreflightWarning = ContextPackAvailabilityWarning;

export type PreflightBlockReason =
	| "invalid_context"
	| "invalid_query"
	| "invalid_execution_spec"
	| "snapshot_invalid"
	| "context_pack_unavailable"
	| "context_reference_missing"
	| "version_mismatch"
	| "binding_not_published"
	| "execution_spec_not_published"
	| "freshness_expired"
	| "freshness_not_allowed"
	| "permission_denied"
	| "unknown_permission"
	| "relation_not_allowed"
	| "grain_mismatch"
	| "budget_exceeded"
	| "cancelled";

export type QueryPreflightResult =
	| {
			readonly status: "ready";
			readonly queryPlan: QueryPlan;
			readonly executionSpec: BindingExecutionSpec;
			readonly binding: SourceBinding;
			readonly snapshot: SourceSnapshot;
			readonly contextPack: ContextPack;
			readonly warnings: readonly PreflightWarning[];
			readonly checkedPermissions: readonly PermissionRef[];
	  }
	| { readonly status: "blocked"; readonly reason: PreflightBlockReason };

interface SnapshotForeignKeyInfo {
	readonly tableId: ResourceId;
	readonly foreignKey: SnapshotForeignKey;
}

interface SnapshotIndex {
	readonly columns: ReadonlySet<string>;
	readonly foreignKeys: ReadonlyMap<ResourceId, SnapshotForeignKeyInfo>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFreshnessPolicy(value: unknown): value is FreshnessPolicy {
	return value === "fresh_only" || value === "allow_stale" || value === "allow_unknown";
}

function isAbortSignal(value: unknown): value is AbortSignal {
	return (
		isRecord(value) &&
		typeof value.aborted === "boolean" &&
		typeof value.addEventListener === "function" &&
		typeof value.removeEventListener === "function"
	);
}

function isPolicyEvaluator(value: unknown): value is PolicyEvaluator {
	return isRecord(value) && typeof value.evaluate === "function";
}

function isCancelled(context: ExecutionContext): boolean {
	return context.signal?.aborted === true;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isExecutionContext(value: unknown): value is ExecutionContext {
	if (!isRecord(value)) return false;
	const allowedKeys = new Set([
		"runId",
		"actor",
		"organizationId",
		"asOf",
		"freshnessPolicy",
		"budget",
		"policyEvaluator",
		"signal",
	]);
	if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
	if (!isContract(ResourceIdSchema, value.runId)) return false;
	if (!isContract(ActorRefSchema, value.actor)) return false;
	if (!isContract(DateTimeSchema, value.asOf)) return false;
	if (value.organizationId !== undefined && !isContract(ResourceIdSchema, value.organizationId)) return false;
	if (!isFreshnessPolicy(value.freshnessPolicy) || !isPolicyEvaluator(value.policyEvaluator)) return false;
	if (!isRecord(value.budget)) return false;
	if (
		!isPositiveInteger(value.budget.maxSteps) ||
		!isPositiveInteger(value.budget.maxRows) ||
		!isPositiveInteger(value.budget.maxBytes)
	) {
		return false;
	}
	return value.signal === undefined || isAbortSignal(value.signal);
}

function columnKey(tableId: string, columnId: string): string {
	return `${tableId}\u0000${columnId}`;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function permissionKey(permission: PermissionRef): string {
	return `${permission.policyId}\u0000${permission.policyVersion}`;
}

function hasPermission(permissions: readonly PermissionRef[], target: PermissionRef): boolean {
	return permissions.some((permission) => permissionKey(permission) === permissionKey(target));
}

function hasBindingReference(pack: ContextPack, binding: SourceBinding): boolean {
	return pack.bindings.some(
		(reference) =>
			reference.kind === "source_binding" &&
			reference.id === binding.bindingId &&
			reference.version === binding.version,
	);
}

function hasSourceReference(sources: readonly SourceRef[], target: SourceRef): boolean {
	return sources.some((source) => source.sourceId === target.sourceId && source.version === target.version);
}

function createSnapshotIndex(snapshot: SourceSnapshot): SnapshotIndex | undefined {
	const columns = new Set<string>();
	const foreignKeys = new Map<ResourceId, SnapshotForeignKeyInfo>();
	const tableIds = new Set<ResourceId>();
	const tableById = new Map(snapshot.tables.map((table) => [table.tableId, table]));
	for (const table of snapshot.tables) {
		if (tableIds.has(table.tableId)) return undefined;
		tableIds.add(table.tableId);
		const columnIds = new Set<ResourceId>();
		for (const column of table.columns) {
			if (columnIds.has(column.columnId)) return undefined;
			columnIds.add(column.columnId);
			columns.add(columnKey(table.tableId, column.columnId));
		}
		if (table.primaryKey?.some((columnId) => !columnIds.has(columnId))) return undefined;
	}
	for (const table of snapshot.tables) {
		const columnIds = new Set(table.columns.map((column) => column.columnId));
		for (const foreignKey of table.foreignKeys) {
			if (foreignKeys.has(foreignKey.constraintId)) return undefined;
			if (
				foreignKey.columns.length !== foreignKey.referencedColumns.length ||
				foreignKey.columns.some((columnId) => !columnIds.has(columnId))
			) {
				return undefined;
			}
			const referencedTable = tableById.get(foreignKey.referencedTableId);
			if (referencedTable === undefined) return undefined;
			const referencedColumnIds = new Set(referencedTable.columns.map((column) => column.columnId));
			if (foreignKey.referencedColumns.some((columnId) => !referencedColumnIds.has(columnId))) return undefined;
			foreignKeys.set(foreignKey.constraintId, { tableId: table.tableId, foreignKey });
		}
	}
	return { columns, foreignKeys };
}

function hasColumn(index: SnapshotIndex, column: { readonly tableId: string; readonly columnId: string }): boolean {
	return index.columns.has(columnKey(column.tableId, column.columnId));
}

function bindingTargetColumns(binding: SourceBinding): Set<string> {
	const columns = new Set<string>();
	for (const target of binding.targets) {
		for (const columnId of target.columnIds) columns.add(columnKey(target.tableId, columnId));
	}
	return columns;
}

function executionSpecColumns(spec: BindingExecutionSpec): Set<string> {
	const columns = new Set(spec.grainKeys.map((column) => columnKey(column.tableId, column.columnId)));
	for (const measure of spec.measures) columns.add(columnKey(measure.column.tableId, measure.column.columnId));
	for (const dimension of spec.dimensions) columns.add(columnKey(dimension.column.tableId, dimension.column.columnId));
	for (const timeColumn of spec.timeColumns) {
		columns.add(columnKey(timeColumn.column.tableId, timeColumn.column.columnId));
	}
	return columns;
}

function validateRelationshipPath(path: ExecutionRelationshipPath, index: SnapshotIndex): boolean {
	let currentTableId: ResourceId | undefined;
	for (const foreignKeyId of path.foreignKeyIds) {
		const info = index.foreignKeys.get(foreignKeyId);
		if (info === undefined) return false;
		const nextStart = path.direction === "forward" ? info.tableId : info.foreignKey.referencedTableId;
		const nextEnd = path.direction === "forward" ? info.foreignKey.referencedTableId : info.tableId;
		if (currentTableId !== undefined && currentTableId !== nextStart) return false;
		currentTableId = nextEnd;
	}
	return currentTableId !== undefined;
}

function validateExecutionSpec(
	spec: BindingExecutionSpec,
	binding: SourceBinding,
	snapshot: SourceSnapshot,
	index: SnapshotIndex,
): PreflightBlockReason | undefined {
	if (spec.binding.id !== binding.bindingId || spec.binding.version !== binding.version) return "version_mismatch";
	if (spec.snapshot.id !== snapshot.snapshotId || spec.snapshot.version !== snapshot.version)
		return "version_mismatch";
	if (binding.sourceSnapshotId !== snapshot.snapshotId) return "version_mismatch";
	if (spec.status !== "published") return "execution_spec_not_published";
	if (spec.approval?.decision !== "approved") return "execution_spec_not_published";

	const targetColumns = bindingTargetColumns(binding);
	for (const column of executionSpecColumns(spec)) {
		if (!index.columns.has(column)) {
			return "invalid_execution_spec";
		}
		if (!targetColumns.has(column)) return "invalid_execution_spec";
	}
	for (const path of spec.relationshipPaths) {
		if (!validateRelationshipPath(path, index)) return "relation_not_allowed";
	}
	return undefined;
}

function validateQueryAgainstSpec(
	query: QueryPlan,
	spec: BindingExecutionSpec,
	index: SnapshotIndex,
): PreflightBlockReason | undefined {
	if (query.executionSpec.id !== spec.specId || query.executionSpec.version !== spec.version) {
		return "version_mismatch";
	}
	const dimensions = new Map(spec.dimensions.map((dimension) => [dimension.dimensionId, dimension]));
	const measures = new Map(spec.measures.map((measure) => [measure.measureId, measure]));
	const timeColumns = new Map(
		spec.timeColumns.map((timeColumn) => [
			columnKey(timeColumn.column.tableId, timeColumn.column.columnId),
			timeColumn,
		]),
	);
	const allowedColumns = executionSpecColumns(spec);
	const relationshipPaths = new Map(spec.relationshipPaths.map((path) => [path.relationshipPathId, path]));

	for (const dimension of query.dimensions) {
		const definition = dimensions.get(dimension.dimensionId);
		if (
			definition === undefined ||
			!spec.grainKeys.some(
				(grain) =>
					columnKey(grain.tableId, grain.columnId) ===
					columnKey(definition.column.tableId, definition.column.columnId),
			)
		) {
			return "grain_mismatch";
		}
	}
	for (const measure of query.measures) {
		const definition = measures.get(measure.measureId);
		if (definition === undefined || !definition.aggregations.includes(measure.aggregation)) return "grain_mismatch";
	}
	for (const filter of query.filters) {
		if (
			!hasColumn(index, filter.column) ||
			!allowedColumns.has(columnKey(filter.column.tableId, filter.column.columnId))
		) {
			return "grain_mismatch";
		}
	}
	if (query.timeRange !== undefined) {
		const timeColumn = timeColumns.get(columnKey(query.timeRange.column.tableId, query.timeRange.column.columnId));
		if (timeColumn === undefined || timeColumn.boundary !== query.timeRange.boundary) return "grain_mismatch";
	}
	for (const join of query.joins) {
		if (relationshipPaths.get(join.relationshipPathId) === undefined) return "relation_not_allowed";
	}
	return undefined;
}

function freshnessResult(
	status: "fresh" | "stale" | "unknown" | "expired",
	policy: FreshnessPolicy,
): { readonly warning?: PreflightWarning; readonly reason?: PreflightBlockReason } {
	if (status === "expired") return { reason: "freshness_expired" };
	if (status === "stale")
		return policy === "fresh_only" ? { reason: "freshness_not_allowed" } : { warning: "freshness_stale" };
	if (status === "unknown")
		return policy === "allow_unknown" ? { warning: "freshness_unknown" } : { reason: "freshness_not_allowed" };
	return {};
}

function isPolicyDecision(value: unknown): value is PolicyDecision {
	return isRecord(value) && (value.decision === "allow" || value.decision === "deny" || value.decision === "unknown");
}

function uniquePermissions(values: readonly PermissionRef[]): PermissionRef[] {
	const byKey = new Map<string, PermissionRef>();
	for (const permission of values) byKey.set(permissionKey(permission), { ...permission });
	return [...byKey.values()].sort((left, right) => compareStrings(permissionKey(left), permissionKey(right)));
}

interface PermissionCheck {
	readonly permission: PermissionRef;
	readonly resource: PolicyEvaluationRequest["resource"];
}

function permissionCheckKey(check: PermissionCheck): string {
	const resource = check.resource;
	return `${permissionKey(check.permission)}\u0000${resource.kind}\u0000${resource.id}\u0000${resource.version}`;
}

async function evaluatePermissions(
	checks: readonly PermissionCheck[],
	context: ExecutionContext,
	source: SourceRef,
): Promise<{ readonly reason?: PreflightBlockReason; readonly checked: readonly PermissionRef[] }> {
	const uniqueChecks = [...new Map(checks.map((check) => [permissionCheckKey(check), check])).values()].sort(
		(left, right) => compareStrings(permissionCheckKey(left), permissionCheckKey(right)),
	);
	const checked = uniquePermissions(uniqueChecks.map((check) => check.permission));
	for (const check of uniqueChecks) {
		const permission = check.permission;
		if (isCancelled(context)) return { reason: "cancelled", checked };
		let decision: unknown;
		try {
			decision = await context.policyEvaluator.evaluate({
				permission,
				actor: context.actor,
				...(context.organizationId === undefined ? {} : { organizationId: context.organizationId }),
				source,
				resource: check.resource,
			});
		} catch {
			return { reason: "unknown_permission", checked };
		}
		if (!isPolicyDecision(decision) || decision.decision === "unknown")
			return { reason: "unknown_permission", checked };
		if (decision.decision === "deny") return { reason: "permission_denied", checked };
	}
	return { checked };
}

export async function preflightQueryPlan(request: QueryPreflightRequest): Promise<QueryPreflightResult> {
	if (!isExecutionContext(request.context)) return { status: "blocked", reason: "invalid_context" };
	const context = request.context;
	if (isCancelled(context)) return { status: "blocked", reason: "cancelled" };

	let queryPlan: QueryPlan;
	let executionSpec: BindingExecutionSpec;
	let binding: SourceBinding;
	let snapshot: SourceSnapshot;
	let contextPack: ContextPack;
	try {
		queryPlan = normalizeQueryPlan(request.queryPlan);
	} catch {
		return { status: "blocked", reason: "invalid_query" };
	}
	try {
		snapshot = parseSourceSnapshot(request.snapshot);
	} catch {
		return { status: "blocked", reason: "snapshot_invalid" };
	}
	const snapshotIndex = createSnapshotIndex(snapshot);
	if (snapshotIndex === undefined) return { status: "blocked", reason: "snapshot_invalid" };
	try {
		binding = normalizeSourceBinding(request.binding, snapshot);
	} catch {
		return { status: "blocked", reason: "context_reference_missing" };
	}
	try {
		executionSpec = normalizeBindingExecutionSpec(request.executionSpec);
	} catch {
		return { status: "blocked", reason: "invalid_execution_spec" };
	}
	try {
		contextPack = normalizeContextPack(request.contextPack);
	} catch {
		return { status: "blocked", reason: "context_pack_unavailable" };
	}

	const availability = evaluateContextPack(contextPack, context.asOf);
	if (availability.status !== "available") {
		return {
			status: "blocked",
			reason: availability.reason === "freshness_expired" ? "freshness_expired" : "context_pack_unavailable",
		};
	}
	if (!hasBindingReference(contextPack, binding)) return { status: "blocked", reason: "context_reference_missing" };
	const sourceRef = { sourceId: snapshot.sourceId, version: snapshot.version };
	if (
		!hasSourceReference(contextPack.sources, sourceRef) ||
		!hasSourceReference(binding.provenance.sources, sourceRef) ||
		!hasSourceReference(executionSpec.provenance.sources, sourceRef)
	) {
		return { status: "blocked", reason: "context_reference_missing" };
	}
	if (
		!hasPermission(contextPack.permissions, binding.permission) ||
		!hasPermission(contextPack.permissions, executionSpec.permission)
	) {
		return { status: "blocked", reason: "context_reference_missing" };
	}
	if (binding.status !== "published" || binding.approval?.decision !== "approved") {
		return { status: "blocked", reason: "binding_not_published" };
	}

	const specReason = validateExecutionSpec(executionSpec, binding, snapshot, snapshotIndex);
	if (specReason !== undefined) return { status: "blocked", reason: specReason };
	const queryReason = validateQueryAgainstSpec(queryPlan, executionSpec, snapshotIndex);
	if (queryReason !== undefined) return { status: "blocked", reason: queryReason };
	if (queryPlan.limit > context.budget.maxRows || context.budget.maxSteps < 1) {
		return { status: "blocked", reason: "budget_exceeded" };
	}

	const warnings = new Set<PreflightWarning>();
	for (const freshness of [contextPack.freshness, binding.freshness, executionSpec.freshness, snapshot.freshness]) {
		const result = freshnessResult(freshness.status, context.freshnessPolicy);
		if (result.reason !== undefined) return { status: "blocked", reason: result.reason };
		if (result.warning !== undefined) warnings.add(result.warning);
	}

	const permissionResult = await evaluatePermissions(
		[
			{
				permission: binding.permission,
				resource: { kind: "query_plan", id: queryPlan.queryPlanId, version: queryPlan.version },
			},
			{
				permission: executionSpec.permission,
				resource: { kind: "binding_execution_spec", id: executionSpec.specId, version: executionSpec.version },
			},
		],
		context,
		sourceRef,
	);
	if (permissionResult.reason !== undefined) return { status: "blocked", reason: permissionResult.reason };
	if (isCancelled(context)) return { status: "blocked", reason: "cancelled" };

	return {
		status: "ready",
		queryPlan,
		executionSpec,
		binding,
		snapshot,
		contextPack,
		warnings: [...warnings].sort(compareStrings),
		checkedPermissions: permissionResult.checked,
	};
}
