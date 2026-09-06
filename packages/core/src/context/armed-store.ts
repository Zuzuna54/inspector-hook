/**
 * Armed context: the immutable renders a hook actually reads.
 *
 * The tray is a draft; arming freezes it to a string and writes that here.
 * Nothing in this file is ever mutated by the UI, which is what removes any
 * read-modify-write race between a hook that must finish fast and a core that
 * may be mid-write.
 *
 * Two tiers live here, and they differ in exactly one rule:
 *
 *   now     <storage>/context/now/<sessionId>.json      hook: read -> rm -> print
 *   pinned  <storage>/context/pinned/<sessionId>.json   hook: read -> print
 *
 * ## Pinned is the dangerous one, and it is built to be reluctant
 *
 * `staged-context.ts` calls a pick that silently repeats into every session
 * "the failure mode hardest to notice and worst to inherit", and pinning is
 * that on purpose. So it is fenced:
 *
 *  - **Expiry is mandatory.** Not defaulted -- mandatory. A pin with no
 *    expiry is refused, 24h if unspecified, 7 days hard maximum. Of every
 *    mitigation here this is the one that matters: everything else makes a
 *    stale pin visible, this one makes it stop.
 *  - **Keyed to one session**, so it dies with the session rather than
 *    following you into unrelated work.
 *  - **The repeat cost is reported.** Pinned bytes are paid on EVERY prompt,
 *    so `estimatedRepeatBytes` says what it has cost so far rather than
 *    leaving the size to look like a one-off.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { InjectionPreview } from "@inspector-hook/protocol";

/** The tiers that go through this store. `nextSession` uses staged-context. */
export type ArmedTier = "now" | "pinned";

export interface ArmedContext {
	version: 1;
	tier: ArmedTier;
	/** Exactly what the hook will emit. Never re-rendered downstream. */
	text: string;
	bytes: number;
	armedAt: string;
	expiresAt: string;
	targetSessionId: string;
	label?: string;
	truncated?: boolean;
	/** Provenance, for the panel. The hook does not read this. */
	items?: Array<{ itemId: string; title: string; bytes: number }>;
	redactions?: InjectionPreview["redactions"];
	/** How many prompts have consumed this pin, so its cost is visible. */
	deliveries?: number;
}

/** 24 hours. */
export const DEFAULT_PIN_TTL_MS = 24 * 60 * 60 * 1000;
/** Seven days, and not negotiable: a pin outliving a week is not a decision. */
export const MAX_PIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A one-shot injection that was never collected should not wait forever. */
export const DEFAULT_NOW_TTL_MS = 60 * 60 * 1000;

/**
 * Session ids come from a hook payload and from the panel, and they are used to
 * build a path. Untrusted input in a path is the exact shape of the traversal
 * already fixed in the persistence store, so the id is validated rather than
 * escaped -- a real session id is a UUID and has no reason to contain anything
 * else.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeSessionId(id: unknown): id is string {
	return typeof id === "string" && SAFE_SESSION_ID.test(id);
}

export function tierDir(storagePath: string, tier: ArmedTier): string {
	return join(storagePath, "context", tier);
}

export function armedPath(
	storagePath: string,
	tier: ArmedTier,
	sessionId: string,
): string {
	return join(tierDir(storagePath, tier), `${sessionId}.json`);
}

/** Clamp a requested TTL into the tier's allowed range. */
export function resolveTtl(tier: ArmedTier, requested?: number): number {
	if (tier === "now") {
		return requested && requested > 0 ? Math.min(requested, MAX_PIN_TTL_MS) : DEFAULT_NOW_TTL_MS;
	}
	if (!requested || requested <= 0) return DEFAULT_PIN_TTL_MS;
	return Math.min(requested, MAX_PIN_TTL_MS);
}

export interface ArmInput {
	tier: ArmedTier;
	targetSessionId: string;
	text: string;
	bytes: number;
	label?: string;
	truncated?: boolean;
	ttlMs?: number;
	items?: ArmedContext["items"];
	redactions?: ArmedContext["redactions"];
}

export interface ArmResult {
	armed: boolean;
	entry?: ArmedContext;
	path?: string;
	reason?: string;
}

/**
 * Write a frozen payload for one session.
 *
 * Temp-file-plus-rename, so a hook firing mid-write cannot read a fragment and
 * inject half a sentence.
 */
export async function armContext(
	storagePath: string,
	input: ArmInput,
): Promise<ArmResult> {
	if (!isSafeSessionId(input.targetSessionId)) {
		return {
			armed: false,
			reason: "That session id is not one this store will build a path from.",
		};
	}
	if (!input.text || !input.text.trim()) {
		return { armed: false, reason: "Nothing to arm: the rendered text is empty." };
	}

	const now = Date.now();
	const entry: ArmedContext = {
		version: 1,
		tier: input.tier,
		text: input.text,
		bytes: input.bytes,
		armedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + resolveTtl(input.tier, input.ttlMs)).toISOString(),
		targetSessionId: input.targetSessionId,
		label: input.label,
		...(input.truncated ? { truncated: true } : {}),
		items: input.items,
		redactions: input.redactions,
		deliveries: 0,
	};

	const dir = tierDir(storagePath, input.tier);
	await mkdir(dir, { recursive: true });
	const target = armedPath(storagePath, input.tier, input.targetSessionId);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, JSON.stringify(entry, null, 2), "utf-8");
	await rename(temp, target);
	return { armed: true, entry, path: target };
}

/**
 * Read one armed payload, applying expiry.
 *
 * Expiry is evaluated on READ, so a stale entry reports as absent to the panel
 * and the hook alike without either having to remember to check. A missing or
 * unparseable `expiresAt` is treated as expired rather than as forever -- an
 * unbounded injection is the outcome this whole module is fenced against.
 */
export async function readArmed(
	storagePath: string,
	tier: ArmedTier,
	sessionId: string,
	now: number = Date.now(),
): Promise<ArmedContext | null> {
	if (!isSafeSessionId(sessionId)) return null;
	let raw: string;
	try {
		raw = await readFile(armedPath(storagePath, tier, sessionId), "utf-8");
	} catch {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;

	const entry = parsed as Partial<ArmedContext>;
	if (typeof entry.text !== "string" || !entry.text) return null;
	if (typeof entry.expiresAt !== "string") return null;
	const expires = Date.parse(entry.expiresAt);
	if (Number.isNaN(expires) || expires <= now) return null;

	return entry as ArmedContext;
}

/** Everything armed for one session, per tier. */
export async function readAllArmed(
	storagePath: string,
	sessionId: string,
	now: number = Date.now(),
): Promise<{ now: ArmedContext | null; pinned: ArmedContext | null }> {
	const [nowEntry, pinnedEntry] = await Promise.all([
		readArmed(storagePath, "now", sessionId, now),
		readArmed(storagePath, "pinned", sessionId, now),
	]);
	return { now: nowEntry, pinned: pinnedEntry };
}

/** Every session with something armed, for the panel's "what is live" view. */
export async function listArmed(
	storagePath: string,
	now: number = Date.now(),
): Promise<ArmedContext[]> {
	const out: ArmedContext[] = [];
	for (const tier of ["now", "pinned"] as ArmedTier[]) {
		let names: string[];
		try {
			names = await readdir(tierDir(storagePath, tier));
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const entry = await readArmed(storagePath, tier, name.slice(0, -5), now);
			if (entry) out.push(entry);
		}
	}
	return out;
}

/** Remove one armed payload. Safe when there is none. */
export async function disarmContext(
	storagePath: string,
	tier: ArmedTier,
	sessionId: string,
): Promise<boolean> {
	if (!isSafeSessionId(sessionId)) return false;
	try {
		await unlink(armedPath(storagePath, tier, sessionId));
		return true;
	} catch {
		return false;
	}
}

/**
 * What a pin has cost so far.
 *
 * Bytes times deliveries. A pin is paid on every prompt, and a number that only
 * ever showed the payload size would describe it as though it were a one-off.
 */
export function estimatedRepeatBytes(entry: ArmedContext | null): number {
	if (!entry || entry.tier !== "pinned") return 0;
	return entry.bytes * Math.max(entry.deliveries ?? 0, 1);
}
