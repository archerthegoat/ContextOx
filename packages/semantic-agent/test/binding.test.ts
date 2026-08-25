import { describe, expect, test } from "vitest";
import {
	BindingError,
	BindingRegistry,
	CONTEXT_CONTRACT_VERSION,
	findBindingConflicts,
	normalizeSourceBinding,
	transitionSourceBinding,
} from "../src/index.ts";

const sourceRef = { sourceId: "sales-db", version: "snapshot-1" };
const permission = { policyId: "policy-sales", policyVersion: "1.0.0" };
const freshness = {
	asOf: "2026-08-25T00:00:00Z",
	checkedAt: "2026-08-25T00:05:00Z",
	status: "fresh" as const,
	maxAgeSeconds: 3600,
};

const snapshot = {
	contractVersion: CONTEXT_CONTRACT_VERSION,
	kind: "source_snapshot" as const,
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
				{ columnId: "order-id", name: "order_id", dataType: "string", nullable: false, ordinal: 0 },
				{ columnId: "order-total", name: "order_total", dataType: "decimal", nullable: false, ordinal: 1 },
				{ columnId: "order-date", name: "order_date", dataType: "timestamp", nullable: false, ordinal: 2 },
			],
			primaryKey: ["order-id"],
			foreignKeys: [],
		},
	],
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
		label: "Gross sales",
		definition: "Sum of order totals before refunds.",
	},
	targets: [
		{
			tableId: "orders",
			columnIds: ["order-total", "order-date"],
		},
	],
	grain: "one row per order",
	timeSemantics: { columnId: "order-date", timezone: "UTC", boundary: "half_open" as const },
	status: "draft" as const,
	permission,
	provenance: {
		sources: [sourceRef],
		createdBy: { kind: "system" as const, id: "fixture-loader" },
		createdAt: "2026-08-25T00:05:00Z",
	},
	freshness,
};

const approval = {
	reviewerId: "reviewer-a",
	reviewedAt: "2026-08-25T00:10:00Z",
	decision: "approved" as const,
	note: "Reviewed against the sales snapshot.",
};

function publishedBinding(binding = draftBinding) {
	const inReview = transitionSourceBinding(binding, "submit_for_review");
	return transitionSourceBinding(inReview, "publish", approval);
}

describe("path-02 source binding", () => {
	test("normalizes targets and validates references against a Source Snapshot", () => {
		const normalized = normalizeSourceBinding(
			{
				...draftBinding,
				targets: [{ tableId: "orders", columnIds: ["order-total", "order-date"] }],
			},
			snapshot,
		);

		expect(normalized.targets[0]?.columnIds).toEqual(["order-date", "order-total"]);
		expect(normalized.timeSemantics?.columnId).toBe("order-date");
		expect(() =>
			normalizeSourceBinding(
				{
					...draftBinding,
					targets: [{ tableId: "orders", columnIds: ["order-total", "order-date", "order-total"] }],
				},
				snapshot,
			),
		).toThrow("Duplicate Binding target column");
		expect(() =>
			normalizeSourceBinding(
				{ ...draftBinding, targets: [{ tableId: "missing-table", columnIds: ["order-total"] }] },
				snapshot,
			),
		).toThrow("Binding target table is not present in the Snapshot");
		expect(() => normalizeSourceBinding({ ...draftBinding, password: "binding-secret" })).toThrow(BindingError);
	});

	test("enforces review and publication state transitions", () => {
		const inReview = transitionSourceBinding(draftBinding, "submit_for_review");
		expect(inReview.status).toBe("in_review");
		expect(transitionSourceBinding(inReview, "request_changes").status).toBe("draft");
		expect(() => transitionSourceBinding(inReview, "publish")).toThrow(BindingError);

		const published = transitionSourceBinding(inReview, "publish", approval);
		expect(published.status).toBe("published");
		expect(published.approval?.decision).toBe("approved");
		expect(transitionSourceBinding(published, "revoke").status).toBe("revoked");
		expect(transitionSourceBinding(published, "expire").status).toBe("expired");
		expect(() => transitionSourceBinding(draftBinding, "revoke")).toThrow("Only published Binding can be revoked");
	});

	test("reports deterministic conflicts without treating aliases as conflicts", () => {
		const published = publishedBinding();
		const same = { ...published };
		const secondVersion = { ...published, version: "2.0.0" };
		const secondSubjectBinding = { ...published, bindingId: "net-sales" };
		const changedIdentity = { ...published, subject: { ...published.subject, definition: "Different definition." } };

		expect(findBindingConflicts([published, same])).toEqual([]);
		expect(findBindingConflicts([published, transitionSourceBinding(published, "revoke")])).toEqual([]);
		expect(findBindingConflicts([published, secondVersion])).toEqual([
			{ kind: "multiple_active_versions", bindingIds: ["gross-sales"], versions: ["1.0.0", "2.0.0"] },
		]);
		expect(findBindingConflicts([published, secondSubjectBinding])).toEqual([
			{
				kind: "subject_collision",
				subjectId: "gross-sales",
				bindingIds: ["gross-sales", "net-sales"],
				versions: ["1.0.0"],
			},
		]);
		expect(findBindingConflicts([published, changedIdentity])).toEqual([
			{ kind: "identity_mismatch", bindingIds: ["gross-sales"], versions: ["1.0.0"] },
		]);
	});

	test("publishes one active version and rolls back by moving a pointer", () => {
		const registry = new BindingRegistry();
		const publishedV1 = publishedBinding();
		const publishedV2 = publishedBinding({ ...draftBinding, version: "2.0.0" });

		expect(registry.register(draftBinding).status).toBe("draft");
		expect(registry.register(transitionSourceBinding(draftBinding, "submit_for_review")).status).toBe("in_review");
		expect(registry.publish(publishedV1)).toEqual({
			status: "published",
			bindingId: "gross-sales",
			activeVersion: "1.0.0",
		});
		expect(registry.getVersion("gross-sales", "1.0.0")?.status).toBe("published");
		expect(registry.publish(publishedV2)).toEqual({
			status: "published",
			bindingId: "gross-sales",
			activeVersion: "2.0.0",
			previousVersion: "1.0.0",
		});
		expect(registry.getCurrent("gross-sales")?.version).toBe("2.0.0");
		expect(registry.rollback("gross-sales", "1.0.0")).toEqual({
			status: "rolled_back",
			bindingId: "gross-sales",
			activeVersion: "1.0.0",
			previousVersion: "2.0.0",
		});
		expect(registry.getCurrent("gross-sales")?.version).toBe("1.0.0");
		expect(registry.getVersion("gross-sales", "2.0.0")?.version).toBe("2.0.0");
	});

	test("keeps the current pointer unchanged when publication conflicts", () => {
		const registry = new BindingRegistry();
		const published = publishedBinding();
		registry.publish(published);
		const conflicting = publishedBinding({ ...draftBinding, bindingId: "net-sales" });

		expect(() => registry.publish(conflicting)).toThrow("Binding publication conflicts with an active Binding");
		expect(registry.getCurrent("gross-sales")?.version).toBe("1.0.0");
		expect(registry.getCurrent("net-sales")).toBeUndefined();
		expect(() =>
			registry.register({
				...draftBinding,
				subject: { ...draftBinding.subject, definition: "Different definition." },
			}),
		).toThrow("Binding identity already contains different content");
		expect(() => registry.publish({ ...published, freshness: { ...freshness, status: "expired" } })).toThrow(
			"Expired Binding freshness cannot be published",
		);
	});
});
