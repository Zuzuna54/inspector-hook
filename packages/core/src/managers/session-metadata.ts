import type { SessionMetadata } from "@inspector-hook/protocol";

/**
 * Session naming and metadata derivation.
 *
 * Extracted so there is one implementation. This logic had been copied four
 * times — here, and three times in the webview — and the copies had already
 * drifted: one read a `cwd` key that SessionManager never writes, so sessions
 * without an explicit projectName rendered blank.
 *
 * Everything here is pure and defensive by design. A shared helper has to be at
 * least as tolerant as the most tolerant caller it replaces, or consolidating
 * introduces a crash where each local copy happened to guard.
 */

/**
 * Metadata a session may carry.
 *
 * Aliased to the protocol type so a merge result can be assigned straight onto
 * a Session. Its index signature is `unknown`, which is correct here: the
 * values originate in hook payloads and must be narrowed before use.
 */
export type SessionMetadataInput = SessionMetadata;

/**
 * The last path segment of a directory, which is the conventional project name.
 *
 * Tolerates either separator, trailing separators, and a path that is nothing
 * but separators.
 */
export function extractProjectName(cwd: unknown): string | undefined {
	if (typeof cwd !== "string" || cwd.length === 0) return undefined;
	const segments = cwd.split(/[/\\]/).filter((s) => s.length > 0);
	return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

/**
 * A display name for a session.
 *
 * An explicit projectName wins; otherwise it is derived from the working
 * directory. Returns undefined rather than a placeholder when neither is
 * available, so a caller can decide how to render "unknown" itself.
 */
export function deriveSessionName(
	metadata?: SessionMetadataInput,
): string | undefined {
	if (!metadata) return undefined;

	if (typeof metadata.projectName === "string" && metadata.projectName) {
		return metadata.projectName;
	}
	return extractProjectName(metadata.workingDirectory);
}

/**
 * Build session metadata from a hook log's details.
 *
 * SessionStart carries the most accurate information (explicit project name,
 * git branch and remote), so it is allowed to overwrite what earlier events
 * inferred — but only with values it actually supplied. A later event must
 * never blank a field by omitting it.
 */
export function mergeSessionMetadata(
	existing: SessionMetadataInput | undefined,
	details: Record<string, unknown> | undefined,
): SessionMetadataInput {
	const merged: SessionMetadataInput = { ...(existing ?? {}) };
	if (!details) return merged;

	const cwd = details.cwd;
	const explicitProject = details.projectName;

	if (typeof explicitProject === "string" && explicitProject) {
		merged.projectName = explicitProject;
	}
	if (typeof details.gitBranch === "string" && details.gitBranch) {
		merged.gitBranch = details.gitBranch;
	}
	if (typeof details.gitRemote === "string" && details.gitRemote) {
		merged.gitRemote = details.gitRemote;
	}
	if (typeof cwd === "string" && cwd) {
		merged.workingDirectory = cwd;
		// Only infer from cwd when no explicit name was given, in this event or
		// a previous one.
		if (typeof merged.projectName !== "string" || !merged.projectName) {
			merged.projectName = extractProjectName(cwd);
		}
	}

	return merged;
}
