/**
 * Code quality over IPC (Milestone 7).
 *
 * Sits beside the research, graphify and agents bridges. Scans are SLOW by
 * nature — knip took 7.2s and madge 5.1s on this repository — so the scan call
 * is explicitly separate from reading a stored report. A view that scanned on
 * open would take twelve seconds to show anything.
 */

import type {
	QualityOverview,
	QualityReport,
	QualityTrend,
} from "@inspector-hook/protocol";

export interface QualityRpc {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
}

/** Every project that could be scanned, with its last result if any. */
export async function getQualityProjects(
	rpc: QualityRpc,
): Promise<QualityOverview> {
	return rpc.sendRequest<QualityOverview>("quality.getProjects", {});
}

/**
 * Scan one project now. Expect to wait tens of seconds.
 *
 * The result is persisted by the core, so a caller does not need to store it.
 */
export async function scanQuality(
	rpc: QualityRpc,
	root: string,
	buildGraph = false,
): Promise<QualityReport> {
	return rpc.sendRequest<QualityReport>("quality.scan", { root, buildGraph });
}

/** The newest stored report, without rescanning. */
export async function getQualityReport(
	rpc: QualityRpc,
	root: string,
): Promise<QualityReport | null> {
	return rpc.sendRequest<QualityReport | null>("quality.getReport", { root });
}

/** Counts over time. Only scans measured by the same tools are compared. */
export async function getQualityTrend(
	rpc: QualityRpc,
	root: string,
): Promise<QualityTrend> {
	return rpc.sendRequest<QualityTrend>("quality.getTrend", { root });
}
