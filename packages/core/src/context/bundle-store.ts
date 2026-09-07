/**
 * Saved bundles: a tray worth keeping.
 *
 * "Build the auth context once, inject it into any session later." The tray is
 * a scratch surface that gets cleared; a bundle is the same composition kept.
 *
 * ## Bundles store the ITEM LIST, never rendered text
 *
 * This is the whole design decision, and the reason is not storage size. A
 * rendered string is a snapshot of what the redactor knew and what the cap was
 * on the day it was saved. Keeping items means a bundle loaded a month later is
 * re-rendered through today's redaction patterns and today's budget — so a
 * secret pattern added since is applied to old material rather than a stale
 * copy shipping it into a session.
 *
 * It also keeps a bundle EDITABLE. Loading one puts real items back in the
 * tray, which can be reordered, excluded and revised; a saved string could only
 * be sent or discarded.
 *
 * Each item keeps its `originalText`, so a bundle citing a deleted session or a
 * memory file that has since been removed still works. That is deliberate: the
 * source may be gone by the time you want the context again — 27 of 33 memory
 * files on this machine cite an origin session and none of those sessions still
 * exist.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ContextItem, ContextTray } from "@inspector-hook/protocol";

export interface ContextBundle {
	version: 1;
	id: string;
	name: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
	/** The items themselves. Re-rendered on load, never a stored string. */
	items: ContextItem[];
}

/** Enough to be a name; short enough to fit a list row. */
const MAX_NAME = 80;

/**
 * A bundle id becomes a filename, and the name it is derived from comes from a
 * text field in the panel. Generated rather than derived for exactly that
 * reason — there is no sanitising to get wrong if the id was never user input.
 */
function newId(): string {
	return randomUUID();
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeBundleId(id: unknown): id is string {
	return typeof id === "string" && SAFE_ID.test(id);
}

export function bundlesDir(storagePath: string): string {
	return join(storagePath, "context", "bundles");
}

export function bundlePath(storagePath: string, id: string): string {
	return join(bundlesDir(storagePath), `${id}.json`);
}

export interface SaveResult {
	ok: boolean;
	bundle?: ContextBundle;
	reason?: string;
}

/**
 * Save a tray as a named bundle, or update one.
 *
 * Refuses an empty tray and an empty name rather than creating something with
 * nothing in it or nothing to call it — both are states a list can only render
 * confusingly.
 */
export async function saveBundle(
	storagePath: string,
	params: { name: string; description?: string; items: ContextItem[]; id?: string },
): Promise<SaveResult> {
	const name = String(params.name ?? "").trim();
	if (!name) return { ok: false, reason: "A bundle needs a name." };
	if (name.length > MAX_NAME) {
		return { ok: false, reason: `Names are capped at ${MAX_NAME} characters.` };
	}
	if (!params.items?.length) {
		return { ok: false, reason: "The tray is empty, so there is nothing to save." };
	}
	if (params.id !== undefined && !isSafeBundleId(params.id)) {
		return { ok: false, reason: "That bundle id is not one this store will use." };
	}

	const now = new Date().toISOString();
	const existing = params.id ? await readBundle(storagePath, params.id) : null;

	const bundle: ContextBundle = {
		version: 1,
		id: params.id ?? newId(),
		name,
		description: params.description?.trim() || undefined,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		// Copied, not referenced: a bundle must not change because the tray it
		// came from was edited afterwards.
		items: params.items.map((item) => ({ ...item })),
	};

	await mkdir(bundlesDir(storagePath), { recursive: true });
	const target = bundlePath(storagePath, bundle.id);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, JSON.stringify(bundle, null, 2), "utf-8");
	await rename(temp, target);
	return { ok: true, bundle };
}

/** One bundle, or null. */
export async function readBundle(
	storagePath: string,
	id: string,
): Promise<ContextBundle | null> {
	if (!isSafeBundleId(id)) return null;
	try {
		const parsed = JSON.parse(
			await readFile(bundlePath(storagePath, id), "utf-8"),
		) as ContextBundle;
		if (!parsed || !Array.isArray(parsed.items)) return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Every bundle, newest first.
 *
 * Returns items too. A bundle list without them could not show a size, and a
 * saved composition whose cost is invisible until you load it is the same
 * problem the tray's byte total exists to solve.
 */
export async function listBundles(storagePath: string): Promise<ContextBundle[]> {
	let names: string[];
	try {
		names = await readdir(bundlesDir(storagePath));
	} catch {
		return [];
	}
	const out: ContextBundle[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const bundle = await readBundle(storagePath, name.slice(0, -5));
		if (bundle) out.push(bundle);
	}
	return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function deleteBundle(storagePath: string, id: string): Promise<boolean> {
	if (!isSafeBundleId(id)) return false;
	try {
		await unlink(bundlePath(storagePath, id));
		return true;
	} catch {
		return false;
	}
}

/**
 * Put a bundle's items into a tray.
 *
 * `replace` swaps the tray for the bundle; `append` adds to what is there.
 * Items are given fresh ids on the way in, so loading the same bundle twice
 * produces two independent copies rather than two references that a single
 * edit would change together.
 */
export function loadIntoTray(
	tray: ContextTray,
	bundle: ContextBundle,
	mode: "replace" | "append" = "replace",
): ContextTray {
	const copies = bundle.items.map((item) => ({
		...item,
		id: randomUUID(),
		addedAt: new Date().toISOString(),
	}));
	return {
		...tray,
		items: mode === "append" ? [...tray.items, ...copies] : copies,
	};
}
