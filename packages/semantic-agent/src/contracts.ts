import Type, { type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";

const strictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

const schemaOptions = (id: string) => ({
	$schema: JSON_SCHEMA_DIALECT,
	$id: `https://alphaox.dev/schemas/${id}`,
});

export const CONTEXT_CONTRACT_VERSION = "context.v1" as const;

export const ResourceIdSchema = Type.String({
	minLength: 1,
	maxLength: 128,
	pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
});
export type ResourceId = Static<typeof ResourceIdSchema>;

export const VersionIdSchema = Type.String({
	minLength: 1,
	maxLength: 64,
	pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
});
export type VersionId = Static<typeof VersionIdSchema>;

export const DateTimeSchema = Type.String({ format: "date-time" });
export type DateTime = Static<typeof DateTimeSchema>;

export const SourceTypeSchema = Type.Union([
	Type.Literal("database"),
	Type.Literal("api"),
	Type.Literal("file"),
	Type.Literal("knowledge"),
]);
export type SourceType = Static<typeof SourceTypeSchema>;

export const LifecycleStatusSchema = Type.Union([
	Type.Literal("draft"),
	Type.Literal("in_review"),
	Type.Literal("published"),
	Type.Literal("revoked"),
	Type.Literal("expired"),
	Type.Literal("rolled_back"),
]);
export type LifecycleStatus = Static<typeof LifecycleStatusSchema>;

export const FreshnessStatusSchema = Type.Union([
	Type.Literal("fresh"),
	Type.Literal("stale"),
	Type.Literal("unknown"),
	Type.Literal("expired"),
]);
export type FreshnessStatus = Static<typeof FreshnessStatusSchema>;

export const FreshnessSchema = strictObject({
	asOf: DateTimeSchema,
	checkedAt: DateTimeSchema,
	status: FreshnessStatusSchema,
	maxAgeSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type Freshness = Static<typeof FreshnessSchema>;

export const PermissionRefSchema = strictObject({
	policyId: ResourceIdSchema,
	policyVersion: VersionIdSchema,
});
export type PermissionRef = Static<typeof PermissionRefSchema>;

export const ActorRefSchema = strictObject({
	kind: Type.Union([Type.Literal("agent"), Type.Literal("human"), Type.Literal("system")]),
	id: Type.Optional(ResourceIdSchema),
});
export type ActorRef = Static<typeof ActorRefSchema>;

export const SourceRefSchema = strictObject({
	sourceId: ResourceIdSchema,
	version: VersionIdSchema,
});
export type SourceRef = Static<typeof SourceRefSchema>;

export const ProvenanceSchema = strictObject({
	sources: Type.Array(SourceRefSchema, { minItems: 1 }),
	createdBy: ActorRefSchema,
	createdAt: DateTimeSchema,
});
export type Provenance = Static<typeof ProvenanceSchema>;

export const ResourceRefSchema = strictObject({
	kind: Type.Union([
		Type.Literal("source_connector"),
		Type.Literal("source_snapshot"),
		Type.Literal("source_binding"),
		Type.Literal("context_pack"),
	]),
	id: ResourceIdSchema,
	version: VersionIdSchema,
});
export type ResourceRef = Static<typeof ResourceRefSchema>;

export const ConnectorCapabilitiesSchema = strictObject({
	testConnection: Type.Boolean(),
	discoverSchema: Type.Boolean(),
	readOnlyQuery: Type.Boolean(),
	cancel: Type.Boolean(),
	healthCheck: Type.Boolean(),
});
export type ConnectorCapabilities = Static<typeof ConnectorCapabilitiesSchema>;

export const SourceConnectorSchema = Type.Object(
	{
		contractVersion: Type.Literal(CONTEXT_CONTRACT_VERSION),
		kind: Type.Literal("source_connector"),
		connectorId: ResourceIdSchema,
		sourceId: ResourceIdSchema,
		sourceType: SourceTypeSchema,
		displayName: Type.String({ minLength: 1, maxLength: 200 }),
		capabilities: ConnectorCapabilitiesSchema,
		permission: PermissionRefSchema,
	},
	{ additionalProperties: false, ...schemaOptions("source-connector.schema.json") },
);
export type SourceConnector = Static<typeof SourceConnectorSchema>;

export const SnapshotColumnSchema = strictObject({
	columnId: ResourceIdSchema,
	name: Type.String({ minLength: 1, maxLength: 256 }),
	dataType: Type.String({ minLength: 1, maxLength: 128 }),
	nullable: Type.Boolean(),
	ordinal: Type.Integer({ minimum: 0 }),
});
export type SnapshotColumn = Static<typeof SnapshotColumnSchema>;

export const SnapshotForeignKeySchema = strictObject({
	constraintId: ResourceIdSchema,
	columns: Type.Array(ResourceIdSchema, { minItems: 1 }),
	referencedTableId: ResourceIdSchema,
	referencedColumns: Type.Array(ResourceIdSchema, { minItems: 1 }),
});
export type SnapshotForeignKey = Static<typeof SnapshotForeignKeySchema>;

export const SnapshotTableSchema = strictObject({
	tableId: ResourceIdSchema,
	name: Type.String({ minLength: 1, maxLength: 256 }),
	columns: Type.Array(SnapshotColumnSchema),
	primaryKey: Type.Optional(Type.Array(ResourceIdSchema, { minItems: 1 })),
	foreignKeys: Type.Array(SnapshotForeignKeySchema),
	rowCount: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type SnapshotTable = Static<typeof SnapshotTableSchema>;

export const SourceSnapshotSchema = Type.Object(
	{
		contractVersion: Type.Literal(CONTEXT_CONTRACT_VERSION),
		kind: Type.Literal("source_snapshot"),
		snapshotId: ResourceIdSchema,
		sourceId: ResourceIdSchema,
		version: VersionIdSchema,
		discoveredAt: DateTimeSchema,
		freshness: FreshnessSchema,
		dialect: Type.String({ minLength: 1, maxLength: 128 }),
		structureFingerprint: Type.String({ minLength: 1, maxLength: 256 }),
		tables: Type.Array(SnapshotTableSchema),
	},
	{ additionalProperties: false, ...schemaOptions("source-snapshot.schema.json") },
);
export type SourceSnapshot = Static<typeof SourceSnapshotSchema>;

export const BindingSubjectSchema = strictObject({
	subjectId: ResourceIdSchema,
	kind: Type.Union([
		Type.Literal("metric"),
		Type.Literal("dimension"),
		Type.Literal("entity"),
		Type.Literal("relationship"),
		Type.Literal("term"),
	]),
	label: Type.String({ minLength: 1, maxLength: 200 }),
	definition: Type.String({ minLength: 1 }),
});
export type BindingSubject = Static<typeof BindingSubjectSchema>;

export const BindingTargetSchema = strictObject({
	tableId: ResourceIdSchema,
	columnIds: Type.Array(ResourceIdSchema),
	relationshipPath: Type.Optional(Type.Array(ResourceIdSchema)),
});
export type BindingTarget = Static<typeof BindingTargetSchema>;

export const BindingTimeSemanticsSchema = strictObject({
	columnId: ResourceIdSchema,
	timezone: Type.String({ minLength: 1, maxLength: 128 }),
	boundary: Type.Union([Type.Literal("closed"), Type.Literal("open"), Type.Literal("half_open")]),
});
export type BindingTimeSemantics = Static<typeof BindingTimeSemanticsSchema>;

export const BindingApprovalSchema = strictObject({
	reviewerId: ResourceIdSchema,
	reviewedAt: DateTimeSchema,
	decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected"), Type.Literal("revoked")]),
	note: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type BindingApproval = Static<typeof BindingApprovalSchema>;

export const SourceBindingSchema = Type.Object(
	{
		contractVersion: Type.Literal(CONTEXT_CONTRACT_VERSION),
		kind: Type.Literal("source_binding"),
		bindingId: ResourceIdSchema,
		version: VersionIdSchema,
		sourceSnapshotId: ResourceIdSchema,
		subject: BindingSubjectSchema,
		targets: Type.Array(BindingTargetSchema, { minItems: 1 }),
		grain: Type.String({ minLength: 1, maxLength: 500 }),
		timeSemantics: Type.Optional(BindingTimeSemanticsSchema),
		status: LifecycleStatusSchema,
		permission: PermissionRefSchema,
		provenance: ProvenanceSchema,
		freshness: FreshnessSchema,
		approval: Type.Optional(BindingApprovalSchema),
	},
	{ additionalProperties: false, ...schemaOptions("source-binding.schema.json") },
);
export type SourceBinding = Static<typeof SourceBindingSchema>;

export const ContentRefSchema = strictObject({
	uri: Type.String({ minLength: 1, maxLength: 2048 }),
	digest: Type.String({ minLength: 1, maxLength: 256 }),
	mediaType: Type.String({ minLength: 1, maxLength: 128 }),
});
export type ContentRef = Static<typeof ContentRefSchema>;

export const TermResourceSchema = strictObject({
	resourceId: ResourceIdSchema,
	type: Type.Literal("term"),
	label: Type.String({ minLength: 1, maxLength: 200 }),
	definition: Type.String({ minLength: 1 }),
	aliases: Type.Array(Type.String({ minLength: 1, maxLength: 200 })),
	sources: Type.Array(SourceRefSchema, { minItems: 1 }),
});
export type TermResource = Static<typeof TermResourceSchema>;

export const DocumentResourceSchema = strictObject({
	resourceId: ResourceIdSchema,
	type: Type.Literal("document"),
	title: Type.String({ minLength: 1, maxLength: 300 }),
	content: ContentRefSchema,
	sources: Type.Array(SourceRefSchema, { minItems: 1 }),
});
export type DocumentResource = Static<typeof DocumentResourceSchema>;

export const DataDictionaryResourceSchema = strictObject({
	resourceId: ResourceIdSchema,
	type: Type.Literal("data_dictionary"),
	physicalName: Type.String({ minLength: 1, maxLength: 256 }),
	description: Type.String({ minLength: 1 }),
	dataType: Type.String({ minLength: 1, maxLength: 128 }),
	source: SourceRefSchema,
	termIds: Type.Array(ResourceIdSchema),
});
export type DataDictionaryResource = Static<typeof DataDictionaryResourceSchema>;

export const ContextResourceSchema = Type.Union([
	TermResourceSchema,
	DocumentResourceSchema,
	DataDictionaryResourceSchema,
]);
export type ContextResource = Static<typeof ContextResourceSchema>;

export const ContextPackSchema = Type.Object(
	{
		contractVersion: Type.Literal(CONTEXT_CONTRACT_VERSION),
		kind: Type.Literal("context_pack"),
		packId: ResourceIdSchema,
		version: VersionIdSchema,
		name: Type.String({ minLength: 1, maxLength: 200 }),
		status: LifecycleStatusSchema,
		sources: Type.Array(SourceRefSchema, { minItems: 1 }),
		bindings: Type.Array(ResourceRefSchema),
		resources: Type.Array(ContextResourceSchema),
		permissions: Type.Array(PermissionRefSchema),
		provenance: ProvenanceSchema,
		freshness: FreshnessSchema,
		effectiveFrom: DateTimeSchema,
		effectiveTo: Type.Optional(DateTimeSchema),
	},
	{ additionalProperties: false, ...schemaOptions("context-pack.schema.json") },
);
export type ContextPack = Static<typeof ContextPackSchema>;

export class ContextContractValidationError extends Error {
	constructor(contractKind: string) {
		super(`Invalid ${contractKind} context contract`);
		this.name = "ContextContractValidationError";
	}
}

export function isContract<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
): value is Static<TSchemaType> {
	return Check(schema, value);
}

export function assertContract<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	contractKind: string,
): Static<TSchemaType> {
	if (!Check(schema, value)) {
		throw new ContextContractValidationError(contractKind);
	}
	return value as Static<TSchemaType>;
}

export function parseSourceConnector(value: unknown): SourceConnector {
	return assertContract(SourceConnectorSchema, value, "SourceConnector");
}

export function parseSourceSnapshot(value: unknown): SourceSnapshot {
	return assertContract(SourceSnapshotSchema, value, "SourceSnapshot");
}

export function parseSourceBinding(value: unknown): SourceBinding {
	return assertContract(SourceBindingSchema, value, "SourceBinding");
}

export function parseContextPack(value: unknown): ContextPack {
	return assertContract(ContextPackSchema, value, "ContextPack");
}
