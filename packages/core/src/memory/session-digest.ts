/**
 * Turn a finished session into a memory entry.
 *
 * The digest is built from facts the core already recorded — files changed,
 * tools run, branch, duration, failures — and nothing else. There is no model
 * call here, deliberately: the plan lists `claude -p` narrative summarisation
 * as an enhancement with a facts-only fallback, and the facts-only path is what
 * has to be correct first. A digest that quietly invents what a session was
 * "about" would be read as fact by every later session, which is the most
 * expensive possible place for this codebase's recurring failure — code that
 * reports something untrue.
 *
 * Everything here is a pure function of a Session, so it is testable without a
 * store, a hook or a running core.
 */

import type { Session } from "@inspector-hook/protocol";
import type { MemoryType } from "./native-memory.js";

/** How many entries a list in the digest shows before it collapses to a count. */
const MAX_LISTED = 12;

/** A session's shape as the digest needs it, kept narrow for testability. */
export interface DigestInput {
	session: Session;
	/** Log-derived counts, which the session record does not hold itself. */
	counts?: {
		errors?: number;
		warnings?: number;
		blocked?: number;
		logs?: number;
	};
	/** Prompts the user sent, oldest first, when available. */
	prompts?: string[];
	/**
	 * File paths for the session's change IDs.
	 *
	 * `Session.fileChanges` holds change IDs, not paths — resolving them needs
	 * the FileTracker, which this module deliberately does not depend on. A
	 * caller that has the tracker passes the resolved paths; without them the
	 * digest falls back to `ToolExecution.affectedFiles`, which is carried on
	 * the session itself.
	 */
	filePaths?: string[];
}

export interface SessionDigest {
	/** Frontmatter `name:`, and the basis of the file name. */
	name: string;
	/** Frontmatter `description:` — the line that decides recall relevance. */
	description: string;
	/** Always `project`: a session digest is ongoing work on this codebase. */
	type: MemoryType;
	/** Markdown body. */
	body: string;
	/** Human title for the index line. */
	title: string;
	/** False when the session produced nothing worth remembering. */
	worthKeeping: boolean;
	/** Why it was judged not worth keeping. */
	skipReason?: string;
}

/**
 * A stable, sortable entry name.
 *
 * Dated rather than sequential so two sessions on the same project in the same
 * day do not collide into one file, and so the corpus reads chronologically.
 */
function digestName(session: Session): string {
	const started = parseTime(session.startTime) ?? Date.now();
	const day = new Date(started).toISOString().slice(0, 10);
	const shortId = String(session.id ?? "unknown").slice(0, 8);
	return `session-${day}-${shortId}`;
}

function parseTime(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

/** A duration a human reads without converting units. */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "unknown";
	// Checked against the raw milliseconds, not the rounded minutes: rounding
	// first reports a 59-second session as "1 min", and 30 seconds likewise.
	// Small, but this module exists precisely so a digest states nothing untrue.
	if (ms < 60_000) return "under a minute";
	const totalMinutes = Math.round(ms / 60_000);
	if (totalMinutes < 60) return `${totalMinutes} min`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Render a list, collapsing the tail rather than emitting a hundred lines. */
function bulletList(items: string[], max = MAX_LISTED): string[] {
	const shown = items.slice(0, max).map((i) => `- ${i}`);
	if (items.length > max) {
		shown.push(`- …and ${items.length - max} more`);
	}
	return shown;
}

/**
 * Build the digest.
 *
 * Returns `worthKeeping: false` for a session that touched no files and ran no
 * tools. Writing those would bury the useful entries under noise, and a memory
 * index that is mostly noise stops being read — the index is loaded with a
 * line budget, so every worthless entry costs a real one.
 */
export function buildSessionDigest(input: DigestInput): SessionDigest {
	const { session, counts = {}, prompts = [] } = input;

	const meta = (session.metadata ?? {}) as Record<string, unknown>;
	const project = str(meta.projectName) ?? str(session.name) ?? "unknown project";
	const branch = str(meta.gitBranch);
	const cwd = str(meta.workingDirectory);

	const executions = Array.isArray(session.toolExecutions)
		? session.toolExecutions
		: [];
	// fileChanges is an array of change IDs, not change objects.
	const changeIds = Array.isArray(session.fileChanges) ? session.fileChanges : [];

	// Tool usage, most-used first.
	const toolCounts = new Map<string, number>();
	for (const exec of executions) {
		if (!exec?.tool) continue;
		toolCounts.set(exec.tool, (toolCounts.get(exec.tool) ?? 0) + 1);
	}
	const tools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);

	const failed = executions.filter(
		(exec) => exec?.status === "failed" || exec?.status === "blocked",
	).length;

	// Files, de-duplicated: a file edited eight times is one file. Prefer paths
	// the caller resolved from change IDs; otherwise use what the executions
	// themselves recorded.
	const fromExecutions = executions.flatMap((exec) =>
		Array.isArray(exec?.affectedFiles) ? exec.affectedFiles : [],
	);
	const files = [
		...new Set(
			(input.filePaths?.length ? input.filePaths : fromExecutions).filter(
				(p): p is string => typeof p === "string" && p.length > 0,
			),
		),
	].sort();

	const start = parseTime(session.startTime);
	const end = parseTime(session.endTime) ?? parseTime(session.lastActivityTime);
	const durationMs = start !== null && end !== null ? end - start : null;

	const name = digestName(session);
	const title = `${project}${branch ? ` (${branch})` : ""} — ${
		start ? new Date(start).toISOString().slice(0, 10) : "undated"
	}`;

	if (files.length === 0 && executions.length === 0 && changeIds.length === 0) {
		return {
			name,
			title,
			type: "project",
			description: `Session on ${project} with no recorded activity`,
			body: "",
			worthKeeping: false,
			skipReason: "no file changes and no tool executions",
		};
	}

	// The description is what a later session reads when deciding whether to
	// open the file, so it carries the counts rather than a generic label.
	const parts: string[] = [];
	if (files.length > 0) {
		parts.push(`${files.length} file${files.length === 1 ? "" : "s"} changed`);
	} else if (changeIds.length > 0) {
		// Changes were recorded but their paths could not be resolved. Say so
		// rather than reporting zero files, which would be false.
		parts.push(
			`${changeIds.length} change${changeIds.length === 1 ? "" : "s"} (paths unresolved)`,
		);
	}
	if (executions.length > 0) {
		parts.push(`${executions.length} tool call${executions.length === 1 ? "" : "s"}`);
	}
	if (failed > 0) parts.push(`${failed} failed`);
	const description = `${project}${branch ? ` on ${branch}` : ""}: ${parts.join(", ")}`;

	const lines: string[] = [];
	lines.push(`# ${title}`, "");
	lines.push(`Recorded automatically by Inspector Hook from session \`${session.id}\`.`, "");

	lines.push("## Facts", "");
	lines.push(`- Project: ${project}`);
	if (cwd) lines.push(`- Working directory: \`${cwd}\``);
	if (branch) lines.push(`- Branch: ${branch}`);
	if (start) lines.push(`- Started: ${new Date(start).toISOString()}`);
	if (durationMs !== null) lines.push(`- Duration: ${formatDuration(durationMs)}`);
	lines.push(`- Status at digest time: ${session.status ?? "unknown"}`);
	if (changeIds.length > 0) {
		lines.push(`- Change records: ${changeIds.length}`);
	}
	if (counts.errors) lines.push(`- Errors logged: ${counts.errors}`);
	if (counts.warnings) lines.push(`- Warnings logged: ${counts.warnings}`);
	if (counts.blocked) lines.push(`- Blocked operations: ${counts.blocked}`);
	lines.push("");

	if (files.length > 0) {
		lines.push(`## Files changed (${files.length})`, "");
		lines.push(...bulletList(files.map((f) => `\`${f}\``)));
		lines.push("");
	}

	if (tools.length > 0) {
		lines.push("## Tools used", "");
		lines.push(...bulletList(tools.map(([tool, n]) => `${tool} ×${n}`)));
		if (failed > 0) {
			lines.push("", `${failed} call${failed === 1 ? "" : "s"} did not succeed.`);
		}
		lines.push("");
	}

	if (prompts.length > 0) {
		lines.push("## What was asked", "");
		// Verbatim and truncated, never paraphrased: a paraphrase of intent is
		// exactly the kind of invented fact a later session would trust.
		lines.push(...bulletList(prompts.map((p) => truncate(oneLine(p), 200)), 8));
		lines.push("");
	}

	return {
		name,
		title,
		type: "project",
		description,
		body: lines.join("\n"),
		worthKeeping: true,
	};
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
