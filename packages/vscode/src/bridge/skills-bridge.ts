/**
 * Skills and MCP tools over IPC (Milestone 8).
 *
 * Sits beside the research, graphify, agents and quality bridges. The overview
 * streams the whole transcript corpus — 121 files, ~1.8s — so the core caches
 * it and `refresh` is an explicit parameter rather than something a view can
 * trigger by accident on every open.
 */

import type { McpProbe, SkillsOverview } from "@inspector-hook/protocol";

export interface SkillsRpc {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
}

/** Archived skills come back with the overview, so one call fills the view. */
export interface SkillsOverviewResponse extends SkillsOverview {
	archived?: {
		id: string;
		originalPath: string;
		archivedPath: string;
		archivedAt: string;
	}[];
	error?: string;
}

/** Everything installed, everything that fired, and the MCP servers. */
export async function getSkillsOverview(
	rpc: SkillsRpc,
	refresh = false,
): Promise<SkillsOverviewResponse> {
	return rpc.sendRequest<SkillsOverviewResponse>("skills.getOverview", {
		refresh,
	});
}

export interface SkillFileResponse {
	id?: string;
	path?: string;
	text?: string;
	bytes?: number;
	truncated?: boolean;
	subdirectories?: string[];
	extraFiles?: number;
	error?: string;
}

/** One skill's SKILL.md, for the detail pane. */
export async function readSkillFile(
	rpc: SkillsRpc,
	id: string,
): Promise<SkillFileResponse> {
	return rpc.sendRequest<SkillFileResponse>("skills.readSkillFile", { id });
}

/**
 * Handshake with the configured MCP servers.
 *
 * Slow and side-effecting: it spawns each server, and one of them starts a
 * browser. Kept out of the overview call for exactly that reason — the
 * overview is a pure read and must stay one.
 */
export async function probeMcpServers(
	rpc: SkillsRpc,
	servers?: string[],
): Promise<{ probes: McpProbe[] }> {
	return rpc.sendRequest<{ probes: McpProbe[] }>("skills.probeServers", {
		...(servers ? { servers } : {}),
	});
}

/** The last probe of each server, without probing again. */
export async function getMcpProbes(
	rpc: SkillsRpc,
): Promise<{ probes: McpProbe[] }> {
	return rpc.sendRequest<{ probes: McpProbe[] }>("skills.getProbes", {});
}

export interface ArchiveResponse {
	ok: boolean;
	error?: string;
	skill?: { id: string; originalPath: string; archivedPath: string };
}

/**
 * Archive a skill, or put one back.
 *
 * Not a toggle: `settings.json` has no skills key, so there is nothing to
 * flip. This moves the directory, which is the only lever that works, and the
 * name says so.
 */
export async function setSkillArchived(
	rpc: SkillsRpc,
	id: string,
	archived: boolean,
): Promise<ArchiveResponse> {
	return rpc.sendRequest<ArchiveResponse>("skills.setArchived", {
		id,
		archived,
	});
}
