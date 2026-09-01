import { ContextOxStore, type DecisionResult, type MissionRecord } from "./store.ts";

export interface ResumeSender {
	sendUserMessage(message: string): Promise<void>;
}

export type ResumeAttempt =
	| { status: "dispatched"; mission: MissionRecord }
	| { status: "already_dispatched"; mission: MissionRecord };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function decisionMessage(result: DecisionResult): string {
	return [
		"ContextOx human decision has been persisted.",
		`mission_id: ${result.request.missionId}`,
		`request_id: ${result.request.id}`,
		`proposal_version: ${result.request.proposalVersion}`,
		`proposal_hash: ${result.request.proposalHash}`,
		`outcome: ${result.decision.outcome}`,
		`decision_id: ${result.decision.id}`,
		...(result.contract
			? [`contract_id: ${result.contract.id}`, `contract_version: ${result.contract.version}`]
			: []),
		...(result.decision.reason ? [`reason: ${result.decision.reason}`] : []),
		"Continue this Mission from the persisted decision. Do not treat a pending request as approval and do not publish externally.",
	].join("\n");
}

export class ContextOxResumeAdapter {
	private readonly databasePath: string;
	private readonly actorId: string;
	private readonly sender: ResumeSender;

	constructor(databasePath: string, actorId: string, sender: ResumeSender) {
		this.databasePath = databasePath;
		this.actorId = actorId;
		this.sender = sender;
	}

	listPending(): MissionRecord[] {
		return this.withStore((store) => store.listPendingResumeDeliveries());
	}

	async deliver(requestId: string): Promise<ResumeAttempt> {
		const result = this.withStore((store) => store.getDecisionResult(requestId));
		if (!result) throw new Error(`approval request ${requestId} has no persisted decision`);
		if (result.decision.outcome === "reject") {
			throw new Error("rejected approval requests must not resume the Agent");
		}
		if (result.decision.actor !== this.actorId) {
			throw new Error("only the actor who made this decision may resume it");
		}

		const delivery = this.withStore((store) => store.getResumeDelivery(requestId));
		if (!delivery) throw new Error(`approval request ${requestId} has no resume delivery state`);
		if (delivery.resumeDelivery === "dispatched") {
			return { status: "already_dispatched", mission: delivery };
		}
		if (delivery.resumeDelivery !== "pending") {
			throw new Error(`approval request ${requestId} resume delivery is ${delivery.resumeDelivery}`);
		}

		try {
			await this.sender.sendUserMessage(decisionMessage(result));
		} catch (error) {
			try {
				this.withStore((store) => store.markResumeFailed(requestId, errorMessage(error)));
			} catch (persistenceError) {
				throw new AggregateError(
					[error, persistenceError],
					`Agent resume failed and its failure could not be persisted for ${requestId}`,
				);
			}
			throw error;
		}

		const marked = this.withStore((store) => store.markResumeDispatched(requestId));
		return { status: marked.changed ? "dispatched" : "already_dispatched", mission: marked.mission };
	}

	private withStore<T>(run: (store: ContextOxStore) => T): T {
		const store = new ContextOxStore(this.databasePath);
		try {
			return run(store);
		} finally {
			store.close();
		}
	}
}
