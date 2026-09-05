/**
 * The context tray: persistence and the item algebra.
 *
 * A draft, not a delivery. No hook ever reads this file — arming renders it to
 * a frozen string and writes that elsewhere, which is what keeps "the preview
 * is the delivery" true now that a stage can be many items instead of one.
 *
 * Everything here is a pure function of the tray plus one operation, with the
 * single exception of read/write, so the ordering and byte arithmetic can be
 * tested without a store.
 */

import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	type ContextItem,
	type ContextItemKind,
	type ContextItemSource,
	type ContextTray,
	MAX_ITEM_BYTES,
	TRAY_FILE,
} from "@inspector-hook/protocol";

export function trayPath(storagePath: string): string {
	return join(storagePath, TRAY_FILE);
}

/** An empty tray. */
export function emptyTray(): ContextTray {
	return { version: 1, items: [], updatedAt: new Date().toISOString() };
}

/** The text an item contributes: the edit if there is one, else the original. */
export function effectiveText(item: ContextItem): string {
	return item.editedText ?? item.originalText;
}

/** Whether the user has changed this item. Derived, never stored. */
export function isEdited(item: ContextItem): boolean {
	return item.editedText !== undefined && item.editedText !== item.originalText;
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

/**
 * Read the tray, tolerating anything that is not one.
 *
 * A corrupt or half-written file yields an empty tray rather than throwing: the
 * tray is a scratch surface, and refusing to open the panel because a draft is
 * unreadable would be the wrong trade.
 */
export async function readTray(storagePath: string): Promise<ContextTray> {
	try {
		const raw = await readFile(trayPath(storagePath), "utf-8");
		const parsed = JSON.parse(raw) as ContextTray;
		if (!parsed || !Array.isArray(parsed.items)) return emptyTray();
		return {
			version: 1,
			items: parsed.items.filter((i) => i && typeof i.id === "string"),
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
		};
	} catch {
		return emptyTray();
	}
}

/** Write the tray, temp-file-plus-rename so a concurrent read never sees a fragment. */
export async function writeTray(
	storagePath: string,
	tray: ContextTray,
): Promise<ContextTray> {
	const next: ContextTray = { ...tray, updatedAt: new Date().toISOString() };
	const target = trayPath(storagePath);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, JSON.stringify(next, null, 2), "utf-8");
	await rename(temp, target);
	return next;
}

export interface NewItem {
	kind: ContextItemKind;
	title: string;
	text: string;
	source?: ContextItemSource;
}

/**
 * Add an item.
 *
 * Refuses one over MAX_ITEM_BYTES rather than accepting it and letting it eat
 * the whole budget: a single oversized item silently truncating everything
 * after it is the failure this cap exists to prevent.
 */
export function addItem(
	tray: ContextTray,
	item: NewItem,
): { tray: ContextTray; item?: ContextItem; reason?: string } {
	const text = String(item.text ?? "");
	if (!text.trim()) {
		return { tray, reason: "Nothing to add: the text is empty." };
	}
	const bytes = byteLength(text);
	if (bytes > MAX_ITEM_BYTES) {
		return {
			tray,
			reason:
				`That item is ${Math.round(bytes / 1024)} KB, over the ` +
				`${MAX_ITEM_BYTES / 1024} KB per-item limit. Trim it, or add the part you need.`,
		};
	}

	const created: ContextItem = {
		id: randomUUID(),
		kind: item.kind,
		title: item.title || "Untitled",
		originalText: text,
		include: true,
		source: item.source ?? {},
		addedAt: new Date().toISOString(),
		bytes,
	};
	return { tray: { ...tray, items: [...tray.items, created] }, item: created };
}

export function removeItem(tray: ContextTray, itemId: string): ContextTray {
	return { ...tray, items: tray.items.filter((i) => i.id !== itemId) };
}

/**
 * Edit an item's text, title or inclusion.
 *
 * `originalText` is never touched, so `resetItem` is deleting a field and
 * cannot lose the source.
 */
export function updateItem(
	tray: ContextTray,
	itemId: string,
	patch: { text?: string; title?: string; include?: boolean },
): { tray: ContextTray; reason?: string } {
	const index = tray.items.findIndex((i) => i.id === itemId);
	if (index === -1) return { tray, reason: `No item ${itemId} in the tray.` };

	const current = tray.items[index];
	const next: ContextItem = { ...current };

	if (patch.title !== undefined) next.title = patch.title;
	if (patch.include !== undefined) next.include = patch.include;
	if (patch.text !== undefined) {
		const bytes = byteLength(patch.text);
		if (bytes > MAX_ITEM_BYTES) {
			return {
				tray,
				reason: `That edit is over the ${MAX_ITEM_BYTES / 1024} KB per-item limit.`,
			};
		}
		// An edit back to the original stops being an edit, so the UI does not
		// keep calling an unchanged item "edited".
		next.editedText = patch.text === current.originalText ? undefined : patch.text;
	}
	next.bytes = byteLength(effectiveText(next));

	const items = [...tray.items];
	items[index] = next;
	return { tray: { ...tray, items } };
}

/** Drop the edit, restoring what the source produced. */
export function resetItem(
	tray: ContextTray,
	itemId: string,
): { tray: ContextTray; reason?: string } {
	const index = tray.items.findIndex((i) => i.id === itemId);
	if (index === -1) return { tray, reason: `No item ${itemId} in the tray.` };
	const current = tray.items[index];
	const next: ContextItem = { ...current };
	next.editedText = undefined;
	next.bytes = byteLength(next.originalText);
	const items = [...tray.items];
	items[index] = next;
	return { tray: { ...tray, items } };
}

/**
 * Reorder, by a list of ids.
 *
 * Order is the injection order, so this is a real operation rather than a
 * display preference. Ids not mentioned keep their relative order at the end
 * rather than being dropped — losing an item to a partial reorder would be a
 * silent deletion.
 */
export function reorderItems(tray: ContextTray, itemIds: string[]): ContextTray {
	const byId = new Map(tray.items.map((i) => [i.id, i]));
	const ordered: ContextItem[] = [];
	for (const id of itemIds) {
		const item = byId.get(id);
		if (item) {
			ordered.push(item);
			byId.delete(id);
		}
	}
	return { ...tray, items: [...ordered, ...byId.values()] };
}

export function clearTray(tray: ContextTray): ContextTray {
	return { ...tray, items: [] };
}
