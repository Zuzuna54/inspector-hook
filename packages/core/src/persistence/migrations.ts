/**
 * Store migrations
 *
 * The on-disk store is plain JSON written by earlier versions of the app, so it
 * can contain records shaped by bugs that have since been fixed. Migrations run
 * once at startup, before any manager loads, and bring the store up to
 * CURRENT_SCHEMA_VERSION.
 *
 * Rules for writing one:
 *  - Be idempotent. A half-finished run must be safe to repeat.
 *  - Never throw. A store that cannot be migrated should still start, degraded,
 *    rather than block the app from running at all.
 *  - Only touch what the migration is for. Unknown fields are preserved.
 */

import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Bump when adding a migration below. */
export const CURRENT_SCHEMA_VERSION = 1;

const META_FILE = "meta.json";

interface StoreMeta {
	schemaVersion: number;
	migratedAt?: string;
}

export interface MigrationResult {
	fromVersion: number;
	toVersion: number;
	applied: string[];
	notes: string[];
}

/**
 * Read the store's recorded schema version. A store with no meta.json predates
 * versioning and is treated as version 0.
 */
async function readVersion(basePath: string): Promise<number> {
	const metaPath = join(basePath, META_FILE);
	if (!existsSync(metaPath)) return 0;
	try {
		const meta = JSON.parse(await readFile(metaPath, "utf-8")) as StoreMeta;
		return typeof meta.schemaVersion === "number" ? meta.schemaVersion : 0;
	} catch {
		return 0;
	}
}

async function writeVersion(basePath: string, version: number): Promise<void> {
	const meta: StoreMeta = {
		schemaVersion: version,
		migratedAt: new Date().toISOString(),
	};
	await writeFile(
		join(basePath, META_FILE),
		JSON.stringify(meta, null, 2),
		"utf-8",
	);
}

/** Load every *.json in a category directory, skipping unreadable files. */
async function loadCategory<T>(
	basePath: string,
	category: string,
): Promise<Array<{ id: string; path: string; data: T }>> {
	const dir = join(basePath, category);
	if (!existsSync(dir)) return [];

	const out: Array<{ id: string; path: string; data: T }> = [];
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return [];
	}

	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		const path = join(dir, file);
		try {
			out.push({
				id: file.replace(/\.json$/, ""),
				path,
				data: JSON.parse(await readFile(path, "utf-8")) as T,
			});
		} catch {
			// Unreadable or malformed - leave it alone.
		}
	}
	return out;
}

interface StoredChange {
	id: string;
	sessionId?: string;
	filePath?: string;
	timestamp?: string;
	beforeContent?: string;
	afterContent?: string;
}

interface StoredSession {
	id: string;
	status?: string;
	startTime?: string;
	endTime?: string;
	lastActivityTime?: string;
	toolExecutions?: Array<{ status?: string; endTime?: string }>;
}

/**
 * v0 -> v1
 *
 * Repairs records left by two fixed bugs:
 *
 *  1. Duplicate FileChange records. The HTTP ingest path and a core.ts event
 *     handler both tracked the same edit and raced, so most edits produced two
 *     identical change records under different ids. Collapse them, keeping the
 *     earliest.
 *
 *  2. Sessions falsely marked ended. The "Stop" hook was treated as a session
 *     end, so any session that was still being used got status "completed" plus
 *     an endTime, then silently reactivated. A record whose endTime precedes its
 *     last activity is self-contradictory; clear the end and restore it to idle
 *     so the normal stale-session sweep can classify it correctly.
 */
async function migrateV0ToV1(basePath: string): Promise<string[]> {
	const notes: string[] = [];

	// --- 1. de-duplicate file changes -------------------------------------
	const changes = await loadCategory<StoredChange>(basePath, "changes");
	const seen = new Map<string, { id: string; timestamp: string }>();
	const duplicates: string[] = [];

	// Oldest first, so the record we keep is the one that was written first.
	changes.sort((a, b) =>
		(a.data.timestamp ?? "").localeCompare(b.data.timestamp ?? ""),
	);

	for (const change of changes) {
		const d = change.data;
		// Same session, same file, same before/after content is a duplicate by
		// construction - the race produced byte-identical records.
		const key = [
			d.sessionId ?? "",
			d.filePath ?? "",
			d.beforeContent ?? "",
			d.afterContent ?? "",
		].join("\u0000");

		const existing = seen.get(key);
		if (existing) {
			duplicates.push(change.path);
		} else {
			seen.set(key, { id: d.id, timestamp: d.timestamp ?? "" });
		}
	}

	for (const path of duplicates) {
		try {
			await unlink(path);
		} catch {
			// Already gone - fine.
		}
	}
	if (duplicates.length > 0) {
		notes.push(
			`removed ${duplicates.length} duplicate file-change record(s) of ${changes.length}`,
		);
	}

	// --- 2. repair falsely-ended sessions ----------------------------------
	const sessions = await loadCategory<StoredSession>(basePath, "sessions");
	let repaired = 0;

	for (const session of sessions) {
		const s = session.data;
		if (!s.endTime) continue;

		const lastActivity = s.lastActivityTime ?? s.startTime;
		// endTime at or before the last activity means the session kept going
		// after it was marked finished - the Stop-as-session-end bug.
		if (lastActivity && s.endTime <= lastActivity) {
			delete s.endTime;
			if (s.status === "completed") s.status = "idle";
			try {
				await writeFile(
					session.path,
					JSON.stringify(s, null, 2),
					"utf-8",
				);
				repaired++;
			} catch {
				// Leave the record as-is if it cannot be rewritten.
			}
		}
	}
	if (repaired > 0) {
		notes.push(`repaired ${repaired} falsely-ended session(s)`);
	}

	return notes;
}

/**
 * Bring the store at basePath up to CURRENT_SCHEMA_VERSION.
 * Safe to call on every startup; a store already at the current version is
 * left untouched.
 */
export async function migrateStore(
	basePath: string,
): Promise<MigrationResult> {
	const fromVersion = await readVersion(basePath);
	const result: MigrationResult = {
		fromVersion,
		toVersion: fromVersion,
		applied: [],
		notes: [],
	};

	if (fromVersion >= CURRENT_SCHEMA_VERSION) return result;

	if (fromVersion < 1) {
		try {
			result.notes.push(...(await migrateV0ToV1(basePath)));
			result.applied.push("v0->v1");
		} catch (error) {
			result.notes.push(
				`v0->v1 failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			// Do not record the new version - it will be retried next start.
			return result;
		}
	}

	result.toVersion = CURRENT_SCHEMA_VERSION;
	await writeVersion(basePath, CURRENT_SCHEMA_VERSION);
	return result;
}
