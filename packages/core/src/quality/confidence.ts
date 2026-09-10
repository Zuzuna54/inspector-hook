/**
 * Turning noisy tool output into findings worth reading (Milestone 7).
 *
 * ## The problem, measured
 *
 * Raw `knip` on this repository flags **66 unused files, of which 64 are false
 * positives** — a 97% error rate. They are the webview's classic scripts,
 * loaded as `<script>` tags from a manifest in `webview-html.ts`, invisible to
 * a tool that traces ES-module imports. Graph orphans on the same repo: 9, of
 * which 7 are the same kind of false positive.
 *
 * A Quality view built on either raw signal is a wall of lies, and a gate built
 * on one would block every feature forever.
 *
 * ## Ground truth suppresses. Signals only rank.
 *
 * The distinction is the whole design. A **ground truth** is a definitive
 * statement that a file is used — the manifest literally lists the scripts the
 * webview loads, so a file in it is loaded, full stop. That suppresses.
 *
 * A **signal** is a tool's opinion. Opinions raise or lower confidence and
 * never suppress, because they disagree in both directions:
 *
 *     scripts/debug-webview.js   knip flags · graph degree 0    both agree
 *     .../http_logger.py         knip BLIND (Python) · degree 0 graph only
 *     core/src/persistence/      knip flags · 6 graph edges     knip only,
 *                                                               and knip is RIGHT
 *
 * That third row is why the graph cannot suppress: `persistence/index.ts` is
 * genuinely dead and the graph shows it connected, because graphify's
 * `contains`/`imports` edges are not reachability. A design that let the graph
 * veto knip would have hidden a true finding.
 *
 * ## The tiers
 *
 *   suppressed  a ground truth says it is used. Counted, never listed as dead.
 *   high        two or more independent signals agree
 *   medium      one signal, and nothing contradicts it
 *   low         one signal, and another signal disagrees
 *
 * Every finding carries the signals that agreed AND the ones that disagreed, so
 * a reader can overrule the tier. A number without its basis is the thing this
 * project keeps getting wrong.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** A tool's opinion that something is unused. */
export type SignalName = "knip" | "graph-orphan" | "madge" | "sonar";

export type Confidence = "high" | "medium" | "low" | "suppressed";

export interface DeadCodeFinding {
	/** Project-relative path. */
	file: string;
	/** Signals that consider this dead. */
	agreed: SignalName[];
	/** Signals that consider it alive, with what they saw. */
	disagreed: { signal: SignalName; because: string }[];
	confidence: Confidence;
	/** Set when suppressed: the ground truth that vetoed it, verbatim. */
	suppressedBy?: string;
}

export interface GroundTruth {
	/** Human-readable name, quoted in `suppressedBy`. */
	name: string;
	/** Project-relative paths this truth vouches for. */
	used: Set<string>;
}

/**
 * Files that may hold the webview manifest, newest layout first.
 *
 * Two entries because the manifest moved: it lived inside `webview-html.ts`
 * until that file crossed the package's 600-line limit and the arrays were
 * split into `webview-assets.ts`. Both are read so a checkout from either side
 * of that split resolves, and the list is a constant so the next move is one
 * edit rather than a silent regression.
 */
export const MANIFEST_SOURCES = [
	["packages", "vscode", "src", "webview-assets.ts"],
	["packages", "vscode", "src", "webview-html.ts"],
] as const;

/** The directory whose existence means this project HAS a webview to vouch for. */
const WEBVIEW_MEDIA = ["packages", "vscode", "media", "scripts"] as const;

export interface ManifestStatus {
	/** True when this project has a webview, so a manifest is expected. */
	expected: boolean;
	/** Which file the entries came from, project-relative. */
	source?: string;
	/** How many paths were parsed. */
	files: number;
	/**
	 * Set when a manifest was expected and not found.
	 *
	 * This exists because the failure is otherwise invisible in the worst
	 * possible way. `webviewManifestTruth` returning null means "no
	 * suppression", so a manifest that moves takes 64 of this repository's 66
	 * knip findings from `suppressed` to `high` — the Quality view fills with
	 * false positives and nothing says why. Measured: splitting the arrays out
	 * of `webview-html.ts` did exactly that, and only a test caught it.
	 */
	error?: string;
}

/** Parse manifest entries out of one source file. */
function manifestEntries(text: string): Set<string> {
	const used = new Set<string>();
	// Entries look like ["scripts", "views", "research.js"].
	for (const match of text.matchAll(/\[((?:\s*"[^"]+"\s*,?)+)\]/g)) {
		const parts = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
		if (parts.length === 0) continue;
		if (parts[0] !== "scripts" && parts[0] !== "styles") continue;
		used.add(`packages/vscode/media/${parts.join("/")}`);
	}
	return used;
}

/**
 * Where the manifest was found, or why it was not.
 *
 * Separate from `webviewManifestTruth` so a caller can report the absence.
 * A scan that quietly loses its ground truth is the false-reporting class this
 * whole module exists to prevent, and "null" cannot carry a reason.
 */
export function webviewManifestStatus(root: string): ManifestStatus {
	const expected = existsSync(join(root, ...WEBVIEW_MEDIA));

	for (const parts of MANIFEST_SOURCES) {
		const source = join(root, ...parts);
		if (!existsSync(source)) continue;
		let text: string;
		try {
			text = readFileSync(source, "utf-8");
		} catch {
			continue;
		}
		const used = manifestEntries(text);
		if (used.size === 0) continue;
		return { expected, source: parts.join("/"), files: used.size };
	}

	return {
		expected,
		files: 0,
		...(expected
			? {
					error: `this project has a webview at packages/vscode/media/scripts but no asset manifest was found in ${MANIFEST_SOURCES.map(
						(p) => p.join("/"),
					).join(" or ")}; dead-code findings for webview scripts cannot be suppressed and will be reported as real`,
				}
			: {}),
	};
}

/**
 * Files a webview manifest loads, read from the source that loads them.
 *
 * This is ground truth rather than a heuristic: `webview-html.ts` holds the
 * array the extension iterates to emit `<script>` and `<link>` tags, so a path
 * in it is loaded by definition. Read from the file rather than duplicated into
 * a config, because a second copy of the manifest would drift the moment
 * someone adds a script — and a stale suppression list is worse than none.
 *
 * Returns null when there is no manifest, so a project without a webview gets
 * no suppression rather than an empty one that looks authoritative. When a
 * manifest was EXPECTED and not found, `webviewManifestStatus` carries the
 * reason — null alone cannot distinguish "nothing to vouch for" from "the
 * ground truth is gone", and those must never look the same.
 */
export function webviewManifestTruth(root: string): GroundTruth | null {
	const status = webviewManifestStatus(root);
	if (!status.source) return null;

	const text = readFileSync(join(root, ...status.source.split("/")), "utf-8");
	const used = manifestEntries(text);
	return used.size === 0
		? null
		: {
				name: `the webview manifest in ${status.source}`,
				used,
			};
}

/** Every ground truth that applies to a project. */
export function groundTruthsFor(root: string): GroundTruth[] {
	return [webviewManifestTruth(root)].filter(
		(t): t is GroundTruth => t !== null,
	);
}

/**
 * The ground truths that applied, and the ones that should have and did not.
 *
 * The second list is the point. `groundTruthsFor` returning an empty array is
 * indistinguishable from a project that has nothing to suppress, and a scan
 * that quietly loses its suppressor reports false positives as real.
 */
export function groundTruthReport(root: string): {
	truths: GroundTruth[];
	available: { name: string; files: number }[];
	problems: string[];
} {
	const status = webviewManifestStatus(root);
	const truths = groundTruthsFor(root);
	return {
		truths,
		available: truths.map((t) => ({ name: t.name, files: t.used.size })),
		problems: status.error ? [status.error] : [],
	};
}

export interface SignalInput {
	/** Files knip called unused, project-relative. */
	knip?: string[];
	/** Files the graph found isolated, project-relative. */
	graphOrphans?: string[];
	/**
	 * Files the graph found CONNECTED, with their degree.
	 *
	 * Disagreement is as informative as agreement: a file knip flags that the
	 * graph shows with twenty edges deserves a lower tier than one the graph
	 * has never heard of.
	 */
	graphConnected?: Map<string, number>;
	/**
	 * Files the graph has no node for at all.
	 *
	 * Distinct from connected-with-0-degree: the graph may simply predate the
	 * file. Absence is not evidence, so these produce neither agreement nor
	 * disagreement — measured case: `views/agents.js`, added after the last
	 * graph build, had 0 nodes.
	 */
	graphUnknown?: Set<string>;
}

/**
 * Combine signals and ground truths into ranked findings.
 *
 * Deterministic and pure so the tiering can be tested without running any
 * tool.
 */
export function rankFindings(
	signals: SignalInput,
	truths: GroundTruth[],
): DeadCodeFinding[] {
	const agreed = new Map<string, Set<SignalName>>();
	const add = (file: string, signal: SignalName) => {
		const set = agreed.get(file) ?? new Set<SignalName>();
		set.add(signal);
		agreed.set(file, set);
	};

	for (const file of signals.knip ?? []) add(file, "knip");
	for (const file of signals.graphOrphans ?? []) add(file, "graph-orphan");

	const findings: DeadCodeFinding[] = [];

	for (const [file, signalSet] of agreed) {
		const truth = truths.find((t) => t.used.has(file));
		if (truth) {
			findings.push({
				file,
				agreed: [...signalSet].sort(),
				disagreed: [],
				confidence: "suppressed",
				suppressedBy: truth.name,
			});
			continue;
		}

		const disagreed: DeadCodeFinding["disagreed"] = [];
		const degree = signals.graphConnected?.get(file);
		if (degree !== undefined && degree > 0 && !signalSet.has("graph-orphan")) {
			disagreed.push({
				signal: "graph-orphan",
				because: `the graph shows ${degree} edge${degree === 1 ? "" : "s"}`,
			});
		}

		// Absence from the graph is NOT disagreement -- see SignalInput. It is
		// deliberately read nowhere below: a file the graph has never seen
		// neither confirms nor contradicts knip.

		let confidence: Confidence;
		if (signalSet.size >= 2) confidence = "high";
		else if (disagreed.length > 0) confidence = "low";
		else confidence = "medium";

		findings.push({
			file,
			agreed: [...signalSet].sort(),
			disagreed,
			confidence,
		});
	}

	// Highest confidence first, then by path so the order is stable.
	const rank: Record<Confidence, number> = {
		high: 0,
		medium: 1,
		low: 2,
		suppressed: 3,
	};
	return findings.sort(
		(a, b) =>
			rank[a.confidence] - rank[b.confidence] || a.file.localeCompare(b.file),
	);
}

/** Make a path project-relative, so signals from different tools can be joined. */
export function toRelative(root: string, file: string): string {
	if (!file.startsWith("/")) return file;
	const rel = relative(root, file);
	return rel.startsWith("..") ? file : rel;
}
