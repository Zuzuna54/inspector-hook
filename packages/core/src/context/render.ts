/**
 * Render a tray to the exact text that will be injected.
 *
 * ONE function, called by both preview and arming. That is the whole design:
 * `staged-context.ts` guarantees the preview is the delivery, and the only way
 * to keep that guarantee across many items is to have a single renderer and no
 * second path that "does the same thing".
 *
 * Redaction happens here, at render time, rather than at edit time. The user
 * must see and edit the real text; what gets shipped is scanned. And because
 * preview calls this same function, the preview shows the redacted result — so
 * "what you see is what is sent" survives redaction too.
 */

import {
	type ContextItem,
	type ContextTray,
	type InjectionPreview,
	WARN_CONTEXT_BYTES,
} from "@inspector-hook/protocol";

import { redactString } from "../server/redaction.js";
import {
	MAX_CONTEXT_BYTES,
	truncateToBytes,
} from "../memory/staged-context.js";
import { effectiveText } from "./tray-store.js";

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

/** One item's section in the rendered output. */
function renderItem(item: ContextItem, text: string): string {
	return `### ${item.title}\n\n${text}`;
}

/**
 * Render the tray.
 *
 * Truncation is per item and then over the whole, and it is REPORTED per item.
 * A single whole-string cut would behead the last few sections without saying
 * which, so the caller could not tell what actually arrived.
 */
export function renderTray(tray: ContextTray): InjectionPreview {
	const sections: string[] = [];
	const itemReport: InjectionPreview["items"] = [];
	const byName = new Map<string, number>();
	let redacted = 0;
	let used = 0;

	for (const item of tray.items) {
		if (!item.include) {
			itemReport.push({
				itemId: item.id,
				title: item.title,
				bytes: 0,
				included: false,
				truncated: false,
			});
			continue;
		}

		const raw = effectiveText(item);
		const scrubbed = redactString(raw, { detail: true });
		redacted += scrubbed.redacted;
		for (const { name, count } of scrubbed.matches ?? []) {
			byName.set(name, (byName.get(name) ?? 0) + count);
		}

		// Budget what is left, not what one item wants.
		const remaining = MAX_CONTEXT_BYTES - used;
		let text = scrubbed.value;
		let cut = false;
		if (byteLength(text) > remaining) {
			text = truncateToBytes(text, Math.max(remaining, 0));
			cut = true;
		}

		const section = renderItem(item, text);
		sections.push(section);
		used += byteLength(section);
		itemReport.push({
			itemId: item.id,
			title: item.title,
			bytes: byteLength(text),
			included: true,
			truncated: cut,
		});
	}

	const text = sections.join("\n\n");
	const bytes = byteLength(text);

	return {
		text,
		bytes,
		truncated: itemReport.some((i) => i.truncated),
		warnThresholdExceeded: bytes > WARN_CONTEXT_BYTES,
		items: itemReport,
		redactions: {
			total: redacted,
			byName: [...byName.entries()]
				.map(([name, count]) => ({ name, count }))
				.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
		},
	};
}

/** How many items would actually contribute. */
export function includedCount(tray: ContextTray): number {
	return tray.items.filter((i) => i.include).length;
}
