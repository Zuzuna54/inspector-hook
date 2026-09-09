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

import { GraphifyReader } from "../research/graphify.js";
import { groundTruthsFor, rankFindings, toRelative } from "./confidence.js";
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

export interface ScanOptions {
	/** Rebuild the graph before analysing it. Slow; off by default. */
	buildGraph?: boolean;
	timeoutMs?: number;
	/** Override the tool commands, so tests need none of them installed. */
	commands?: {
		knip?: [string, string[]];
		madge?: [string, string[]];
		sonar?: [string, string[]];
	};
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
	let circular: CircularDependency[] = [];
	let secrets: SecretFinding[] = [];
	let graph: QualityReport["graph"];

	if (!project.exists) {
		return {
			projectRoot: root,
			projectName: project.name,
			scannedAt: new Date().toISOString(),
			durationMs: Date.now() - started,
			tools: (["knip", "madge", "sonar-secrets", "graphify"] as const).map(
				(tool) => ({
					tool,
					status: "not-applicable" as const,
					reason: "the project directory no longer exists",
				}),
			),
			findings: [],
			circular: [],
			secrets: [],
			summary: {
				high: 0,
				medium: 0,
				low: 0,
				suppressed: 0,
				circular: 0,
				secrets: 0,
				measured: [],
				unmeasured: ["knip", "madge", "sonar-secrets", "graphify"],
			},
		};
	}

	// --- knip -------------------------------------------------------------
	if (!project.tools.knip) {
		tools.push({
			tool: "knip",
			status: "not-applicable",
			reason: "no package.json; knip has no entry points to trace",
		});
	} else {
		const [cmd, args] = options.commands?.knip ?? [
			"npx",
			["--yes", "knip", "--no-progress", "--reporter", "json"],
		];
		const result = await run(cmd, args, root, timeout);
		tools.push({
			tool: "knip",
			status: result.status,
			durationMs: result.durationMs,
			error: result.error,
		});
		if (result.status === "ok") {
			findingsInput.knip = parseKnipFiles(result.stdout).map((f) =>
				toRelative(root, f),
			);
		}
	}

	// --- madge -------------------------------------------------------------
	if (!project.tools.madge) {
		tools.push({
			tool: "madge",
			status: "not-applicable",
			reason: "no JavaScript or TypeScript sources to walk",
		});
	} else {
		const [cmd, args] = options.commands?.madge ?? [
			"npx",
			["--yes", "madge", "--circular", "--json", "--extensions", "ts,js", "."],
		];
		const result = await run(cmd, args, root, timeout);
		tools.push({
			tool: "madge",
			status: result.status,
			durationMs: result.durationMs,
			error: result.error,
		});
		if (result.status === "ok") circular = parseMadgeCycles(result.stdout);
	}

	// --- sonar (local tier only) -------------------------------------------
	{
		const [cmd, args] = options.commands?.sonar ?? [
			"sonar",
			["analyze", "secrets", "."],
		];
		const result = await run(cmd, args, root, timeout);
		tools.push({
			tool: "sonar-secrets",
			status: result.status,
			durationMs: result.durationMs,
			error:
				result.status === "unavailable"
					? "the sonar CLI is not installed (see docs.sonarsource.com/sonarqube-cli)"
					: result.error,
		});
		if (result.status === "ok") secrets = parseSonarSecrets(result.stdout);
	}

	// --- graphify -----------------------------------------------------------
	{
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
					"no graph; build one with `graphify update .`",
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

	const findings: QualityFinding[] = rankFindings(
		findingsInput,
		groundTruthsFor(root),
	);

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
		graph,
		summary: {
			high: count("high"),
			medium: count("medium"),
			low: count("low"),
			suppressed: count("suppressed"),
			circular: circular.length,
			secrets: secrets.length,
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
