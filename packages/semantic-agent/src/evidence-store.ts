import Type, { type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { DateTimeSchema, isContract, ResourceIdSchema, VersionIdSchema } from "./contracts.ts";
import { type EvidenceEnvelope, EvidenceEnvelopeSchema, normalizeEvidenceEnvelope } from "./evidence.ts";

export const STORED_EVIDENCE_CONTRACT_VERSION = "evidence-record.v1" as const;

const schemaOptions = (id: string) => ({
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://alphaox.dev/schemas/${id}`,
});

export const StoredEvidenceSchema = Type.Object(
	{
		contractVersion: Type.Literal(STORED_EVIDENCE_CONTRACT_VERSION),
		kind: Type.Literal("stored_evidence"),
		evidence: EvidenceEnvelopeSchema,
		ownerId: ResourceIdSchema,
		workspaceId: ResourceIdSchema,
		traceId: ResourceIdSchema,
		recordedAt: DateTimeSchema,
	},
	{ additionalProperties: false, ...schemaOptions("stored-evidence.schema.json") },
);
export type StoredEvidence = Static<typeof StoredEvidenceSchema>;

export type EvidenceStoreErrorCode =
	| "invalid_evidence"
	| "invalid_scope"
	| "invalid_time"
	| "not_found"
	| "owner_mismatch"
	| "workspace_mismatch"
	| "evidence_conflict"
	| "trace_mismatch"
	| "store_failed";

export class EvidenceStoreError extends Error {
	readonly code: EvidenceStoreErrorCode;

	constructor(code: EvidenceStoreErrorCode, message: string = code) {
		super(message);
		this.name = "EvidenceStoreError";
		this.code = code;
	}
}

export interface EvidenceStoreScope {
	readonly ownerId: string;
	readonly workspaceId: string;
}

export interface EvidenceStoreLookup extends EvidenceStoreScope {
	readonly runId: string;
	readonly evidenceId: string;
	readonly evidenceVersion?: string;
}

export interface EvidenceStoreOptions {
	readonly failAfterWrites?: number;
}

function assertSchema<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	message: string,
): Static<TSchemaType> {
	if (!Check(schema, value)) throw new EvidenceStoreError("invalid_evidence", message);
	return value as Static<TSchemaType>;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function cloneEvidence(value: EvidenceEnvelope): EvidenceEnvelope {
	return {
		...value,
		planRef: { ...value.planRef },
		result: { ...value.result },
		contextPack: { ...value.contextPack },
		lineage: {
			source: { ...value.lineage.source },
			snapshot: { ...value.lineage.snapshot },
			binding: { ...value.lineage.binding },
			executionSpec: { ...value.lineage.executionSpec },
		},
		freshness: { ...value.freshness },
		...(value.query === undefined
			? {}
			: {
					query: {
						...value.query,
						parameterSummary: value.query.parameterSummary.map((parameter) => ({ ...parameter })),
					},
				}),
		policyDecisions: value.policyDecisions.map((decision) => ({
			permission: { ...decision.permission },
			resource: { ...decision.resource },
			decision: decision.decision,
		})),
		observations: value.observations.map((observation) => ({ ...observation })),
		transformations: value.transformations.map((transformation) => ({ ...transformation })),
		upstreamResultRefs: value.upstreamResultRefs.map((reference) => ({ ...reference })),
		warnings: [...value.warnings],
		errors: value.errors.map((error) => ({ ...error })),
		integrity: { ...value.integrity },
	};
}

function cloneStoredEvidence(value: StoredEvidence): StoredEvidence {
	return {
		contractVersion: value.contractVersion,
		kind: "stored_evidence",
		evidence: cloneEvidence(value.evidence),
		ownerId: value.ownerId,
		workspaceId: value.workspaceId,
		traceId: value.traceId,
		recordedAt: value.recordedAt,
	};
}

function normalizeScope(value: EvidenceStoreScope): EvidenceStoreScope {
	if (!isContract(ResourceIdSchema, value.ownerId) || !isContract(ResourceIdSchema, value.workspaceId)) {
		throw new EvidenceStoreError("invalid_scope", "Invalid Evidence store scope");
	}
	return { ownerId: value.ownerId, workspaceId: value.workspaceId };
}

function normalizeRecordedAt(value: string): string {
	if (!isContract(DateTimeSchema, value) || !Number.isFinite(Date.parse(value))) {
		throw new EvidenceStoreError("invalid_time", "Invalid Evidence recording time");
	}
	return value;
}

function evidenceIdentity(value: Pick<StoredEvidence, "evidence">): string {
	return `${value.evidence.runId}\u0000${value.evidence.evidenceId}\u0000${value.evidence.evidenceVersion}`;
}

function scopedIdentity(value: StoredEvidence): string {
	return `${value.ownerId}\u0000${value.workspaceId}\u0000${evidenceIdentity(value)}`;
}

function normalizeStoredEvidence(value: unknown): StoredEvidence {
	const parsed = assertSchema(StoredEvidenceSchema, value, "Invalid Stored Evidence contract");
	let evidence: EvidenceEnvelope;
	try {
		evidence = normalizeEvidenceEnvelope(parsed.evidence);
	} catch {
		throw new EvidenceStoreError("invalid_evidence", "Invalid Evidence envelope");
	}
	if (!isContract(ResourceIdSchema, parsed.ownerId) || !isContract(ResourceIdSchema, parsed.workspaceId)) {
		throw new EvidenceStoreError("invalid_scope", "Invalid Evidence store scope");
	}
	if (!isContract(ResourceIdSchema, parsed.traceId))
		throw new EvidenceStoreError("invalid_scope", "Invalid Evidence trace reference");
	const recordedAt = normalizeRecordedAt(parsed.recordedAt);
	return {
		contractVersion: STORED_EVIDENCE_CONTRACT_VERSION,
		kind: "stored_evidence",
		evidence,
		ownerId: parsed.ownerId,
		workspaceId: parsed.workspaceId,
		traceId: parsed.traceId,
		recordedAt,
	};
}

export interface EvidenceStore {
	put(value: unknown): StoredEvidence;
	get(request: EvidenceStoreLookup): StoredEvidence;
	list(scope: EvidenceStoreScope): readonly StoredEvidence[];
}

export class InMemoryEvidenceStore implements EvidenceStore {
	private readonly records = new Map<string, StoredEvidence>();

	private readonly failAfterWrites: number | undefined;

	private writeAttempts = 0;

	constructor(options: EvidenceStoreOptions = {}) {
		if (
			options.failAfterWrites !== undefined &&
			(!Number.isSafeInteger(options.failAfterWrites) || options.failAfterWrites < 0)
		) {
			throw new EvidenceStoreError("invalid_scope", "Invalid Evidence store failure configuration");
		}
		this.failAfterWrites = options.failAfterWrites;
	}

	get attemptedWrites(): number {
		return this.writeAttempts;
	}

	put(value: unknown): StoredEvidence {
		const record = normalizeStoredEvidence(value);
		const identity = evidenceIdentity(record);
		for (const existing of this.records.values()) {
			if (evidenceIdentity(existing) !== identity) continue;
			if (existing.ownerId !== record.ownerId)
				throw new EvidenceStoreError("owner_mismatch", "Evidence owner mismatch");
			if (existing.workspaceId !== record.workspaceId)
				throw new EvidenceStoreError("workspace_mismatch", "Evidence workspace mismatch");
			if (existing.traceId !== record.traceId)
				throw new EvidenceStoreError("trace_mismatch", "Evidence trace mismatch");
			if (JSON.stringify(existing) !== JSON.stringify(record)) {
				throw new EvidenceStoreError("evidence_conflict", "Evidence identity already contains different content");
			}
			return cloneStoredEvidence(existing);
		}
		if (this.failAfterWrites !== undefined && this.writeAttempts >= this.failAfterWrites) {
			throw new EvidenceStoreError("store_failed", "Evidence store write failed");
		}
		this.writeAttempts += 1;
		this.records.set(scopedIdentity(record), cloneStoredEvidence(record));
		return cloneStoredEvidence(record);
	}

	get(request: EvidenceStoreLookup): StoredEvidence {
		const scope = normalizeScope(request);
		if (!isContract(ResourceIdSchema, request.runId) || !isContract(ResourceIdSchema, request.evidenceId)) {
			throw new EvidenceStoreError("invalid_scope", "Invalid Evidence lookup");
		}
		if (request.evidenceVersion !== undefined && !isContract(VersionIdSchema, request.evidenceVersion)) {
			throw new EvidenceStoreError("invalid_scope", "Invalid Evidence version");
		}
		const matching = [...this.records.values()].filter(
			(record) =>
				record.evidence.runId === request.runId &&
				record.evidence.evidenceId === request.evidenceId &&
				(request.evidenceVersion === undefined || record.evidence.evidenceVersion === request.evidenceVersion),
		);
		if (matching.length === 0) throw new EvidenceStoreError("not_found", "Evidence not found");
		const first = matching[0];
		if (first === undefined) throw new EvidenceStoreError("not_found", "Evidence not found");
		if (first.ownerId !== scope.ownerId) throw new EvidenceStoreError("owner_mismatch", "Evidence owner mismatch");
		if (first.workspaceId !== scope.workspaceId)
			throw new EvidenceStoreError("workspace_mismatch", "Evidence workspace mismatch");
		return cloneStoredEvidence(first);
	}

	list(scopeValue: EvidenceStoreScope): readonly StoredEvidence[] {
		const scope = normalizeScope(scopeValue);
		return [...this.records.values()]
			.filter((record) => record.ownerId === scope.ownerId && record.workspaceId === scope.workspaceId)
			.sort((left, right) => compareStrings(scopedIdentity(left), scopedIdentity(right)))
			.map(cloneStoredEvidence);
	}
}
