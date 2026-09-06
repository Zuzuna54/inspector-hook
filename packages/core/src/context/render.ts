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

		// Budget what is LEFT, not what one item wants. The heading costs bytes
		// too, so it is charged before the body rather than after -- otherwise
		// the last item's heading pushes the total past the cap it just fitted
		// under.
		// Charged in BYTES, and including the "\n\n" that will join this section
		// to the previous one. Measuring the heading in characters and ignoring
		// the joiner left the total 101 bytes over a 256 KB cap -- close enough
		// to look right, which is the least useful kind of nearly.
		const heading = byteLength(renderItem(item, ""));
		const joiner = sections.length > 0 ? 2 : 0;
		const remaining = Math.max(MAX_CONTEXT_BYTES - used - heading - joiner, 0);

		// Nothing left for even the heading: emit NO section at all. Rendering an
		// empty heading still costs bytes, and once the budget is gone every
		// remaining item added one -- which is how a cap of 262,144 produced
		// 262,216 with twelve items and 265,096 with five hundred. Reported as
		// truncated with zero bytes, so the item is visibly dropped rather than
		// silently contributing nothing but a title.
		if (remaining <= 0) {
			itemReport.push({
				itemId: item.id,
				title: item.title,
				bytes: 0,
				included: true,
				truncated: true,
			});
			continue;
		}

		const before = byteLength(scrubbed.value);
		const text = before > remaining ? truncateToBytes(scrubbed.value, remaining) : scrubbed.value;
		const after = byteLength(text);

		// Truncated means SOMETHING WAS REMOVED, not that the branch was taken.
		// It used to be set before comparing, so items reported `truncated:true`
		// while carrying every byte they arrived with -- a warning about a loss
		// that had not happened, which teaches a reader to ignore the flag.
		const cut = after < before;

		const section = renderItem(item, text);
		used += byteLength(section) + joiner;
		sections.push(section);
		itemReport.push({
			itemId: item.id,
			title: item.title,
			bytes: after,
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
