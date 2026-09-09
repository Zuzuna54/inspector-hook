/**
 * Code quality across observed projects (Milestone 7).
 *
 * ## The field that matters most is `status`
 *
 * Every tool result carries one, and it exists because "0 findings" and "we
 * could not run this" must never render the same. A project with no Sonar
 * connection showing as clean, or a project where knip crashed showing zero
 * unused files, is the false-reporting class this codebase treats as its
 * priority bug. `not-applicable`, `unavailable` and `failed` are all distinct
 * from `ok` with an empty list.
 */

/** Why a tool did or did not produce results. */
export type ToolStatus =
	/** It ran and these are its findings. */
	| "ok"
	/** It does not apply here — knip on a project with no package.json. */
	| "not-applicable"
	/** It applies but is not installed, or needs a connection it lacks. */
	| "unavailable"
	/** It ran and broke. `error` says how. */
	| "failed"
	/** It exceeded its time budget and was killed. */
	| "timeout";

export interface ToolResult {
	tool: "knip" | "madge" | "sonar-secrets" | "graphify";
	status: ToolStatus;
	/** Milliseconds the tool actually ran. */
	durationMs?: number;
	/** Present when status is failed/unavailable/timeout. */
	error?: string;
	/** Why it does not apply, when status is not-applicable. */
	reason?: string;
}

/** Confidence in a dead-code finding. See core/quality/confidence.ts. */
export type FindingConfidence = "high" | "medium" | "low" | "suppressed";

export interface QualityFinding {
	file: string;
	/** Tools that consider this dead. */
	agreed: string[];
	/** Tools that consider it alive, with what they saw. */
	disagreed: { signal: string; because: string }[];
	confidence: FindingConfidence;
	/** The ground truth that vetoed this, verbatim. */
	suppressedBy?: string;
}

/** A circular dependency, as madge reports it. */
export interface CircularDependency {
	cycle: string[];
}

export interface SecretFinding {
	file: string;
	/** Never the secret itself — a rule name only. */
	rule: string;
	line?: number;
}

/** Graph health, from graphify. See core/quality/graph-analysis.ts. */
export interface GraphHealth {
	nodes: number;
	edges: number;
	orphanCount: number;
	godNodes: {
		label: string;
		sourceFile: string;
		degree: number;
		communitiesTouched: number;
	}[];
	coupling: { communities: number; ratio: number; crossingEdges: number };
	rot: { nodes: number; ratio: number; checked: boolean };
	/** Whether the graph matched HEAD when read. null means unknown. */
	stale: boolean | null;
}

export interface QualityReport {
	projectRoot: string;
	projectName: string;
	/** ISO timestamp of the scan. */
	scannedAt: string;
	durationMs: number;
	/** One entry per tool, including the ones that did not run. */
	tools: ToolResult[];
	/** Dead-code findings, highest confidence first. */
	findings: QualityFinding[];
	circular: CircularDependency[];
	secrets: SecretFinding[];
	graph?: GraphHealth;
	/**
	 * Headline counts, each derived only from tools whose status is `ok`.
	 *
	 * `measured` lists which tools those were, so a small number is never
	 * mistaken for a clean project.
	 */
	summary: {
		high: number;
		medium: number;
		low: number;
		suppressed: number;
		circular: number;
		secrets: number;
		measured: string[];
		unmeasured: string[];
	};
}

/** One point in a project's history, for trends. */
export interface QualityTrendPoint {
	scannedAt: string;
	high: number;
	medium: number;
	low: number;
	circular: number;
	secrets: number;
	couplingRatio?: number;
	orphanCount?: number;
}

export interface QualityTrend {
	projectRoot: string;
	points: QualityTrendPoint[];
	/** Change in high-confidence findings between the first and last point. */
	highDelta: number;
}

export interface QualityOverview {
	projects: {
		root: string;
		name: string;
		exists: boolean;
		lastScannedAt?: string;
		high?: number;
		measured?: string[];
	}[];
	discovered: number;
	existing: number;
	scanned: number;
}
