/**
 * Graphify integration (Milestone 4) — the code and docs graph.
 *
 * ## The division of labour, from the plan
 *
 * "graphify owns the code/docs graph; the hybrid index owns session/research
 * history. They compose." This module is the graphify half. The research index
 * next door answers "what did I look up, ask, delegate and conclude"; this
 * answers "what is this symbol, what calls it, and what breaks if I change it".
 * Neither does the other's job, and neither is asked to.
 *
 * ## Why this reads the artifact instead of spawning graphify
 *
 * graphify ships an MCP server (`serve.py`). Querying it would mean spawning a
 * Python process per question and speaking MCP to it from a Node core that has
 * no other Python dependency. The decisive detail is what `serve.py` actually
 * does: `_load_graph` reads `graphify-out/graph.json` — the same file this
 * module reads. Going through the server would not consult a different or more
 * authoritative source, it would consult *this file*, slower and with a process
 * boundary in the way.
 *
 * So: read the artifact for queries, and shell out only for the one thing that
 * cannot be reimplemented — building the graph (`graphify update <path>`, which
 * is AST-only and needs no LLM or API key). That is exactly the plan's
 * "Inspector Hook can trigger graphify builds and query its MCP", with the
 * query half pointed at the file the server itself would open.
 *
 * ## Why search is BM25 rather than graphify's own matcher
 *
 * The plan's caveat about graphify is precise: its query CLI "matches on
 * case-folded substring + IDF" with "no stemming, no synonyms, no
 * cross-language match". Ranked retrieval over the node labels is strictly
 * better than substring containment, and this repo already has a tested BM25
 * implementation, so the graph is indexed with it.
 *
 * One thing that had to be fixed to make that work at all: `tokenize` splits on
 * non-alphanumeric characters, so `handleResearchCommand` becomes ONE token and
 * a search for "research" cannot match it. Node labels in a code graph are
 * overwhelmingly identifiers, so `identifierText` below splits them into words
 * AND keeps the original, letting both `research` and `handleResearchCommand`
 * find the same node.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { Bm25Index } from "./bm25.js";

const execFileAsync = promisify(execFile);

/** Where graphify writes, relative to a repository root. */
export const GRAPH_DIR = "graphify-out";
export const GRAPH_FILE = "graph.json";

/**
 * Largest graph this will parse.
 *
 * `JSON.parse` on a huge file blocks the event loop and can exhaust the heap,
 * and the core serves an IPC connection while it runs. This repo's own graph is
 * 2.7MB for 3933 nodes; 128MB leaves room for a corpus far larger than that
 * while still refusing a file that would take the core down with it.
 */
export const MAX_GRAPH_BYTES = 128 * 1024 * 1024;

/** A node as graphify writes it, renamed to this codebase's conventions. */
export interface GraphifyNode {
	id: string;
	label: string;
	/** "code" | "document" | "rationale" in observed builds; not an enum here. */
	fileType: string;
	sourceFile: string;
	/** Usually "L12" or "L12-L40". Kept verbatim; parsing it is the caller's. */
	sourceLocation: string;
	community: number | null;
}

export interface GraphifyEdge {
	source: string;
	target: string;
	relation: string;
	confidence: string | null;
	weight: number;
	sourceFile: string | null;
	sourceLocation: string | null;
}

/** A neighbour, with the direction of the edge that reached it preserved. */
export interface GraphifyNeighbor {
	node: GraphifyNode;
	relation: string;
	/**
	 * "out" when the queried node is the edge's source.
	 *
	 * graphify writes `directed: false` and `serve.py` loads it as an undirected
	 * nx.Graph, but the relations are plainly directional — `contains`, `calls`
	 * and `imports_from` all mean something different backwards. Collapsing that
	 * would turn "what calls this" and "what does this call" into one answer, so
	 * the direction is reported and the caller decides.
	 */
	direction: "in" | "out";
	weight: number;
	/** Hops from the queried node. */
	depth: number;
}

export interface GraphifyStats {
	available: boolean;
	/** Absolute path to graph.json, or null when there is no graph. */
	path: string | null;
	nodes: number;
	edges: number;
	communities: number;
	byFileType: Record<string, number>;
	byRelation: Record<string, number>;
	/** The commit graphify recorded at build time, when it recorded one. */
	builtAtCommit: string | null;
	/** File mtime, as an ISO string. */
	builtAt: string | null;
	/**
	 * True when the graph's commit differs from the repository's current HEAD.
	 *
	 * `null` means unknown — no recorded commit, or HEAD could not be read —
	 * which is deliberately distinct from `false`. Reporting an unknown as
	 * "fresh" is the kind of confident wrong answer this project keeps finding.
	 */
	stale: boolean | null;
	headCommit: string | null;
	/** Set when a graph exists but could not be used. */
	error?: string;
}

export interface GraphifySearchHit {
	node: GraphifyNode;
	score: number;
	/** Query terms that actually matched, for showing why this ranked. */
	matched: string[];
	/** How many edges touch this node — a cheap signal of importance. */
	degree: number;
}

export interface GraphifySearchResult {
	hits: GraphifySearchHit[];
	total: number;
	terms: string[];
	searched: number;
}

/**
 * Split an identifier into searchable words, keeping the original.
 *
 * `handleResearchCommand` yields "handleResearchCommand handle Research
 * Command", so both the exact symbol and any word inside it retrieve the node.
 * Without this the graph is searchable only by whole identifier, which is the
 * one query a person who is looking for something does not already know.
 */
export function identifierText(label: string): string {
	if (!label) return "";
	const split = label
		// camelCase and PascalCase boundaries.
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		// ACRONYMWord -> ACRONYM Word
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/[_\-./]+/g, " ");
	return split === label ? label : `${label} ${split}`;
}

/** Locate a repository's graph.json, or null when it has never been built. */
export function findGraphPath(workspaceRoot: string): string | null {
	if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0)
		return null;
	if (!isAbsolute(workspaceRoot)) return null;
	const path = join(resolve(workspaceRoot), GRAPH_DIR, GRAPH_FILE);
	return existsSync(path) ? path : null;
}

/**
 * The repository's current HEAD commit, or null.
 *
 * Read from .git directly rather than by spawning git, matching
 * project-resolver.ts — the same reason applies: a subprocess per status call
 * is 9x the latency for a string that is sitting in a file.
 *
 * Returns null rather than guessing when the ref lives in packed-refs, because
 * "unknown" and "unchanged" must not be the same answer.
 */
export function headCommit(workspaceRoot: string): string | null {
	try {
		const head = readFileSync(
			join(workspaceRoot, ".git", "HEAD"),
			"utf-8",
		).trim();
		if (!head.startsWith("ref:")) {
			return /^[0-9a-f]{40}$/.test(head) ? head : null;
		}
		const ref = head.slice(4).trim();
		const refPath = join(workspaceRoot, ".git", ref);
		if (!existsSync(refPath)) return null; // packed-refs; unknown, not unchanged
		const sha = readFileSync(refPath, "utf-8").trim();
		return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

interface RawNode {
	id?: unknown;
	label?: unknown;
	file_type?: unknown;
	source_file?: unknown;
	source_location?: unknown;
	community?: unknown;
}

interface RawLink {
	source?: unknown;
	target?: unknown;
	relation?: unknown;
	confidence?: unknown;
	weight?: unknown;
	source_file?: unknown;
	source_location?: unknown;
}

const str = (v: unknown, fallback = ""): string =>
	typeof v === "string" ? v : fallback;

/**
 * A parsed graph with the indexes a query needs.
 *
 * Built once per file version and cached by the reader; construction walks
 * every node and edge, which is not something to repeat per keystroke.
 */
export class GraphifyGraph {
	readonly nodes = new Map<string, GraphifyNode>();
	readonly edges: GraphifyEdge[] = [];
	/** node id -> indices into `edges`, both directions. */
	private readonly incident = new Map<string, number[]>();
	private readonly index = new Bm25Index();
	readonly builtAtCommit: string | null;

	constructor(raw: unknown) {
		const doc = (raw ?? {}) as {
			nodes?: RawNode[];
			links?: RawLink[];
			built_at_commit?: unknown;
		};
		this.builtAtCommit =
			typeof doc.built_at_commit === "string" ? doc.built_at_commit : null;

		for (const n of Array.isArray(doc.nodes) ? doc.nodes : []) {
			const id = str(n.id);
			if (!id || this.nodes.has(id)) continue;
			const label = str(n.label, id);
			this.nodes.set(id, {
				id,
				label,
				fileType: str(n.file_type, "unknown"),
				sourceFile: str(n.source_file),
				sourceLocation: str(n.source_location),
				community: typeof n.community === "number" ? n.community : null,
			});
			// The source file is indexed too: "research-handlers" should find the
			// symbols defined in it, not only a node literally named that.
			this.index.add(
				id,
				`${identifierText(label)} ${identifierText(str(n.source_file))}`,
			);
		}

		for (const l of Array.isArray(doc.links) ? doc.links : []) {
			const source = str(l.source);
			const target = str(l.target);
			// A link to a node that does not exist cannot be traversed, and
			// keeping it would make degree counts lie.
			if (!this.nodes.has(source) || !this.nodes.has(target)) continue;
			const at = this.edges.length;
			this.edges.push({
				source,
				target,
				relation: str(l.relation, "related"),
				confidence: typeof l.confidence === "string" ? l.confidence : null,
				weight: typeof l.weight === "number" ? l.weight : 1,
				sourceFile: typeof l.source_file === "string" ? l.source_file : null,
				sourceLocation:
					typeof l.source_location === "string" ? l.source_location : null,
			});
			for (const end of source === target ? [source] : [source, target]) {
				const list = this.incident.get(end);
				if (list) list.push(at);
				else this.incident.set(end, [at]);
			}
		}
	}

	get nodeCount(): number {
		return this.nodes.size;
	}

	get edgeCount(): number {
		return this.edges.length;
	}

	node(id: string): GraphifyNode | null {
		return this.nodes.get(id) ?? null;
	}

	degree(id: string): number {
		return this.incident.get(id)?.length ?? 0;
	}

	communities(): number {
		const seen = new Set<number>();
		for (const n of this.nodes.values()) {
			if (n.community !== null) seen.add(n.community);
		}
		return seen.size;
	}

	byFileType(): Record<string, number> {
		const out: Record<string, number> = {};
		for (const n of this.nodes.values()) {
			out[n.fileType] = (out[n.fileType] ?? 0) + 1;
		}
		return out;
	}

	byRelation(): Record<string, number> {
		const out: Record<string, number> = {};
		for (const e of this.edges) {
			out[e.relation] = (out[e.relation] ?? 0) + 1;
		}
		return out;
	}

	/** Ranked node search. */
	search(
		query: string,
		options?: { limit?: number; fileType?: string },
	): GraphifySearchResult {
		const fileType = options?.fileType;
		const result = this.index.search(query, {
			limit: options?.limit ?? 20,
			filter: fileType
				? (id) => this.nodes.get(id)?.fileType === fileType
				: undefined,
		});

		const hits: GraphifySearchHit[] = [];
		for (const hit of result.hits) {
			const node = this.nodes.get(hit.docId);
			if (!node) continue;
			hits.push({
				node,
				score: hit.score,
				matched: hit.matched,
				degree: this.degree(node.id),
			});
		}
		return {
			hits,
			total: result.total,
			terms: result.terms,
			searched: this.nodes.size,
		};
	}

	/**
	 * Neighbours out to `depth` hops, nearest first.
	 *
	 * Breadth-first so `depth` is the true shortest-hop distance; a depth-first
	 * walk would label a node by the path that happened to reach it, which makes
	 * "two hops away" mean nothing.
	 */
	neighbors(
		id: string,
		options?: { depth?: number; relations?: string[]; limit?: number },
	): GraphifyNeighbor[] {
		if (!this.nodes.has(id)) return [];
		const maxDepth = Math.max(1, Math.min(options?.depth ?? 1, 5));
		const limit = options?.limit ?? 100;
		const relations = options?.relations?.length
			? new Set(options.relations)
			: null;

		const out: GraphifyNeighbor[] = [];
		const seen = new Set<string>([id]);
		let frontier = [id];

		for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
			const next: string[] = [];
			for (const current of frontier) {
				for (const at of this.incident.get(current) ?? []) {
					const edge = this.edges[at];
					if (!edge) continue;
					if (relations && !relations.has(edge.relation)) continue;
					const other = edge.source === current ? edge.target : edge.source;
					if (seen.has(other)) continue;
					const node = this.nodes.get(other);
					if (!node) continue;
					seen.add(other);
					next.push(other);
					out.push({
						node,
						relation: edge.relation,
						direction: edge.source === current ? "out" : "in",
						weight: edge.weight,
						depth,
					});
					if (out.length >= limit) return out;
				}
			}
			frontier = next;
		}
		return out;
	}
}

/**
 * Loads and caches a repository's graph.
 *
 * The cache key is the file's mtime and size, not just its path: `graphify
 * watch` and `graphify update` rewrite graph.json underneath a running core,
 * and serving a stale parse of a file that changed is worse than not caching at
 * all.
 */
export class GraphifyReader {
	private cached: {
		path: string;
		mtimeMs: number;
		size: number;
		graph: GraphifyGraph;
	} | null = null;

	constructor(private readonly workspaceRoot: string) {}

	/** The parsed graph, or null with a reason. */
	load():
		| { graph: GraphifyGraph; path: string }
		| { graph: null; path: string | null; error?: string } {
		const path = findGraphPath(this.workspaceRoot);
		if (!path) return { graph: null, path: null };

		let info: ReturnType<typeof statSync>;
		try {
			info = statSync(path);
		} catch (error) {
			return {
				graph: null,
				path,
				error: `cannot stat graph: ${message(error)}`,
			};
		}

		if (info.size > MAX_GRAPH_BYTES) {
			return {
				graph: null,
				path,
				error: `graph is ${Math.round(info.size / 1024 / 1024)}MB, over the ${
					MAX_GRAPH_BYTES / 1024 / 1024
				}MB limit`,
			};
		}

		const c = this.cached;
		if (
			c &&
			c.path === path &&
			c.mtimeMs === info.mtimeMs &&
			c.size === info.size
		) {
			return { graph: c.graph, path };
		}

		try {
			const graph = new GraphifyGraph(JSON.parse(readFileSync(path, "utf-8")));
			this.cached = { path, mtimeMs: info.mtimeMs, size: info.size, graph };
			return { graph, path };
		} catch (error) {
			return {
				graph: null,
				path,
				error: `cannot parse graph: ${message(error)}`,
			};
		}
	}

	status(): GraphifyStats {
		const loaded = this.load();
		const head = headCommit(this.workspaceRoot);

		if (!loaded.graph) {
			return {
				available: false,
				path: loaded.path,
				nodes: 0,
				edges: 0,
				communities: 0,
				byFileType: {},
				byRelation: {},
				builtAtCommit: null,
				builtAt: null,
				stale: null,
				headCommit: head,
				...("error" in loaded && loaded.error ? { error: loaded.error } : {}),
			};
		}

		const { graph, path } = loaded;
		let builtAt: string | null = null;
		try {
			builtAt = statSync(path).mtime.toISOString();
		} catch {
			builtAt = null;
		}

		return {
			available: true,
			path,
			nodes: graph.nodeCount,
			edges: graph.edgeCount,
			communities: graph.communities(),
			byFileType: graph.byFileType(),
			byRelation: graph.byRelation(),
			builtAtCommit: graph.builtAtCommit,
			builtAt,
			// Unknown stays unknown. See GraphifyStats.stale.
			stale: graph.builtAtCommit && head ? graph.builtAtCommit !== head : null,
			headCommit: head,
		};
	}

	search(
		query: string,
		options?: { limit?: number; fileType?: string },
	): GraphifySearchResult {
		const loaded = this.load();
		if (!loaded.graph) return { hits: [], total: 0, terms: [], searched: 0 };
		return loaded.graph.search(query, options);
	}

	node(id: string): GraphifyNode | null {
		return this.load().graph?.node(id) ?? null;
	}

	neighbors(
		id: string,
		options?: { depth?: number; relations?: string[]; limit?: number },
	): GraphifyNeighbor[] {
		return this.load().graph?.neighbors(id, options) ?? [];
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Rebuild the graph by running graphify.
 *
 * `update` is the AST-only path: no LLM, no API key, no network. `extract`
 * would do semantic extraction and needs a model backend, which this core has
 * no business requiring, so it is deliberately not offered here.
 *
 * Not found is reported as a plain result rather than thrown — graphify is an
 * optional external tool, and "not installed" is a normal state to render, not
 * an error to crash on.
 */
export async function buildGraph(
	workspaceRoot: string,
	options?: { timeoutMs?: number; binary?: string },
): Promise<{ ok: boolean; output: string; error?: string }> {
	const binary = options?.binary ?? "graphify";
	try {
		const { stdout, stderr } = await execFileAsync(
			binary,
			["update", workspaceRoot],
			{
				timeout: options?.timeoutMs ?? 10 * 60 * 1000,
				maxBuffer: 4 * 1024 * 1024,
				cwd: workspaceRoot,
			},
		);
		return { ok: true, output: `${stdout}${stderr}`.trim() };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & {
			stdout?: string;
			stderr?: string;
		};
		return {
			ok: false,
			output: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim(),
			error:
				err.code === "ENOENT"
					? "graphify is not installed or not on PATH"
					: message(error),
		};
	}
}
