/**
 * The analyser registry (Milestone 7).
 *
 * knip only sees JavaScript and TypeScript. Measured across the 17 projects
 * Inspector Hook observes:
 *
 *     20540  TS/JS      knip, madge
 *      3757  Rust       clippy
 *      2608  Go         x/tools/cmd/deadcode
 *      1760  Python     vulture, ruff
 *      1466  SQL        (no dead-code analyser worth running)
 *      1212  Shell
 *
 * So Python, Rust and Go were chosen by file count, not by guess. `cere-full`
 * alone is TS 5207 + Rust 3514 + Go 946, which is why per-project language
 * detection has to be plural: one project can need four analysers.
 *
 * ## Every analyser runs without a global install where its ecosystem allows
 *
 * Verified on this machine, which had only `ruff` installed:
 *
 *     knip, madge      npx --yes …                                  no install
 *     vulture          uvx vulture …                                no install (11ms)
 *     go deadcode      go run golang.org/x/tools/cmd/deadcode@latest no install
 *     clippy           cargo clippy                                 already present
 *     cargo-machete    cargo install cargo-machete                  NEEDS INSTALL
 *
 * That is why Rust uses clippy's `dead_code` lint rather than cargo-machete:
 * clippy is there, machete is not, and a scan that needs a setup step is a scan
 * that does not run. `needsInstall` records the exception so the report can say
 * "unavailable, install it with X" instead of implying a clean project.
 *
 * ## Every analyser owns its exclusions, because defaults are wrong
 *
 * Measured, and it is not a small effect. `vulture` on a Django project reported
 * **66 findings, 62 of them inside `.venv/site-packages`** — third-party code
 * the developer cannot act on. With exclusions: 4. That is 94% noise from
 * trusting a default, the same shape as knip's 97% false-positive rate on this
 * repository's webview scripts.
 *
 * knip reads a project's own ignore config; vulture, ruff and clippy do not, so
 * the exclusions live here.
 */

import { type Dirent, existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

/** Directories no analyser should ever look inside. */
export const VENDOR_DIRS = [
	"node_modules",
	".git",
	".venv",
	"venv",
	"site-packages",
	"__pycache__",
	"dist",
	"build",
	"target",
	"out",
	".next",
	"vendor",
	"coverage",
	".mypy_cache",
	".pytest_cache",
];

/** Extension to language, for detection. */
const LANGUAGE_BY_EXT: Record<string, string> = {
	".ts": "ts-js",
	".tsx": "ts-js",
	".js": "ts-js",
	".jsx": "ts-js",
	".mjs": "ts-js",
	".cjs": "ts-js",
	".py": "python",
	".go": "go",
	".rs": "rust",
};

/** How deep language detection walks. Deeper costs time for little gain. */
export const DETECT_DEPTH = 4;

/** Files below this count are treated as incidental, not "the project uses X". */
export const LANGUAGE_FLOOR = 3;

export interface LanguageCounts {
	[language: string]: number;
}

/**
 * Which languages a project actually uses, by file count.
 *
 * A floor is applied because one vendored `.py` script does not make a
 * TypeScript project worth running vulture over — and running an analyser that
 * finds nothing still costs the seconds and still has to be explained in the
 * report.
 */
export function detectLanguages(
	root: string,
	depth = DETECT_DEPTH,
): LanguageCounts {
	const counts: LanguageCounts = {};
	const skip = new Set(VENDOR_DIRS);

	const walk = (dir: string, left: number): void => {
		if (left < 0) return;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full, left - 1);
			else {
				const language = LANGUAGE_BY_EXT[extname(entry.name)];
				if (language) counts[language] = (counts[language] ?? 0) + 1;
			}
		}
	};
	walk(root, depth);

	for (const [language, n] of Object.entries(counts)) {
		if (n < LANGUAGE_FLOOR) delete counts[language];
	}
	return counts;
}

/** What an analyser produces. */
export type FindingKind =
	/** A file that nothing references. Feeds confidence tiering. */
	| "dead-file"
	/** A symbol inside a live file. Reported, never tiered as a dead file. */
	| "dead-symbol"
	| "cycle"
	| "secret";

export interface ParsedFinding {
	/** Project-relative where possible. */
	file: string;
	line?: number;
	kind: FindingKind;
	/** Short human-readable detail. Never contains a secret's value. */
	detail: string;
	/** For cycles: the whole path. */
	cycle?: string[];
}

export interface AnalyzerContext {
	root: string;
	languages: LanguageCounts;
	hasPackageJson: boolean;
}

export interface Analyzer {
	id: string;
	/** Language key, or "any". */
	language: string;
	/** What a human should call it. */
	label: string;
	/** True when this analyser is worth running here. */
	applies(ctx: AnalyzerContext): boolean;
	/** Command and args. Prefers a runner that needs no global install. */
	command(ctx: AnalyzerContext): [string, string[]];
	/**
	 * Set when the tool CANNOT be run without installing something. The report
	 * quotes this so "unavailable" comes with a remedy instead of looking like
	 * a clean project.
	 */
	needsInstall?: string;
	/** Parse stdout. Must never throw; malformed output means no findings. */
	parse(stdout: string, ctx: AnalyzerContext): ParsedFinding[];
	/** Rough seconds, so a caller can warn before a long scan. */
	typicalSeconds: number;
}

const excludeGlobs = VENDOR_DIRS.map((d) => `*/${d}/*`).join(",");

/** Strip a leading project root so findings from different tools can be joined. */
function rel(root: string, file: string): string {
	if (!file.startsWith("/")) return file;
	return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

const jsonOrNull = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

/**
 * Every analyser, in the order a report should list them.
 *
 * Adding a language is one entry. That is the point: the original M7 text
 * named only knip, and a system that needs its scanner edited for every new
 * language is a system that will only ever cover one.
 */
export const ANALYZERS: Analyzer[] = [
	// ---------------------------------------------------------------- TS / JS
	{
		id: "knip",
		language: "ts-js",
		label: "knip (unused files, exports, dependencies)",
		typicalSeconds: 7,
		applies: (c) => c.hasPackageJson && (c.languages["ts-js"] ?? 0) > 0,
		command: () => [
			"npx",
			["--yes", "knip", "--no-progress", "--reporter", "json"],
		],
		parse(stdout, ctx) {
			const doc = jsonOrNull(stdout) as { issues?: unknown[] } | null;
			if (!Array.isArray(doc?.issues)) return [];
			const out: ParsedFinding[] = [];
			for (const raw of doc.issues) {
				const issue = raw as Record<string, unknown>;
				const file = typeof issue.file === "string" ? issue.file : undefined;
				if (!file) continue;
				const symbolKeys = [
					"exports",
					"types",
					"duplicates",
					"dependencies",
					"devDependencies",
					"unlisted",
					"binaries",
					"enumMembers",
				];
				const symbols = symbolKeys.flatMap((key) =>
					Array.isArray(issue[key]) ? (issue[key] as unknown[]) : [],
				);
				if (symbols.length === 0) {
					// No symbol findings means the FILE itself is unreferenced.
					out.push({
						file: rel(ctx.root, file),
						kind: "dead-file",
						detail: "no module imports this file",
					});
				} else {
					out.push({
						file: rel(ctx.root, file),
						kind: "dead-symbol",
						detail: `${symbols.length} unused export${symbols.length === 1 ? "" : "s"} or dependency`,
					});
				}
			}
			return out;
		},
	},
	{
		id: "madge",
		language: "ts-js",
		label: "madge (circular dependencies)",
		typicalSeconds: 5,
		applies: (c) => c.hasPackageJson && (c.languages["ts-js"] ?? 0) > 0,
		command: () => [
			"npx",
			["--yes", "madge", "--circular", "--json", "--extensions", "ts,js", "."],
		],
		parse(stdout) {
			const doc = jsonOrNull(stdout);
			if (!Array.isArray(doc)) return [];
			return doc
				.filter((c): c is string[] => Array.isArray(c) && c.length > 0)
				.map((cycle) => ({
					file: cycle[0],
					kind: "cycle" as const,
					detail: cycle.join(" → "),
					cycle,
				}));
		},
	},

	// ----------------------------------------------------------------- Python
	{
		id: "vulture",
		language: "python",
		label: "vulture (unreferenced Python functions and classes)",
		typicalSeconds: 6,
		applies: (c) => (c.languages.python ?? 0) > 0,
		// uvx runs it without installing anything -- measured at 11ms to fetch.
		command: () => [
			"uvx",
			[
				"vulture",
				".",
				// 80 keeps the confident findings. At 60 it reports unused
				// function ARGUMENTS, which are usually interface requirements.
				"--min-confidence",
				"80",
				// Without this, 62 of 66 findings on a Django project were inside
				// .venv/site-packages -- third-party code, 94% noise.
				"--exclude",
				excludeGlobs,
			],
		],
		parse(stdout, ctx) {
			const out: ParsedFinding[] = [];
			// `path:line: unused function 'name' (80% confidence)`
			for (const line of stdout.split("\n")) {
				const m = line.match(/^(.+?):(\d+):\s*unused (\w+) '([^']+)'/);
				if (!m) continue;
				out.push({
					file: rel(ctx.root, m[1]),
					line: Number(m[2]),
					kind: "dead-symbol",
					detail: `unused ${m[3]} '${m[4]}'`,
				});
			}
			return out;
		},
	},
	{
		id: "ruff",
		language: "python",
		label: "ruff (unused imports and locals)",
		typicalSeconds: 1,
		applies: (c) => (c.languages.python ?? 0) > 0,
		command: () => [
			"uvx",
			[
				"ruff",
				"check",
				".",
				"--output-format",
				"json",
				// Only the unused-code rules. A full ruff run is a style opinion
				// and would bury the dead-code signal this view is about.
				"--select",
				"F401,F811,F841",
				"--no-cache",
			],
		],
		parse(stdout, ctx) {
			const doc = jsonOrNull(stdout);
			if (!Array.isArray(doc)) return [];
			const out: ParsedFinding[] = [];
			for (const raw of doc) {
				const item = raw as Record<string, unknown>;
				const file =
					typeof item.filename === "string" ? item.filename : undefined;
				if (!file) continue;
				const loc = item.location as { row?: number } | undefined;
				out.push({
					file: rel(ctx.root, file),
					line: typeof loc?.row === "number" ? loc.row : undefined,
					kind: "dead-symbol",
					detail: `${String(item.code ?? "F")} ${String(item.message ?? "").slice(0, 90)}`,
				});
			}
			return out;
		},
	},

	// --------------------------------------------------------------------- Go
	{
		id: "go-deadcode",
		language: "go",
		label: "deadcode (unreachable Go functions)",
		typicalSeconds: 20,
		applies: (c) => (c.languages.go ?? 0) > 0,
		// The Go team's own tool, run straight from the module proxy.
		command: () => [
			"go",
			["run", "golang.org/x/tools/cmd/deadcode@latest", "-json", "./..."],
		],
		parse(stdout, ctx) {
			const doc = jsonOrNull(stdout);
			if (!Array.isArray(doc)) return [];
			const out: ParsedFinding[] = [];
			for (const raw of doc) {
				const pkg = raw as { Funcs?: unknown[] };
				for (const rawFn of pkg.Funcs ?? []) {
					const fn = rawFn as {
						Name?: unknown;
						Generated?: unknown;
						Position?: { File?: unknown; Line?: unknown };
					};
					// Generated code is not the developer's to delete.
					if (fn.Generated === true) continue;
					const file = fn.Position?.File;
					if (typeof file !== "string") continue;
					out.push({
						file: rel(ctx.root, file),
						line:
							typeof fn.Position?.Line === "number"
								? fn.Position.Line
								: undefined,
						kind: "dead-symbol",
						detail: `unreachable func ${String(fn.Name ?? "?")}`,
					});
				}
			}
			return out;
		},
	},

	// ------------------------------------------------------------------- Rust
	{
		id: "clippy",
		language: "rust",
		label: "clippy (dead_code and unused lints)",
		typicalSeconds: 30,
		applies: (c) => (c.languages.rust ?? 0) > 0,
		// clippy is present with any rustup toolchain; cargo-machete is not,
		// and a scan that needs `cargo install` first is a scan that does not
		// run. `dead_code` is a rustc lint, so clippy surfaces it.
		command: () => [
			"cargo",
			["clippy", "--message-format=json", "--all-targets", "--quiet"],
		],
		parse(stdout, ctx) {
			const out: ParsedFinding[] = [];
			// One JSON object per line, not a JSON array.
			for (const line of stdout.split("\n")) {
				if (!line.startsWith("{")) continue;
				const doc = jsonOrNull(line) as {
					reason?: string;
					message?: {
						code?: { code?: string } | null;
						message?: string;
						spans?: { file_name?: string; line_start?: number }[];
					};
				} | null;
				if (doc?.reason !== "compiler-message") continue;
				const code = doc.message?.code?.code ?? "";
				if (!/^(dead_code|unused_)/.test(code)) continue;
				const span = doc.message?.spans?.[0];
				if (!span?.file_name) continue;
				out.push({
					file: rel(ctx.root, span.file_name),
					line: span.line_start,
					kind: "dead-symbol",
					detail: `${code}: ${String(doc.message?.message ?? "").slice(0, 90)}`,
				});
			}
			return out;
		},
	},

	// -------------------------------------------------------- any language
	{
		id: "sonar-secrets",
		language: "any",
		label: "sonar (hardcoded secrets)",
		typicalSeconds: 5,
		applies: () => true,
		needsInstall:
			"install the sonar CLI: brew install sonarqube-cli (see docs.sonarsource.com/sonarqube-cli)",
		command: () => ["sonar", ["analyze", "secrets", "."]],
		parse(stdout, ctx) {
			const doc = jsonOrNull(stdout);
			const list = Array.isArray(doc)
				? doc
				: ((doc as { issues?: unknown[]; findings?: unknown[] })?.issues ??
					(doc as { findings?: unknown[] })?.findings);
			if (!Array.isArray(list)) return [];
			const out: ParsedFinding[] = [];
			for (const raw of list) {
				const item = raw as Record<string, unknown>;
				const file =
					typeof item.file === "string"
						? item.file
						: typeof item.path === "string"
							? item.path
							: undefined;
				if (!file) continue;
				out.push({
					file: rel(ctx.root, file),
					line: typeof item.line === "number" ? item.line : undefined,
					kind: "secret",
					// The rule only. This report is persisted and served over IPC;
					// copying the matched value would turn a security tool into a
					// second leak.
					detail: String(item.rule ?? item.ruleKey ?? "secret"),
				});
			}
			return out;
		},
	},
];

/** Analysers worth running for a project. */
export function analyzersFor(ctx: AnalyzerContext): Analyzer[] {
	return ANALYZERS.filter((a) => a.applies(ctx));
}

/** Rough total seconds a full scan will take, for warning a caller. */
export function estimateSeconds(ctx: AnalyzerContext): number {
	return analyzersFor(ctx).reduce((n, a) => n + a.typicalSeconds, 0);
}

/**
 * Where a project's JS/TS manifest actually lives.
 *
 * Measured on the observed set: five projects have TS/JS at scale and NO
 * `package.json` at the root, because the transcript recorded a container
 * directory rather than the package —
 *
 *     Ordex        -> ordex/, ordex-e2e/      two packages
 *     moto-laguna  -> photographer-portfolio/ one
 *     pitstop-moto -> photographer-portfolio/ one
 *     kits         -> forge/                  one
 *     vsi          -> vsi-conversation-core/  one
 *
 * A root-only check made knip `not-applicable` for all five, so four projects
 * with real TypeScript got no dead-code analysis at all. When exactly ONE
 * nested manifest exists it is used; when several do, the container is not a
 * workspace and each package is its own project, so this returns null and the
 * report says which manifests it found instead of guessing.
 */
export function findJsRoot(
	root: string,
	depth = 2,
): { dir: string; nested: string[] } {
	if (existsSync(join(root, "package.json"))) return { dir: root, nested: [] };

	const found: string[] = [];
	const walk = (dir: string, left: number): void => {
		if (left <= 0) return;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || VENDOR_DIRS.includes(entry.name))
				continue;
			const child = join(dir, entry.name);
			if (existsSync(join(child, "package.json"))) found.push(child);
			else walk(child, left - 1);
		}
	};
	walk(root, depth);

	// Exactly one is unambiguous. Several means each is its own project.
	return found.length === 1
		? { dir: found[0], nested: found }
		: { dir: "", nested: found };
}

/** True when a project looks like a Go module, Cargo crate, etc. */
export function hasManifest(root: string, language: string): boolean {
	const manifests: Record<string, string[]> = {
		"ts-js": ["package.json"],
		go: ["go.mod"],
		rust: ["Cargo.toml"],
		python: ["pyproject.toml", "setup.py", "requirements.txt"],
	};
	return (manifests[language] ?? []).some((f) => existsSync(join(root, f)));
}
