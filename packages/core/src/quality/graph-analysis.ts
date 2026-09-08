/**
 * Graph analysis for build effectiveness (Milestone 7).
 *
 * M4 used graphify's graph for retrieval. This uses it for the thing a graph is
 * actually good at: telling you where a codebase is coming apart. Every signal
 * here was measured on this repo's real 4095-node / 4922-edge graph before it
 * was written, and the ones that produced noise were left out.
 *
 * ## Why the graph earns its place next to knip
 *
 * Raw `knip` on this repo flags 66 unused files of which **64 are false
 * positives** — the webview's classic scripts, loaded as `<script>` tags from a
 * manifest that knip cannot see because it traces ES-module imports. Graph
 * orphans on the same repo: **9**. After cross-checking the manifest: **2**.
 *
 * More importantly the two tools fail differently, which is what makes them
 * worth combining:
 *
 *   scripts/debug-webview.js       knip flags it, graph says degree 0 — agree
 *   config/.../http_logger.py      knip is BLIND (Python), graph catches it
 *   core/src/persistence/index.ts  knip right, graph WRONG (6 edges, still dead)
 *   media/scripts/api/inbound-*.js both wrong — the manifest loads them
 *
 * So nothing here suppresses a finding on its own. `confidence.ts` owns that,
 * using ground truth. This module reports what the graph sees and no more.
 *
 * ## What each signal is for
 *
 * - **orphans** — degree 0. Dead-code candidates. Note the caveat above: an
 *   orphan is not proof, because a classic script imported by nothing is still
 *   loaded by the manifest.
 * - **god nodes** — highest degree. On this repo the top is
 *   `packages/core/src/index.ts` at 149 edges, which is independently the file
 *   `madge` implicates in the one real circular dependency. Two unrelated
 *   signals pointing at one architectural problem is the strongest evidence
 *   this analysis produces.
 * - **coupling** — cross-community edges over total. 12% here. A single number
 *   per project, worth trending; a jump means module boundaries eroded.
 * - **rot** — nodes whose `source_file` no longer exists on disk. Says a graph
 *   has gone stale in a way the `stale` commit check cannot: `stale` compares
 *   one hash, rot counts how much of the graph now describes nothing.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { GraphifyGraph, GraphifyNode } from "../research/graphify.js";

/** How many god nodes and orphans a report carries. */
export const TOP_N = 10;

/**
 * Degree at or above which a node is called a god node.
 *
 * Not a fixed number: a 200-node graph and a 4000-node graph have very
 * different natural maxima, so this is expressed relative to the graph. The
 * absolute floor stops a tiny graph reporting its most ordinary node as a
 * hub.
 */
export const GOD_NODE_PERCENTILE = 0.99;
export const GOD_NODE_FLOOR = 8;

export interface OrphanNode {
	id: string;
	label: string;
	sourceFile: string;
	fileType: string;
}

export interface GodNode {
	id: string;
	label: string;
	sourceFile: string;
	degree: number;
	/** Distinct communities this node touches — breadth, not just volume. */
	communitiesTouched: number;
}

export interface CouplingReport {
	communities: number;
	/** Edges whose endpoints share a community. */
	internalEdges: number;
	/** Edges crossing a community boundary. */
	crossingEdges: number;
	/** crossing / (internal + crossing), 0..1. Lower is more modular. */
	ratio: number;
	largestCommunity: number;
}

export interface RotReport {
	/** Nodes whose source_file is gone. */
	nodes: number;
	/** Distinct files that no longer exist. */
	files: string[];
	/** nodes-gone / total-nodes, 0..1. */
	ratio: number;
	/** False when paths could not be checked, so 0 does not mean "clean". */
	checked: boolean;
}

export interface GraphAnalysis {
	nodes: number;
	edges: number;
	orphans: OrphanNode[];
	/** Total orphans, which may exceed the listed ones. */
	orphanCount: number;
	godNodes: GodNode[];
	coupling: CouplingReport;
	rot: RotReport;
}

/** Degree per node id, counting a self-loop once. */
function degrees(graph: GraphifyGraph): Map<string, number> {
	const deg = new Map<string, number>();
	for (const id of graph.nodes.keys()) deg.set(id, 0);
	for (const edge of graph.edges) {
		const ends =
			edge.source === edge.target ? [edge.source] : [edge.source, edge.target];
		for (const end of ends) deg.set(end, (deg.get(end) ?? 0) + 1);
	}
	return deg;
}

const describe = (node: GraphifyNode) => ({
	id: node.id,
	label: node.label,
	sourceFile: node.sourceFile,
	fileType: node.fileType,
});

/**
 * Analyse a graph.
 *
 * `root` is needed only for rot: `source_file` is recorded relative to the
 * repository, so checking existence without it would test paths against the
 * wrong directory and report a healthy graph as entirely rotten. Omit it and
 * rot reports `checked: false` rather than a fabricated zero.
 */
export function analyseGraph(
	graph: GraphifyGraph,
	options?: { root?: string; topN?: number },
): GraphAnalysis {
	const topN = options?.topN ?? TOP_N;
	const deg = degrees(graph);

	// --- orphans ---
	const orphanNodes: GraphifyNode[] = [];
	for (const [id, node] of graph.nodes) {
		if ((deg.get(id) ?? 0) === 0) orphanNodes.push(node);
	}

	// --- god nodes ---
	const sorted = [...deg.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	);
	// Percentile over the actual degree distribution, floored so a small graph
	// does not nominate its most ordinary node.
	const index = Math.floor(sorted.length * GOD_NODE_PERCENTILE);
	const threshold = Math.max(sorted[index]?.[1] ?? 0, GOD_NODE_FLOOR);

	const communitiesOf = new Map<string, Set<number>>();
	for (const edge of graph.edges) {
		for (const [from, to] of [
			[edge.source, edge.target],
			[edge.target, edge.source],
		]) {
			const other = graph.nodes.get(to);
			if (other?.community === null || other?.community === undefined) continue;
			const set = communitiesOf.get(from) ?? new Set<number>();
			set.add(other.community);
			communitiesOf.set(from, set);
		}
	}

	const godNodes: GodNode[] = [];
	for (const [id, degree] of sorted) {
		if (degree < threshold) break;
		const node = graph.nodes.get(id);
		if (!node) continue;
		godNodes.push({
			id,
			label: node.label,
			sourceFile: node.sourceFile,
			degree,
			communitiesTouched: communitiesOf.get(id)?.size ?? 0,
		});
		if (godNodes.length >= topN) break;
	}

	// --- coupling ---
	const communities = new Set<number>();
	for (const node of graph.nodes.values()) {
		if (node.community !== null) communities.add(node.community);
	}
	const sizes = new Map<number, number>();
	for (const node of graph.nodes.values()) {
		if (node.community === null) continue;
		sizes.set(node.community, (sizes.get(node.community) ?? 0) + 1);
	}

	let internalEdges = 0;
	let crossingEdges = 0;
	for (const edge of graph.edges) {
		const a = graph.nodes.get(edge.source);
		const b = graph.nodes.get(edge.target);
		// An edge touching an unclassified node is neither internal nor
		// crossing; counting it either way would move the ratio on no evidence.
		if (a?.community === null || b?.community === null) continue;
		if (a?.community === undefined || b?.community === undefined) continue;
		if (a.community === b.community) internalEdges++;
		else crossingEdges++;
	}
	const classified = internalEdges + crossingEdges;

	// --- rot ---
	const rot: RotReport = {
		nodes: 0,
		files: [],
		ratio: 0,
		checked: Boolean(options?.root) && isAbsolute(options?.root ?? ""),
	};
	if (rot.checked && options?.root) {
		const gone = new Set<string>();
		for (const node of graph.nodes.values()) {
			const file = node.sourceFile;
			if (!file) continue;
			const abs = isAbsolute(file) ? file : join(options.root, file);
			if (existsSync(abs)) continue;
			gone.add(file);
			rot.nodes++;
		}
		rot.files = [...gone].slice(0, topN);
		rot.ratio = graph.nodes.size === 0 ? 0 : rot.nodes / graph.nodes.size;
	}

	return {
		nodes: graph.nodes.size,
		edges: graph.edges.length,
		orphans: orphanNodes.slice(0, topN).map(describe),
		orphanCount: orphanNodes.length,
		godNodes,
		coupling: {
			communities: communities.size,
			internalEdges,
			crossingEdges,
			ratio: classified === 0 ? 0 : crossingEdges / classified,
			largestCommunity: sizes.size === 0 ? 0 : Math.max(...sizes.values()),
		},
		rot,
	};
}
