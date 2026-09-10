/**
 * Running quality tools over an observed project (Milestone 7).
 *
 * ## The rule every path here obeys
 *
 * A tool that did not run reports `not-applicable`, `unavailable`, `failed` or
 * `timeout` — never `ok` with an empty list. "0 unused files" and "knip is not
 * installed" are different facts, and collapsing them is how a Quality view
 * starts telling people their project is clean when nothing measured it.
 * `summary.measured` and `summary.unmeasured` carry that through to the caller
 * so a small number can never be read as a good one.
 *
 * ## Why every tool is a subprocess with a budget
 *
 * knip, madge and sonar are external programs on someone else's machine. They
 * can be absent, a different major version, or slow on a large repository. Each
 * gets a timeout and a buffer cap, and a failure of one never stops the others:
 * a scan that produces three of four results is useful, and a scan that throws
 * is not.
 *
 * ## What is deliberately NOT run
 *
 * `sonar list issues` and `sonar quality-gate status` need a SonarQube Server
 * or Cloud connection. They are not attempted, because attempting them without
 * a token produces an auth error that looks like a scan failure. Only
 * `sonar analyze secrets`, which the CLI documents as running locally with no
 * connection, is used. If a connection is configured later, those become a
 * second tier — the shape here already allows it.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
	CircularDependency,
	QualityFinding,
	QualityReport,
	SecretFinding,
	ToolResult,
	ToolStatus,
} from "@inspector-hook/protocol";
import { buildGraph, GraphifyReader } from "../research/graphify.js";
import {
	ANALYZERS,
	type Analyzer,
	type AnalyzerContext,
	analyzersFor,
	detectLanguages,
	findJsRoot,
} from "./analyzers.js";
import { groundTruthReport, rankFindings, toRelative } from "./confidence.js";
import { analyseGraph } from "./graph-analysis.js";
import type { ScannableProject } from "./project-registry.js";

const execFileAsync = promisify(execFile);

/** Per-tool time budget. Generous: knip on a large repo is not fast. */
export const TOOL_TIMEOUT_MS = 5 * 60 * 1000;

/** Cap on a tool's stdout, so a pathological repo cannot exhaust memory. */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

interface RunResult {
	status: ToolStatus;
	stdout: string;
	error?: string;
	durationMs: number;
}

/**
 * Run one tool, converting every failure mode into a status.
 *
 * Never throws. The distinction between "not installed" (ENOENT) and "ran and
 * failed" is preserved, because the first is a setup gap and the second is a
 * finding about the project.
 */
async function run(
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
): Promise<RunResult> {
	const started = Date.now();
	try {
		const { stdout } = await execFileAsync(command, args, {
			cwd,
			timeout: timeoutMs,
			maxBuffer: MAX_OUTPUT_BYTES,
			// Tools are read-only analysers; nothing here should prompt.
			env: { ...process.env, CI: "1", NO_COLOR: "1" },
		});
		return { status: "ok", stdout, durationMs: Date.now() - started };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & {
			stdout?: string;
			killed?: boolean;
			code?: string | number;
		};
		const durationMs = Date.now() - started;

		// knip and madge exit non-zero WHEN THEY FIND SOMETHING. That is a
		// successful run with results, not a failure -- treating it as one
		// would report every project with dead code as unscannable.
		if (err.stdout && err.stdout.trim().length > 0 && err.code !== "ENOENT") {
			return { status: "ok", stdout: err.stdout, durationMs };
		}
		if (err.killed) {
			return {
				status: "timeout",
				stdout: "",
				error: `exceeded ${timeoutMs}ms`,
				durationMs,
			};
		}
		if (err.code === "ENOENT") {
			return {
				status: "unavailable",
				stdout: "",
				error: `${command} is not installed or not on PATH`,
				durationMs,
			};
		}
		return {
			status: "failed",
			stdout: "",
			error: err.message ?? String(error),
			durationMs,
		};
	}
}

/** Files knip considers unused, from its JSON reporter. */
export function parseKnipFiles(stdout: string): string[] {
	let doc: unknown;
	try {
		doc = JSON.parse(stdout);
	} catch {
		return [];
	}
	const issues = (doc as { issues?: unknown[] })?.issues;
	if (!Array.isArray(issues)) return [];

	const out: string[] = [];
	for (const raw of issues) {
		const issue = raw as Record<string, unknown>;
		const file = typeof issue.file === "string" ? issue.file : undefined;
		if (!file) continue;
		// An entry carrying export/dependency findings is about symbols INSIDE a
		// used file. Only an entry with no such findings means the file itself
		// is unreferenced.
		const hasSymbolIssues = [
			"exports",
			"types",
			"duplicates",
			"dependencies",
			"devDependencies",
			"unlisted",
			"binaries",
			"enumMembers",
		].some((key) => Array.isArray(issue[key]) && (issue[key] as []).length > 0);
		if (!hasSymbolIssues) out.push(file);
	}
	return out;
}

/** Cycles from `madge --circular --json`, which returns an array of arrays. */
export function parseMadgeCycles(stdout: string): CircularDependency[] {
	try {
		const doc = JSON.parse(stdout);
		if (!Array.isArray(doc)) return [];
		return doc
			.filter((c): c is string[] => Array.isArray(c) && c.length > 0)
			.map((cycle) => ({ cycle }));
	} catch {
		return [];
	}
}

/**
 * Secrets from the sonar CLI.
 *
 * Only the rule name and location are kept. The matched value is deliberately
 * discarded: this report is persisted to disk and served over IPC, and copying
 * a live credential into it would turn a security tool into a second leak.
 */
export function parseSonarSecrets(stdout: string): SecretFinding[] {
	let doc: unknown;
	try {
		doc = JSON.parse(stdout);
	} catch {
		return [];
	}
	const list = Array.isArray(doc)
		? doc
		: ((doc as { issues?: unknown[]; findings?: unknown[] })?.issues ??
			(doc as { findings?: unknown[] })?.findings);
	if (!Array.isArray(list)) return [];

	const out: SecretFinding[] = [];
	for (const raw of list) {
		const item = raw as Record<string, unknown>;
		const file =
			typeof item.file === "string"
				? item.file
				: typeof item.path === "string"
					? item.path
					: undefined;
		if (!file) continue;
		const rule =
			typeof item.rule === "string"
				? item.rule
				: typeof item.ruleKey === "string"
					? item.ruleKey
					: "secret";
		const line = typeof item.line === "number" ? item.line : undefined;
		out.push({ file, rule, line });
	}
	return out;
}

/**
 * How long a graph build gets.
 *
 * `graphify update` is AST-only with no model call, but it walks the whole
 * repository. Measured on this one: 4095 nodes in well under a minute. Five
 * minutes is generous for a large repository and still bounded.
 */
export const GRAPH_BUILD_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Roots a graph build must refuse.
 *
 * `discoverProjects` reads the `cwd` a session ran in, and a session started
 * in a home directory makes that home directory a "project" — measured: one of
 * the 18 on this machine is `/Users/giorgobg` itself. `graphify update` walks
 * everything below its root, so building there would crawl the entire home
 * directory, every repository inside it, and every node_modules along the way.
 *
 * The check is structural rather than a denylist: a root at or above the home
 * directory, or fewer than two segments deep, is not a project.
 */
export function refuseGraphBuild(root: string): string | null {
	const home = homedir();
	if (root === home || home.startsWith(`${root}/`)) {
		return `refusing to build a graph at ${root}: it is at or above the home directory, and graphify walks everything below its root`;
	}
	if (root.split("/").filter(Boolean).length < 2) {
		return `refusing to build a graph at ${root}: too close to the filesystem root`;
	}
	return null;
}

export interface ScanOptions {
	/**
	 * Build the graph before analysing it.
	 *
	 * Off by default, because `graphify update` walks the whole repository.
	 * When true the scan reports a `graphify-build` tool result, so a build
	 * that failed is visible rather than showing up as "no graph".
	 */
	buildGraph?: boolean;
	timeoutMs?: number;
	/**
	 * Override an analyser's command by id, so tests need none of the tools
	 * installed. Keyed by analyser id: knip, madge, vulture, ruff,
	 * go-deadcode, clippy, sonar-secrets.
	 */
	commands?: Record<string, [string, string[]]>;
}

/**
 * Scan one project.
 *
 * Returns a report even when every tool fails — the report then says so, which
 * is the useful outcome. Throwing would lose the information about WHY nothing
 * could be measured.
 */
export async function scanProject(
	project: ScannableProject,
	options: ScanOptions = {},
): Promise<QualityReport> {
	const started = Date.now();
	const timeout = options.timeoutMs ?? TOOL_TIMEOUT_MS;
	const root = project.root;
	const tools: ToolResult[] = [];
	const findingsInput: {
		knip?: string[];
		graphOrphans?: string[];
		graphConnected?: Map<string, number>;
	} = {};
	const circular: CircularDependency[] = [];
	const secrets: SecretFinding[] = [];
	let graph: QualityReport["graph"];

	if (!project.exists) {
		return {
			projectRoot: root,
			projectName: project.name,
			scannedAt: new Date().toISOString(),
			durationMs: Date.now() - started,
			tools: [...ANALYZERS.map((a) => a.id), "graphify"].map((tool) => ({
				tool,
				status: "not-applicable" as const,
				reason: "the project directory no longer exists",
			})),
			findings: [],
			circular: [],
			secrets: [],
			deadSymbols: [],
			summary: {
				high: 0,
				medium: 0,
				low: 0,
				suppressed: 0,
				circular: 0,
				secrets: 0,
				deadSymbols: 0,
				measured: [],
				unmeasured: [...ANALYZERS.map((a) => a.id), "graphify"],
			},
		};
	}

	// --- every applicable analyser, from the registry ----------------------
	//
	// One loop, not four hardcoded blocks. Adding a language is a registry
	// entry: the original M7 named only knip, and a scanner edited per language
	// is a scanner that only ever covers one.
	const languages = detectLanguages(root);
	// The JS manifest is not always at the root: five observed projects hold
	// their package.json one level down. See findJsRoot.
	const js = findJsRoot(root);
	const ctx: AnalyzerContext = {
		root,
		languages,
		hasPackageJson: js.dir.length > 0,
	};
	const deadSymbols: QualityReport["deadSymbols"] = [];

	for (const analyzer of ANALYZERS) {
		if (!analyzer.applies(ctx)) {
			tools.push({
				tool: analyzer.id,
				language: analyzer.language,
				label: analyzer.label,
				status: "not-applicable",
				reason:
					analyzer.language === "ts-js" && !ctx.hasPackageJson
						? js.nested.length > 1
							? `no package.json at the root; ${js.nested.length} nested packages found (${js.nested
									.map((d) => d.slice(root.length + 1))
									.join(", ")}) — each is scanned as its own project`
							: "no package.json; there are no entry points to trace"
						: `the project has no ${analyzer.language} files`,
			});
			continue;
		}

		const [cmd, args] =
			options.commands?.[analyzer.id] ?? analyzer.command(ctx);
		// A JS analyser runs where the manifest is, which may be a subdirectory.
		const cwd = analyzer.language === "ts-js" && js.dir ? js.dir : root;
		const result = await run(cmd, args, cwd, timeout);
		tools.push({
			tool: analyzer.id,
			language: analyzer.language,
			label: analyzer.label,
			status: result.status,
			durationMs: result.durationMs,
			error:
				result.status === "unavailable" && analyzer.needsInstall
					? analyzer.needsInstall
					: result.error,
		});
		if (result.status !== "ok") continue;

		for (const finding of analyzer.parse(result.stdout, ctx)) {
			switch (finding.kind) {
				case "dead-file":
					(findingsInput.knip ??= []).push(finding.file);
					break;
				case "dead-symbol":
					deadSymbols.push({
						file: finding.file,
						line: finding.line,
						detail: finding.detail,
						tool: analyzer.id,
					});
					break;
				case "cycle":
					circular.push({ cycle: finding.cycle ?? [finding.file] });
					break;
				case "secret":
					secrets.push({
						file: finding.file,
						rule: finding.detail,
						line: finding.line,
					});
					break;
			}
		}
	}

	// --- graphify -----------------------------------------------------------
	{
		// Build FIRST when asked (M7.20). §7.2 makes per-project graph building
		// a deliverable -- "the scan does that, so all 17 get graphs rather than
		// 1" -- and `buildGraph` sat here declared and read by nothing for a
		// whole milestone. The scan read graphs and never created one, so 17 of
		// 18 projects on disk got the narrow signal only.
		//
		// Off by default and it stays off by default: `graphify update` walks a
		// whole repository and takes seconds to minutes, which is not something
		// a scan should do without being asked.
		if (options?.buildGraph) {
			const buildStart = Date.now();
			const refusal = refuseGraphBuild(root);
			if (refusal) {
				tools.push({
					tool: "graphify-build",
					language: "any",
					label: "graphify (build the graph)",
					status: "not-applicable",
					durationMs: 0,
					reason: refusal,
				});
			} else {
				const built = await buildGraph(root, {
					timeoutMs: options.timeoutMs ?? GRAPH_BUILD_TIMEOUT_MS,
				});
				tools.push({
					tool: "graphify-build",
					language: "any",
					label: "graphify (build the graph)",
					status: built.ok ? "ok" : "failed",
					durationMs: Date.now() - buildStart,
					...(built.ok ? {} : { error: built.error ?? built.output }),
				});
			}
		}

		const reader = new GraphifyReader(root);
		const before = Date.now();
		const loaded = reader.load();
		if (!loaded.graph) {
			tools.push({
				tool: "graphify",
				status: "unavailable",
				durationMs: Date.now() - before,
				error:
					("error" in loaded && loaded.error) ||
					(options?.buildGraph
						? "the build ran and produced no readable graph"
						: "no graph; use Build graph + scan, or run `graphify update .`"),
			});
		} else {
			const analysis = analyseGraph(loaded.graph, { root, topN: 20 });
			const status = reader.status();
			graph = {
				nodes: analysis.nodes,
				edges: analysis.edges,
				orphanCount: analysis.orphanCount,
				godNodes: analysis.godNodes.map((n) => ({
					label: n.label,
					sourceFile: n.sourceFile,
					degree: n.degree,
					communitiesTouched: n.communitiesTouched,
				})),
				coupling: {
					communities: analysis.coupling.communities,
					ratio: analysis.coupling.ratio,
					crossingEdges: analysis.coupling.crossingEdges,
				},
				rot: analysis.rot,
				stale: status.stale,
			};
			findingsInput.graphOrphans = analysis.orphans.map((o) => o.sourceFile);
			const connected = new Map<string, number>();
			for (const node of loaded.graph.nodes.values()) {
				const degree = loaded.graph.degree(node.id);
				if (degree > 0 && node.sourceFile) {
					connected.set(
						node.sourceFile,
						Math.max(connected.get(node.sourceFile) ?? 0, degree),
					);
				}
			}
			findingsInput.graphConnected = connected;
			tools.push({
				tool: "graphify",
				status: "ok",
				durationMs: Date.now() - before,
			});
		}
	}

	// Both halves matter: the truths suppress, and a truth that should exist
	// and does not has to reach the report. See groundTruthReport.
	const truth = groundTruthReport(root);
	const findings: QualityFinding[] = rankFindings(findingsInput, truth.truths);

	const count = (c: string) =>
		findings.filter((f) => f.confidence === c).length;
	const measured = tools.filter((t) => t.status === "ok").map((t) => t.tool);
	const unmeasured = tools.filter((t) => t.status !== "ok").map((t) => t.tool);

	return {
		projectRoot: root,
		projectName: project.name,
		scannedAt: new Date().toISOString(),
		durationMs: Date.now() - started,
		tools,
		findings,
		circular,
		secrets,
		deadSymbols,
		languages,
		graph,
		groundTruth: { available: truth.available, problems: truth.problems },
		summary: {
			high: count("high"),
			medium: count("medium"),
			low: count("low"),
			suppressed: count("suppressed"),
			circular: circular.length,
			secrets: secrets.length,
			deadSymbols: deadSymbols.length,
			measured,
			unmeasured,
		},
	};
}

/** True when a project has a graph worth analysing. */
export function hasGraph(root: string): boolean {
	return existsSync(join(root, "graphify-out", "graph.json"));
}

/** Read a project's package name, for display. Never throws. */
export function packageName(root: string): string | undefined {
	try {
		const pkg = JSON.parse(
			readFileSync(join(root, "package.json"), "utf-8"),
		) as { name?: unknown };
		return typeof pkg.name === "string" ? pkg.name : undefined;
	} catch {
		return undefined;
	}
}
