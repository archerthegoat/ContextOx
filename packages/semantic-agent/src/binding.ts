import {
	type BindingApproval,
	type BindingTarget,
	ContextContractValidationError,
	isContract,
	type PermissionRef,
	type Provenance,
	parseSourceBinding,
	parseSourceSnapshot,
	type ResourceId,
	ResourceIdSchema,
	type SourceBinding,
	type SourceRef,
	type SourceSnapshot,
	type VersionId,
	VersionIdSchema,
} from "./contracts.ts";

export type BindingErrorCode =
	| "invalid_binding"
	| "invalid_snapshot"
	| "invalid_transition"
	| "conflict"
	| "not_found"
	| "not_publishable"
	| "not_published";

export class BindingError extends Error {
	readonly code: BindingErrorCode;

	constructor(code: BindingErrorCode, message: string) {
		super(message);
		this.name = "BindingError";
		this.code = code;
	}
}

export type BindingTransition = "submit_for_review" | "request_changes" | "publish" | "revoke" | "expire";

export type BindingConflictKind = "identity_mismatch" | "multiple_active_versions" | "subject_collision";

export interface BindingConflict {
	readonly kind: BindingConflictKind;
	readonly bindingIds: readonly ResourceId[];
	readonly versions: readonly VersionId[];
	readonly subjectId?: ResourceId;
}

export type BindingPublicationResult =
	| {
			readonly status: "published";
			readonly bindingId: ResourceId;
			readonly activeVersion: VersionId;
			readonly previousVersion?: VersionId;
	  }
	| {
			readonly status: "rolled_back";
			readonly bindingId: ResourceId;
			readonly activeVersion: VersionId;
			readonly previousVersion: VersionId;
	  };

function invalidBinding(message: string): never {
	throw new BindingError("invalid_binding", message);
}

function invalidSnapshot(message: string): never {
	throw new BindingError("invalid_snapshot", message);
}

function invalidTransition(message: string): never {
	throw new BindingError("invalid_transition", message);
}

function conflict(message: string): never {
	throw new BindingError("conflict", message);
}

function notFound(message: string): never {
	throw new BindingError("not_found", message);
}

function notPublishable(message: string): never {
	throw new BindingError("not_publishable", message);
}

function notPublished(message: string): never {
	throw new BindingError("not_published", message);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sourceKey(source: SourceRef): string {
	return `${source.sourceId}\u0000${source.version}`;
}

function normalizeSourceRefs(sources: readonly SourceRef[]): SourceRef[] {
	const normalized = sources
		.map((source) => ({ sourceId: source.sourceId, version: source.version }))
		.sort((left, right) => compareStrings(sourceKey(left), sourceKey(right)));
	const seen = new Set<string>();
	for (const source of normalized) {
		const key = sourceKey(source);
		if (seen.has(key)) invalidBinding("Duplicate provenance source reference");
		seen.add(key);
	}
	return normalized;
}

function normalizeProvenance(provenance: Provenance): Provenance {
	return {
		sources: normalizeSourceRefs(provenance.sources),
		createdBy: {
			kind: provenance.createdBy.kind,
			...(provenance.createdBy.id === undefined ? {} : { id: provenance.createdBy.id }),
		},
		createdAt: provenance.createdAt,
	};
}

function normalizePermission(permission: PermissionRef): PermissionRef {
	return { policyId: permission.policyId, policyVersion: permission.policyVersion };
}

function normalizeApproval(approval: BindingApproval | undefined): BindingApproval | undefined {
	if (approval === undefined) return undefined;
	return {
		reviewerId: approval.reviewerId,
		reviewedAt: approval.reviewedAt,
		decision: approval.decision,
		...(approval.note === undefined ? {} : { note: approval.note }),
	};
}

function normalizeTarget(target: BindingTarget): BindingTarget {
	const columnIds = [...target.columnIds].sort(compareStrings);
	const relationshipPath = target.relationshipPath === undefined ? undefined : [...target.relationshipPath];
	const seenColumns = new Set<string>();
	for (const columnId of columnIds) {
		if (seenColumns.has(columnId)) invalidBinding("Duplicate Binding target column");
		seenColumns.add(columnId);
	}
	if (relationshipPath !== undefined) {
		const seenPath = new Set<string>();
		for (const relationshipId of relationshipPath) {
			if (seenPath.has(relationshipId)) invalidBinding("Duplicate Binding relationship path item");
			seenPath.add(relationshipId);
		}
	}
	return {
		tableId: target.tableId,
		columnIds,
		...(relationshipPath === undefined ? {} : { relationshipPath }),
	};
}

function targetKey(target: BindingTarget): string {
	return `${target.tableId}\u0000${target.columnIds.join("\u0000")}\u0000${target.relationshipPath?.join("\u0000") ?? ""}`;
}

function validateApprovalState(binding: SourceBinding): void {
	if (binding.status === "published" && binding.approval?.decision !== "approved") {
		invalidBinding("Published Binding requires approved review");
	}
	if (binding.approval?.decision === "approved" && (binding.status === "draft" || binding.status === "in_review")) {
		invalidBinding("Approved review requires published Binding status");
	}
}

function validateAgainstSnapshot(binding: SourceBinding, snapshotValue: unknown): void {
	let snapshot: SourceSnapshot;
	try {
		snapshot = parseSourceSnapshot(snapshotValue);
	} catch (error) {
		if (error instanceof ContextContractValidationError)
			invalidSnapshot("Source Snapshot contract validation failed");
		invalidSnapshot("Source Snapshot contract validation failed");
	}
	if (binding.sourceSnapshotId !== snapshot.snapshotId) invalidSnapshot("Binding Snapshot reference does not match");
	const tableById = new Map(snapshot.tables.map((table) => [table.tableId, table]));
	for (const target of binding.targets) {
		const table = tableById.get(target.tableId);
		if (!table) invalidSnapshot("Binding target table is not present in the Snapshot");
		const columnIds = new Set(table.columns.map((column) => column.columnId));
		for (const columnId of target.columnIds) {
			if (!columnIds.has(columnId)) invalidSnapshot("Binding target column is not present in the Snapshot");
		}
	}
	if (binding.timeSemantics !== undefined) {
		const isTargetColumn = binding.targets.some((target) =>
			target.columnIds.includes(binding.timeSemantics!.columnId),
		);
		if (!isTargetColumn) invalidSnapshot("Binding time column is not present in the target columns");
	}
}

export function normalizeSourceBinding(value: unknown, snapshot?: unknown): SourceBinding {
	let binding: SourceBinding;
	try {
		binding = parseSourceBinding(value);
	} catch (error) {
		if (error instanceof ContextContractValidationError) invalidBinding("Source Binding contract validation failed");
		invalidBinding("Source Binding contract validation failed");
	}
	const targets = binding.targets
		.map(normalizeTarget)
		.sort((left, right) => compareStrings(targetKey(left), targetKey(right)));
	const targetKeys = new Set<string>();
	for (const target of targets) {
		const key = targetKey(target);
		if (targetKeys.has(key)) invalidBinding("Duplicate Binding target");
		targetKeys.add(key);
	}
	const approval = normalizeApproval(binding.approval);
	const normalized: SourceBinding = {
		contractVersion: binding.contractVersion,
		kind: "source_binding",
		bindingId: binding.bindingId,
		version: binding.version,
		sourceSnapshotId: binding.sourceSnapshotId,
		subject: {
			subjectId: binding.subject.subjectId,
			kind: binding.subject.kind,
			label: binding.subject.label,
			definition: binding.subject.definition,
		},
		targets,
		grain: binding.grain,
		...(binding.timeSemantics === undefined
			? {}
			: {
					timeSemantics: {
						columnId: binding.timeSemantics.columnId,
						timezone: binding.timeSemantics.timezone,
						boundary: binding.timeSemantics.boundary,
					},
				}),
		status: binding.status,
		permission: normalizePermission(binding.permission),
		provenance: normalizeProvenance(binding.provenance),
		freshness: {
			asOf: binding.freshness.asOf,
			checkedAt: binding.freshness.checkedAt,
			status: binding.freshness.status,
			...(binding.freshness.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: binding.freshness.maxAgeSeconds }),
		},
		...(approval === undefined ? {} : { approval }),
	};
	validateApprovalState(normalized);
	if (snapshot !== undefined) validateAgainstSnapshot(normalized, snapshot);
	return normalized;
}

export function transitionSourceBinding(
	value: unknown,
	transition: BindingTransition,
	approval?: unknown,
): SourceBinding {
	const binding = normalizeSourceBinding(value);
	if (approval !== undefined && transition !== "publish")
		invalidTransition("Approval can only be supplied while publishing");
	switch (transition) {
		case "submit_for_review":
			if (binding.status !== "draft") invalidTransition("Only draft Binding can enter review");
			return normalizeSourceBinding({ ...binding, status: "in_review" });
		case "request_changes":
			if (binding.status !== "in_review") invalidTransition("Only in-review Binding can return to draft");
			return normalizeSourceBinding({ ...binding, status: "draft" });
		case "publish":
			if (binding.status !== "in_review") invalidTransition("Only in-review Binding can be published");
			return normalizeSourceBinding({
				...binding,
				status: "published",
				...(approval === undefined ? {} : { approval }),
			});
		case "revoke":
			if (binding.status !== "published") invalidTransition("Only published Binding can be revoked");
			return normalizeSourceBinding({ ...binding, status: "revoked" });
		case "expire":
			if (binding.status !== "published") invalidTransition("Only published Binding can expire");
			return normalizeSourceBinding({ ...binding, status: "expired" });
		default:
			return invalidTransition("Unsupported Binding transition");
	}
}

function bindingIdentityKey(binding: SourceBinding): string {
	return `${binding.bindingId}\u0000${binding.version}`;
}

function canonicalBindingContent(binding: SourceBinding): string {
	const { status: _status, approval: _approval, ...content } = binding;
	return JSON.stringify(content);
}

function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compareStrings);
}

function conflictKey(item: BindingConflict): string {
	return `${item.kind}\u0000${item.subjectId ?? ""}\u0000${item.bindingIds.join("\u0000")}\u0000${item.versions.join("\u0000")}`;
}

function sortConflicts(conflicts: readonly BindingConflict[]): BindingConflict[] {
	const unique = new Map<string, BindingConflict>();
	for (const item of conflicts) unique.set(conflictKey(item), item);
	return [...unique.values()].sort((left, right) => compareStrings(conflictKey(left), conflictKey(right)));
}

export function findBindingConflicts(values: readonly unknown[]): BindingConflict[] {
	const bindings = values.map((value) => normalizeSourceBinding(value));
	const conflicts: BindingConflict[] = [];
	const byIdentity = new Map<string, SourceBinding>();
	for (const binding of bindings) {
		const key = bindingIdentityKey(binding);
		const existing = byIdentity.get(key);
		if (existing !== undefined && canonicalBindingContent(existing) !== canonicalBindingContent(binding)) {
			conflicts.push({ kind: "identity_mismatch", bindingIds: [binding.bindingId], versions: [binding.version] });
		}
		if (existing === undefined) byIdentity.set(key, binding);
	}

	const active = bindings.filter((binding) => binding.status === "published");
	const byBindingId = new Map<ResourceId, SourceBinding[]>();
	for (const binding of active) {
		const group = byBindingId.get(binding.bindingId) ?? [];
		group.push(binding);
		byBindingId.set(binding.bindingId, group);
	}
	for (const [bindingId, group] of byBindingId) {
		const versions = sortedUnique(group.map((binding) => binding.version));
		if (versions.length > 1) conflicts.push({ kind: "multiple_active_versions", bindingIds: [bindingId], versions });
	}

	const bySubject = new Map<ResourceId, SourceBinding[]>();
	for (const binding of active) {
		const group = bySubject.get(binding.subject.subjectId) ?? [];
		group.push(binding);
		bySubject.set(binding.subject.subjectId, group);
	}
	for (const [subjectId, group] of bySubject) {
		const bindingIds = sortedUnique(group.map((binding) => binding.bindingId));
		if (bindingIds.length > 1) {
			conflicts.push({
				kind: "subject_collision",
				subjectId,
				bindingIds,
				versions: sortedUnique(group.map((binding) => binding.version)),
			});
		}
	}
	return sortConflicts(conflicts);
}

function readResourceId(value: unknown): ResourceId {
	if (!isContract(ResourceIdSchema, value)) invalidBinding("Binding ID is invalid");
	return value;
}

function readVersionId(value: unknown): VersionId {
	if (!isContract(VersionIdSchema, value)) invalidBinding("Binding version is invalid");
	return value;
}

function publicationKey(bindingId: ResourceId, version: VersionId): string {
	return `${bindingId}\u0000${version}`;
}

export class BindingRegistry {
	private readonly versions = new Map<ResourceId, Map<VersionId, SourceBinding>>();

	private readonly publishedVersions = new Set<string>();

	private readonly activeVersions = new Map<ResourceId, VersionId>();

	register(value: unknown, snapshot?: unknown): SourceBinding {
		const binding = normalizeSourceBinding(value, snapshot);
		const versionMap = this.versions.get(binding.bindingId) ?? new Map<VersionId, SourceBinding>();
		const existing = versionMap.get(binding.version);
		if (existing !== undefined && canonicalBindingContent(existing) !== canonicalBindingContent(binding)) {
			return conflict("Binding identity already contains different content");
		}
		if (existing === undefined || existing.status !== "published" || binding.status === "published") {
			versionMap.set(binding.version, binding);
		}
		this.versions.set(binding.bindingId, versionMap);
		return normalizeSourceBinding(versionMap.get(binding.version) ?? binding);
	}

	publish(value: unknown, snapshot?: unknown): BindingPublicationResult {
		const binding = normalizeSourceBinding(value, snapshot);
		if (binding.status !== "published" || binding.approval?.decision !== "approved") {
			return notPublishable("Only approved published Binding can be published");
		}
		if (binding.freshness.status === "expired")
			return notPublishable("Expired Binding freshness cannot be published");
		const previousVersion = this.activeVersions.get(binding.bindingId);
		const currentBindings: SourceBinding[] = [];
		for (const [bindingId, version] of this.activeVersions) {
			if (bindingId === binding.bindingId) continue;
			const current = this.versions.get(bindingId)?.get(version);
			if (current !== undefined) currentBindings.push(current);
		}
		const conflicts = findBindingConflicts([...currentBindings, binding]);
		if (conflicts.length > 0) return conflict("Binding publication conflicts with an active Binding");
		this.register(binding, snapshot);
		this.publishedVersions.add(publicationKey(binding.bindingId, binding.version));
		this.activeVersions.set(binding.bindingId, binding.version);
		return {
			status: "published",
			bindingId: binding.bindingId,
			activeVersion: binding.version,
			...(previousVersion === undefined || previousVersion === binding.version ? {} : { previousVersion }),
		};
	}

	rollback(bindingIdValue: unknown, targetVersionValue: unknown): BindingPublicationResult {
		const bindingId = readResourceId(bindingIdValue);
		const targetVersion = readVersionId(targetVersionValue);
		const previousVersion = this.activeVersions.get(bindingId);
		if (previousVersion === undefined) notFound("Binding has no active published version");
		if (previousVersion === targetVersion) invalidTransition("Binding is already on the target version");
		const target = this.versions.get(bindingId)?.get(targetVersion);
		if (target === undefined) notFound("Target Binding version does not exist");
		if (!this.publishedVersions.has(publicationKey(bindingId, targetVersion))) {
			return notPublished("Target Binding version was never published");
		}
		if (target.status !== "published" || target.freshness.status === "expired") {
			return notPublishable("Target Binding version is not publishable");
		}
		const currentBindings: SourceBinding[] = [];
		for (const [otherBindingId, version] of this.activeVersions) {
			if (otherBindingId === bindingId) continue;
			const current = this.versions.get(otherBindingId)?.get(version);
			if (current !== undefined) currentBindings.push(current);
		}
		if (findBindingConflicts([...currentBindings, target]).length > 0) {
			return conflict("Binding rollback conflicts with an active Binding");
		}
		this.activeVersions.set(bindingId, targetVersion);
		return { status: "rolled_back", bindingId, activeVersion: targetVersion, previousVersion };
	}

	getCurrent(bindingIdValue: unknown): SourceBinding | undefined {
		const bindingId = readResourceId(bindingIdValue);
		const version = this.activeVersions.get(bindingId);
		if (version === undefined) return undefined;
		const binding = this.versions.get(bindingId)?.get(version);
		return binding === undefined ? undefined : normalizeSourceBinding(binding);
	}

	getVersion(bindingIdValue: unknown, versionValue: unknown): SourceBinding | undefined {
		const bindingId = readResourceId(bindingIdValue);
		const version = readVersionId(versionValue);
		const binding = this.versions.get(bindingId)?.get(version);
		return binding === undefined ? undefined : normalizeSourceBinding(binding);
	}

	listCurrent(): SourceBinding[] {
		return [...this.activeVersions.keys()]
			.sort(compareStrings)
			.map((bindingId) => this.getCurrent(bindingId))
			.filter((binding): binding is SourceBinding => binding !== undefined);
	}
}
