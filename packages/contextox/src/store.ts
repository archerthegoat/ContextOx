import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MissionStatus = "active" | "waiting_for_human" | "completed" | "blocked" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested" | "invalidated";
export type ApprovalOutcome = "approve" | "reject" | "request_changes";
export type ResumeDeliveryStatus = "none" | "pending" | "dispatched";

export interface ProposalSnapshot {
	goal: string;
	title: string;
	scope: string;
	rules: string[];
	evidenceRefs: string[];
	unknowns: string[];
	exceptions: string[];
	examples: string[];
	counterexamples: string[];
	impactSummary: string;
}

export interface CreateApprovalInput extends ProposalSnapshot {
	missionId: string;
	proposalVersion: number;
	requiredApprover: string;
	sessionId: string;
}

export interface MissionRecord {
	id: string;
	goal: string;
	scope: string;
	status: MissionStatus;
	currentProposalVersion: number;
	sessionId: string;
	resumeDelivery: ResumeDeliveryStatus;
	resumeRequestId?: string;
	resumeError?: string;
	resumeUpdatedAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ApprovalRequestRecord {
	id: string;
	missionId: string;
	proposalVersion: number;
	proposalHash: string;
	snapshot: ProposalSnapshot;
	requiredApprover: string;
	status: ApprovalStatus;
	createdAt: string;
	decidedAt?: string;
}

export interface DecisionRecord {
	id: string;
	requestId: string;
	expectedProposalVersion: number;
	expectedProposalHash: string;
	actor: string;
	outcome: ApprovalOutcome;
	reason: string;
	decidedAt: string;
}

export interface ContractVersionRecord {
	id: string;
	missionId: string;
	version: number;
	snapshot: ProposalSnapshot;
	decisionId: string;
	sourceRequestId: string;
	proposalHash: string;
	approvedBy: string;
	approvedAt: string;
	createdAt: string;
}

export interface DecideApprovalInput {
	requestId: string;
	expectedProposalVersion: number;
	expectedProposalHash: string;
	actor: string;
	outcome: ApprovalOutcome;
	reason?: string;
}

export interface CreateApprovalResult {
	request: ApprovalRequestRecord;
	mission: MissionRecord;
	created: boolean;
}

export interface DecisionResult {
	request: ApprovalRequestRecord;
	decision: DecisionRecord;
	mission: MissionRecord;
	contract?: ContractVersionRecord;
	replayed: boolean;
}

export interface ResumeDeliveryResult {
	mission: MissionRecord;
	changed: boolean;
}

interface MissionRow {
	id: string;
	goal: string;
	scope: string;
	status: MissionStatus;
	current_proposal_version: number;
	session_id: string;
	resume_delivery: ResumeDeliveryStatus;
	resume_request_id: string | null;
	resume_error: string | null;
	resume_updated_at: string | null;
	created_at: string;
	updated_at: string;
}

interface ApprovalRequestRow {
	id: string;
	mission_id: string;
	proposal_version: number;
	proposal_hash: string;
	snapshot_json: string;
	required_approver: string;
	status: ApprovalStatus;
	created_at: string;
	decided_at: string | null;
}

interface DecisionRow {
	id: string;
	request_id: string;
	expected_proposal_version: number;
	expected_proposal_hash: string;
	actor: string;
	outcome: ApprovalOutcome;
	reason: string;
	decided_at: string;
}

interface ContractVersionRow {
	id: string;
	mission_id: string;
	version: number;
	snapshot_json: string;
	decision_id: string;
	source_request_id: string;
	proposal_hash: string;
	approved_by: string;
	approved_at: string;
	created_at: string;
}

function requiredText(value: string, label: string): string {
	const normalized = value.trim();
	if (normalized.length === 0) throw new Error(`${label} must not be empty`);
	return normalized;
}

function textList(values: readonly string[], label: string, minimumItems: number): string[] {
	if (values.length < minimumItems) throw new Error(`${label} must contain at least ${minimumItems} item(s)`);
	const normalized = values.map((value, index) => requiredText(value, `${label}[${index}]`));
	if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
	return normalized;
}

function normalizeSnapshot(value: ProposalSnapshot): ProposalSnapshot {
	return {
		goal: requiredText(value.goal, "goal"),
		title: requiredText(value.title, "title"),
		scope: requiredText(value.scope, "scope"),
		rules: textList(value.rules, "rules", 1),
		evidenceRefs: textList(value.evidenceRefs, "evidenceRefs", 1),
		unknowns: textList(value.unknowns, "unknowns", 0),
		exceptions: textList(value.exceptions, "exceptions", 0),
		examples: textList(value.examples, "examples", 1),
		counterexamples: textList(value.counterexamples, "counterexamples", 1),
		impactSummary: requiredText(value.impactSummary, "impactSummary"),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`ContextOx state is corrupt: ${label} must be a string`);
	return value;
}

function readStringList(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) throw new Error(`ContextOx state is corrupt: ${label} must be an array`);
	return value.map((item, index) => readString(item, `${label}[${index}]`));
}

function parseSnapshot(serialized: string): ProposalSnapshot {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error("ContextOx state is corrupt: proposal snapshot is not valid JSON");
	}
	if (!isRecord(value)) throw new Error("ContextOx state is corrupt: proposal snapshot must be an object");
	return normalizeSnapshot({
		goal: readString(value.goal, "goal"),
		title: readString(value.title, "title"),
		scope: readString(value.scope, "scope"),
		rules: readStringList(value.rules, "rules"),
		evidenceRefs: readStringList(value.evidenceRefs, "evidenceRefs"),
		unknowns: readStringList(value.unknowns, "unknowns"),
		exceptions: readStringList(value.exceptions, "exceptions"),
		examples: readStringList(value.examples, "examples"),
		counterexamples: readStringList(value.counterexamples, "counterexamples"),
		impactSummary: readString(value.impactSummary, "impactSummary"),
	});
}

export function hashProposal(snapshot: ProposalSnapshot): string {
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(normalizeSnapshot(snapshot)))
		.digest("hex")}`;
}

function missionFromRow(row: MissionRow): MissionRecord {
	return {
		id: row.id,
		goal: row.goal,
		scope: row.scope,
		status: row.status,
		currentProposalVersion: row.current_proposal_version,
		sessionId: row.session_id,
		resumeDelivery: row.resume_delivery,
		...(row.resume_request_id === null ? {} : { resumeRequestId: row.resume_request_id }),
		...(row.resume_error === null ? {} : { resumeError: row.resume_error }),
		...(row.resume_updated_at === null ? {} : { resumeUpdatedAt: row.resume_updated_at }),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function requestFromRow(row: ApprovalRequestRow): ApprovalRequestRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		proposalVersion: row.proposal_version,
		proposalHash: row.proposal_hash,
		snapshot: parseSnapshot(row.snapshot_json),
		requiredApprover: row.required_approver,
		status: row.status,
		createdAt: row.created_at,
		...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
	};
}

function decisionFromRow(row: DecisionRow): DecisionRecord {
	return {
		id: row.id,
		requestId: row.request_id,
		expectedProposalVersion: row.expected_proposal_version,
		expectedProposalHash: row.expected_proposal_hash,
		actor: row.actor,
		outcome: row.outcome,
		reason: row.reason,
		decidedAt: row.decided_at,
	};
}

function contractFromRow(row: ContractVersionRow): ContractVersionRecord {
	return {
		id: row.id,
		missionId: row.mission_id,
		version: row.version,
		snapshot: parseSnapshot(row.snapshot_json),
		decisionId: row.decision_id,
		sourceRequestId: row.source_request_id,
		proposalHash: row.proposal_hash,
		approvedBy: row.approved_by,
		approvedAt: row.approved_at,
		createdAt: row.created_at,
	};
}

export class ContextOxStore {
	private readonly db: DatabaseSync;

	constructor(databasePath: string) {
		if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
		this.db = new DatabaseSync(databasePath);
		this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
		this.initialize();
	}

	close(): void {
		this.db.close();
	}

	createApproval(input: CreateApprovalInput): CreateApprovalResult {
		const missionId = requiredText(input.missionId, "missionId");
		const requiredApprover = requiredText(input.requiredApprover, "requiredApprover");
		const sessionId = requiredText(input.sessionId, "sessionId");
		if (!Number.isSafeInteger(input.proposalVersion) || input.proposalVersion < 1) {
			throw new Error("proposalVersion must be a positive safe integer");
		}
		const snapshot = normalizeSnapshot(input);
		const proposalHash = hashProposal(snapshot);
		const snapshotJson = JSON.stringify(snapshot);

		return this.transaction(() => {
			const existingRow = this.db
				.prepare("SELECT * FROM approval_requests WHERE mission_id = ? AND proposal_version = ?")
				.get(missionId, input.proposalVersion) as ApprovalRequestRow | undefined;
			if (existingRow) {
				const existing = requestFromRow(existingRow);
				if (
					existing.status === "pending" &&
					existing.proposalHash === proposalHash &&
					existing.requiredApprover === requiredApprover
				) {
					const mission = this.getMission(missionId);
					if (!mission) throw new Error("Mission disappeared while replaying approval creation");
					return { request: existing, mission, created: false };
				}
				throw new Error("proposalVersion already exists with different or closed approval content");
			}

			const mission = this.getMission(missionId);
			if (!mission && input.proposalVersion !== 1) {
				throw new Error("the first proposalVersion for a Mission must be 1");
			}
			if (mission && ["completed", "blocked", "cancelled"].includes(mission.status)) {
				throw new Error(`Mission ${missionId} is ${mission.status} and cannot accept another approval request`);
			}
			if (mission && input.proposalVersion <= mission.currentProposalVersion) {
				throw new Error("proposalVersion must advance the Mission's current proposal version");
			}

			const now = new Date().toISOString();
			if (!mission) {
				this.db
					.prepare(
						"INSERT INTO missions (id, goal, scope, status, current_proposal_version, session_id, created_at, updated_at) VALUES (?, ?, ?, 'active', 0, ?, ?, ?)",
					)
					.run(missionId, snapshot.goal, snapshot.scope, sessionId, now, now);
			}

			this.db
				.prepare(
					"UPDATE approval_requests SET status = 'invalidated', decided_at = ? WHERE mission_id = ? AND status = 'pending'",
				)
				.run(now, missionId);

			const requestId = `approval-${randomUUID()}`;
			this.db
				.prepare(
					"INSERT INTO approval_requests (id, mission_id, proposal_version, proposal_hash, snapshot_json, required_approver, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
				)
				.run(requestId, missionId, input.proposalVersion, proposalHash, snapshotJson, requiredApprover, now);
			this.db
				.prepare(
					"UPDATE missions SET goal = ?, scope = ?, status = 'waiting_for_human', current_proposal_version = ?, session_id = ?, updated_at = ? WHERE id = ?",
				)
				.run(snapshot.goal, snapshot.scope, input.proposalVersion, sessionId, now, missionId);

			const request = this.getRequest(requestId);
			const updatedMission = this.getMission(missionId);
			if (!request || !updatedMission) throw new Error("approval request was not readable after persistence");
			return { request, mission: updatedMission, created: true };
		});
	}

	decide(input: DecideApprovalInput): DecisionResult {
		const requestId = requiredText(input.requestId, "requestId");
		const actor = requiredText(input.actor, "actor");
		const expectedProposalHash = requiredText(input.expectedProposalHash, "expectedProposalHash");
		if (!Number.isSafeInteger(input.expectedProposalVersion) || input.expectedProposalVersion < 1) {
			throw new Error("expectedProposalVersion must be a positive safe integer");
		}
		const reason = input.reason?.trim() ?? "";
		if (input.outcome !== "approve" && reason.length === 0) {
			throw new Error("reject and request_changes decisions require a reason");
		}

		return this.transaction(() => {
			const request = this.getRequest(requestId);
			if (!request) throw new Error(`approval request ${requestId} does not exist`);

			const existingDecisionRow = this.db.prepare("SELECT * FROM decisions WHERE request_id = ?").get(requestId) as
				| DecisionRow
				| undefined;
			if (existingDecisionRow) {
				const decision = decisionFromRow(existingDecisionRow);
				if (
					decision.expectedProposalVersion !== input.expectedProposalVersion ||
					decision.expectedProposalHash !== expectedProposalHash ||
					decision.actor !== actor ||
					decision.outcome !== input.outcome ||
					decision.reason !== reason
				) {
					throw new Error("approval request already has a conflicting decision");
				}
				const mission = this.getMission(request.missionId);
				if (!mission) throw new Error("Mission disappeared after its decision");
				const contract = this.getContractForDecision(decision.id);
				return {
					request,
					decision,
					mission,
					...(contract === undefined ? {} : { contract }),
					replayed: true,
				};
			}

			if (request.status !== "pending") throw new Error(`approval request is ${request.status}, not pending`);
			if (request.requiredApprover !== actor) throw new Error("actor is not the required approver");
			if (request.proposalVersion !== input.expectedProposalVersion) {
				throw new Error("proposal version does not match the pending approval request");
			}
			if (request.proposalHash !== expectedProposalHash) {
				throw new Error("proposal hash does not match the pending approval request");
			}

			const decidedAt = new Date().toISOString();
			const decisionId = `decision-${randomUUID()}`;
			this.db
				.prepare(
					"INSERT INTO decisions (id, request_id, expected_proposal_version, expected_proposal_hash, actor, outcome, reason, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				)
				.run(
					decisionId,
					requestId,
					input.expectedProposalVersion,
					expectedProposalHash,
					actor,
					input.outcome,
					reason,
					decidedAt,
				);

			const requestStatus =
				input.outcome === "approve" ? "approved" : input.outcome === "reject" ? "rejected" : "changes_requested";
			this.db
				.prepare("UPDATE approval_requests SET status = ?, decided_at = ? WHERE id = ?")
				.run(requestStatus, decidedAt, requestId);

			let contract: ContractVersionRecord | undefined;
			if (input.outcome === "approve") {
				const contractId = `contract-${randomUUID()}`;
				this.db
					.prepare(
						"INSERT INTO contract_versions (id, mission_id, version, snapshot_json, decision_id, created_at) VALUES (?, ?, 1, ?, ?, ?)",
					)
					.run(contractId, request.missionId, JSON.stringify(request.snapshot), decisionId, decidedAt);
				contract = this.getContractForDecision(decisionId);
				if (!contract) throw new Error("Contract v1 was not readable after approval");
			}

			const missionStatus: MissionStatus =
				input.outcome === "approve" ? "completed" : input.outcome === "reject" ? "blocked" : "active";
			const resumeDelivery: ResumeDeliveryStatus = input.outcome === "reject" ? "none" : "pending";
			this.db
				.prepare(
					"UPDATE missions SET status = ?, resume_delivery = ?, resume_request_id = ?, resume_error = NULL, resume_updated_at = ?, updated_at = ? WHERE id = ?",
				)
				.run(
					missionStatus,
					resumeDelivery,
					input.outcome === "reject" ? null : requestId,
					input.outcome === "reject" ? null : decidedAt,
					decidedAt,
					request.missionId,
				);

			const decisionRow = this.db.prepare("SELECT * FROM decisions WHERE id = ?").get(decisionId) as
				| DecisionRow
				| undefined;
			const updatedRequest = this.getRequest(requestId);
			const mission = this.getMission(request.missionId);
			if (!decisionRow || !updatedRequest || !mission)
				throw new Error("decision was not readable after persistence");
			return {
				request: updatedRequest,
				decision: decisionFromRow(decisionRow),
				mission,
				...(contract === undefined ? {} : { contract }),
				replayed: false,
			};
		});
	}

	getMission(missionId: string): MissionRecord | undefined {
		const row = this.db.prepare("SELECT * FROM missions WHERE id = ?").get(missionId) as MissionRow | undefined;
		return row ? missionFromRow(row) : undefined;
	}

	getRequest(requestId: string): ApprovalRequestRecord | undefined {
		const row = this.db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(requestId) as
			| ApprovalRequestRow
			| undefined;
		return row ? requestFromRow(row) : undefined;
	}

	getDecisionResult(requestId: string): DecisionResult | undefined {
		const request = this.getRequest(requestId);
		if (!request) return undefined;
		const decisionRow = this.db.prepare("SELECT * FROM decisions WHERE request_id = ?").get(requestId) as
			| DecisionRow
			| undefined;
		if (!decisionRow) return undefined;
		const decision = decisionFromRow(decisionRow);
		const mission = this.getMission(request.missionId);
		if (!mission) throw new Error("ContextOx state is corrupt: decision Mission does not exist");
		const contract = this.getContractForDecision(decision.id);
		return {
			request,
			decision,
			mission,
			...(contract === undefined ? {} : { contract }),
			replayed: true,
		};
	}

	listPending(): ApprovalRequestRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY created_at, id")
			.all() as unknown as ApprovalRequestRow[];
		return rows.map(requestFromRow);
	}

	listPendingResumeDeliveries(): MissionRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM missions WHERE resume_delivery = 'pending' ORDER BY resume_updated_at, id")
			.all() as unknown as MissionRow[];
		return rows.map(missionFromRow);
	}

	getResumeDelivery(requestId: string): MissionRecord | undefined {
		const row = this.db.prepare("SELECT * FROM missions WHERE resume_request_id = ?").get(requestId) as
			| MissionRow
			| undefined;
		return row ? missionFromRow(row) : undefined;
	}

	markResumeFailed(requestId: string, error: string): ResumeDeliveryResult {
		const normalizedRequestId = requiredText(requestId, "requestId");
		if (error.length === 0) throw new Error("resume error must not be empty");
		return this.transaction(() => {
			const mission = this.getResumeDelivery(normalizedRequestId);
			if (!mission) throw new Error(`no resume delivery exists for approval request ${normalizedRequestId}`);
			if (mission.resumeDelivery === "dispatched") return { mission, changed: false };
			if (mission.resumeDelivery !== "pending") throw new Error("resume delivery is not pending");
			const now = new Date().toISOString();
			this.db
				.prepare(
					"UPDATE missions SET resume_error = ?, resume_updated_at = ?, updated_at = ? WHERE id = ? AND resume_delivery = 'pending' AND resume_request_id = ?",
				)
				.run(error, now, now, mission.id, normalizedRequestId);
			const updated = this.getMission(mission.id);
			if (!updated) throw new Error("Mission disappeared while recording resume failure");
			return { mission: updated, changed: true };
		});
	}

	markResumeDispatched(requestId: string): ResumeDeliveryResult {
		const normalizedRequestId = requiredText(requestId, "requestId");
		return this.transaction(() => {
			const mission = this.getResumeDelivery(normalizedRequestId);
			if (!mission) throw new Error(`no resume delivery exists for approval request ${normalizedRequestId}`);
			if (mission.resumeDelivery === "dispatched") return { mission, changed: false };
			if (mission.resumeDelivery !== "pending") throw new Error("resume delivery is not pending");
			const now = new Date().toISOString();
			this.db
				.prepare(
					"UPDATE missions SET resume_delivery = 'dispatched', resume_error = NULL, resume_updated_at = ?, updated_at = ? WHERE id = ? AND resume_delivery = 'pending' AND resume_request_id = ?",
				)
				.run(now, now, mission.id, normalizedRequestId);
			const updated = this.getMission(mission.id);
			if (!updated) throw new Error("Mission disappeared while marking resume delivery dispatched");
			return { mission: updated, changed: true };
		});
	}

	getContractForMission(missionId: string): ContractVersionRecord | undefined {
		const row = this.db
			.prepare(
				`SELECT contract_versions.*, decisions.request_id AS source_request_id,
					decisions.expected_proposal_hash AS proposal_hash,
					decisions.actor AS approved_by,
					decisions.decided_at AS approved_at
				FROM contract_versions
				JOIN decisions ON decisions.id = contract_versions.decision_id
				WHERE contract_versions.mission_id = ?
				ORDER BY contract_versions.version DESC
				LIMIT 1`,
			)
			.get(missionId) as ContractVersionRow | undefined;
		return row ? contractFromRow(row) : undefined;
	}

	getContractForDecision(decisionId: string): ContractVersionRecord | undefined {
		const row = this.db
			.prepare(
				`SELECT contract_versions.*, decisions.request_id AS source_request_id,
					decisions.expected_proposal_hash AS proposal_hash,
					decisions.actor AS approved_by,
					decisions.decided_at AS approved_at
				FROM contract_versions
				JOIN decisions ON decisions.id = contract_versions.decision_id
				WHERE contract_versions.decision_id = ?
				LIMIT 1`,
			)
			.get(decisionId) as ContractVersionRow | undefined;
		return row ? contractFromRow(row) : undefined;
	}

	private initialize(): void {
		const versionRow = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
		if (versionRow.user_version > 2) {
			throw new Error(`ContextOx database schema ${versionRow.user_version} is newer than supported schema 2`);
		}
		if (versionRow.user_version === 2) return;

		if (versionRow.user_version === 1) {
			this.transaction(() => {
				this.db.exec(`
					ALTER TABLE missions ADD COLUMN resume_delivery TEXT NOT NULL DEFAULT 'none'
						CHECK (resume_delivery IN ('none', 'pending', 'dispatched'));
					ALTER TABLE missions ADD COLUMN resume_request_id TEXT;
					ALTER TABLE missions ADD COLUMN resume_error TEXT;
					ALTER TABLE missions ADD COLUMN resume_updated_at TEXT;
					CREATE INDEX IF NOT EXISTS missions_pending_resume
						ON missions (resume_delivery, resume_updated_at);
					PRAGMA user_version = 2;
				`);
			});
			return;
		}

		this.transaction(() => {
			this.db.exec(`
				CREATE TABLE missions (
					id TEXT PRIMARY KEY,
					goal TEXT NOT NULL,
					scope TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('active', 'waiting_for_human', 'completed', 'blocked', 'cancelled')),
					current_proposal_version INTEGER NOT NULL CHECK (current_proposal_version >= 0),
					session_id TEXT NOT NULL,
					resume_delivery TEXT NOT NULL DEFAULT 'none' CHECK (resume_delivery IN ('none', 'pending', 'dispatched')),
					resume_request_id TEXT,
					resume_error TEXT,
					resume_updated_at TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);

				CREATE TABLE approval_requests (
					id TEXT PRIMARY KEY,
					mission_id TEXT NOT NULL REFERENCES missions(id),
					proposal_version INTEGER NOT NULL CHECK (proposal_version >= 1),
					proposal_hash TEXT NOT NULL,
					snapshot_json TEXT NOT NULL,
					required_approver TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'invalidated')),
					created_at TEXT NOT NULL,
					decided_at TEXT,
					UNIQUE (mission_id, proposal_version)
				);

				CREATE INDEX approval_requests_pending ON approval_requests (status, created_at);
				CREATE INDEX missions_pending_resume ON missions (resume_delivery, resume_updated_at);

				CREATE TABLE decisions (
					id TEXT PRIMARY KEY,
					request_id TEXT NOT NULL UNIQUE REFERENCES approval_requests(id),
					expected_proposal_version INTEGER NOT NULL,
					expected_proposal_hash TEXT NOT NULL,
					actor TEXT NOT NULL,
					outcome TEXT NOT NULL CHECK (outcome IN ('approve', 'reject', 'request_changes')),
					reason TEXT NOT NULL,
					decided_at TEXT NOT NULL
				);

				CREATE TABLE contract_versions (
					id TEXT PRIMARY KEY,
					mission_id TEXT NOT NULL REFERENCES missions(id),
					version INTEGER NOT NULL CHECK (version = 1),
					snapshot_json TEXT NOT NULL,
					decision_id TEXT NOT NULL UNIQUE REFERENCES decisions(id),
					created_at TEXT NOT NULL,
					UNIQUE (mission_id, version)
				);

				PRAGMA user_version = 2;
			`);
		});
	}

	private transaction<T>(run: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = run();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			try {
				this.db.exec("ROLLBACK");
			} catch {
				// Preserve the original failure.
			}
			throw error;
		}
	}
}
