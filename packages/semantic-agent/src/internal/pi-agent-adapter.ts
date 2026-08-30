import type { Agent } from "@earendil-works/pi-agent-core";
import type { PiRuntimeAdapter, PiRuntimeAdapterAttachment } from "../pi-adapter.ts";

/**
 * Internal-only bridge for the current Pi Agent implementation.
 * This file is intentionally not exported from the AlphaOx public index.
 */
export function attachPiAgent(adapter: PiRuntimeAdapter, agent: Agent): PiRuntimeAdapterAttachment {
	return adapter.attach(agent);
}
