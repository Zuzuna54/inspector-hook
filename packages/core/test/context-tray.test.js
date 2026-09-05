/**
 * The context tray.
 *
 * Staging held exactly one item; picking a second replaced the first, so
 * "compose the context for this session" was not expressible. These cover the
 * two properties that make the multi-item version safe rather than merely
 * bigger:
 *
 *   - the original text of an item is never mutated, so an edit is always
 *     reversible and can never lose the source
 *   - ONE renderer produces both the preview and the armed text, so the
 *     "preview is the delivery" guarantee survives the jump from one item to
 *     many instead of quietly becoming two code paths that agree today
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import {
	addItem,
	clearTray,
	effectiveText,
	emptyTray,
	isEdited,
	readTray,
	removeItem,
	renderTray,
	reorderItems,
	resetItem,
	updateItem,
	writeTray,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** A tray with the given texts, in order. */
function trayOf(...texts) {
	let tray = emptyTray();
	texts.forEach((text, i) => {
		const result = addItem(tray, {
			kind: "free_text",
			title: `item ${i}`,
			text,
		});
		assert.ok(result.item, result.reason);
		tray = result.tray;
	});
	return tray;
}

describe("tray items", () => {
	it("accumulates rather than replacing", () => {
		// The whole point. Single-item staging made a second pick destroy the
		// first, silently.
		const tray = trayOf("first", "second", "third");
		assert.deepEqual(
			tray.items.map((i) => i.originalText),
			["first", "second", "third"],
		);
	});

	it("refuses an empty item instead of adding a blank section", () => {
		const { item, reason } = addItem(emptyTray(), {
			kind: "free_text",
			title: "x",
			text: "   ",
		});
		assert.equal(item, undefined);
		assert.match(reason, /empty/i);
	});

	it("refuses an item over the per-item cap, and says how big it was", () => {
		// A single oversized item must not silently eat the budget and truncate
		// everything after it.
		const { item, reason } = addItem(emptyTray(), {
			kind: "free_text",
			title: "huge",
			text: "x".repeat(70 * 1024),
		});
		assert.equal(item, undefined);
		assert.match(reason, /70 KB/);
		assert.match(reason, /per-item limit/);
	});

	it("removes by id and leaves the rest in order", () => {
		const tray = trayOf("a", "b", "c");
		const after = removeItem(tray, tray.items[1].id);
		assert.deepEqual(after.items.map((i) => i.originalText), ["a", "c"]);
	});

	it("reorders, and never drops an id the caller forgot to mention", () => {
		// A partial reorder losing an item would be a silent deletion.
		const tray = trayOf("a", "b", "c");
		const [a, , c] = tray.items.map((i) => i.id);
		const reordered = reorderItems(tray, [c, a]);
		assert.deepEqual(
			reordered.items.map((i) => i.originalText),
			["c", "a", "b"],
		);
		assert.equal(reordered.items.length, 3);
	});
});

describe("editing preserves the original", () => {
	it("keeps originalText untouched", () => {
		const tray = trayOf("from the source");
		const { tray: edited } = updateItem(tray, tray.items[0].id, {
			text: "my version",
		});
		const item = edited.items[0];
		assert.equal(item.originalText, "from the source");
		assert.equal(item.editedText, "my version");
		assert.equal(effectiveText(item), "my version");
		assert.equal(isEdited(item), true);
	});

	it("reset restores the source exactly", () => {
		const tray = trayOf("from the source");
		const { tray: edited } = updateItem(tray, tray.items[0].id, { text: "changed" });
		const { tray: back } = resetItem(edited, edited.items[0].id);
		assert.equal(effectiveText(back.items[0]), "from the source");
		assert.equal(isEdited(back.items[0]), false);
	});

	it("an edit back to the original stops counting as an edit", () => {
		const tray = trayOf("same");
		const { tray: edited } = updateItem(tray, tray.items[0].id, { text: "same" });
		assert.equal(isEdited(edited.items[0]), false, "still reported as edited");
	});

	it("reports a missing item rather than silently doing nothing", () => {
		const { reason } = updateItem(emptyTray(), "nope", { text: "x" });
		assert.match(reason, /No item nope/);
	});

	it("recomputes the byte cost after an edit", () => {
		const tray = trayOf("short");
		const { tray: edited } = updateItem(tray, tray.items[0].id, {
			text: "a much longer replacement",
		});
		assert.equal(edited.items[0].bytes, Buffer.byteLength("a much longer replacement"));
	});
});

describe("rendering is the delivery", () => {
	it("includes every item, in tray order", () => {
		const preview = renderTray(trayOf("alpha", "beta"));
		assert.ok(preview.text.indexOf("alpha") < preview.text.indexOf("beta"));
		assert.equal(preview.items.filter((i) => i.included).length, 2);
	});

	it("omits an excluded item but keeps it in the tray", () => {
		const tray = trayOf("kept", "skipped");
		const { tray: updated } = updateItem(tray, tray.items[1].id, { include: false });
		const preview = renderTray(updated);
		assert.match(preview.text, /kept/);
		assert.ok(!preview.text.includes("skipped"), "an excluded item was rendered");
		assert.equal(updated.items.length, 2, "exclusion must not delete");
		assert.equal(preview.items.find((i) => !i.included).bytes, 0);
	});

	it("renders the EDITED text, not the original", () => {
		const tray = trayOf("original text");
		const { tray: edited } = updateItem(tray, tray.items[0].id, { text: "edited text" });
		const preview = renderTray(edited);
		assert.match(preview.text, /edited text/);
		assert.ok(!preview.text.includes("original text"));
	});

	it("redacts secrets at render time and reports which kinds", () => {
		// A second pass, because most tray content never passes through ingest
		// redaction: free text is typed into the panel, memory files are read
		// straight from disk.
		const tray = trayOf("here is ghp_aaaaaaaaaaaaaaaaaaaaaaaa in the notes");
		const preview = renderTray(tray);
		assert.ok(!preview.text.includes("ghp_aaaaaaaaaaaaaaaaaaaaaaaa"), "a secret shipped");
		assert.equal(preview.redactions.total, 1);
		assert.deepEqual(preview.redactions.byName, [{ name: "github-token", count: 1 }]);
	});

	it("attributes a value matching two patterns to both", () => {
		// "token: ghp_..." trips github-token AND assigned-secret. Reporting one
		// would understate what was removed, and the count is the thing a person
		// uses to decide whether a redaction was a false positive.
		const preview = renderTray(trayOf("token: ghp_bbbbbbbbbbbbbbbbbbbbbbbb"));
		assert.equal(preview.redactions.total, 2);
		assert.deepEqual(
			preview.redactions.byName.map((r) => r.name).sort(),
			["assigned-secret", "github-token"],
		);
	});

	it("warns past the advisory threshold without refusing", () => {
		const tray = trayOf("x".repeat(40 * 1024));
		const preview = renderTray(tray);
		assert.equal(preview.warnThresholdExceeded, true);
		assert.equal(preview.truncated, false, "the advisory threshold must not truncate");
	});

	it("reports truncation per item, not just overall", () => {
		// A whole-string cut would behead the last sections without saying
		// which, so a caller could not tell what actually arrived.
		let tray = emptyTray();
		for (let i = 0; i < 6; i++) {
			tray = addItem(tray, {
				kind: "free_text",
				title: `big ${i}`,
				text: "y".repeat(60 * 1024),
			}).tray;
		}
		const preview = renderTray(tray);
		assert.equal(preview.truncated, true);
		assert.ok(
			preview.items.some((i) => i.truncated),
			"truncation was not attributed to any item",
		);
	});

	it("an empty tray renders empty rather than throwing", () => {
		const preview = renderTray(emptyTray());
		assert.equal(preview.text, "");
		assert.equal(preview.bytes, 0);
		assert.deepEqual(preview.items, []);
	});
});

describe("tray persistence", () => {
	async function store() {
		const basePath = await makeTempStore();
		dirs.push(basePath);
		return basePath;
	}

	it("round-trips", async () => {
		const basePath = await store();
		await writeTray(basePath, trayOf("one", "two"));
		const back = await readTray(basePath);
		assert.deepEqual(back.items.map((i) => i.originalText), ["one", "two"]);
	});

	it("returns an empty tray when there is none", async () => {
		const back = await readTray(await store());
		assert.deepEqual(back.items, []);
	});

	it("returns an empty tray for a corrupt file rather than throwing", async () => {
		// The tray is a scratch surface. Refusing to open the panel because a
		// draft is unreadable would be the wrong trade.
		const basePath = await store();
		const { writeFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		await writeFile(join(basePath, "context-tray.json"), "{ not json", "utf-8");
		assert.deepEqual((await readTray(basePath)).items, []);
	});

	it("clearing empties the items and persists", async () => {
		const basePath = await store();
		await writeTray(basePath, clearTray(trayOf("a", "b")));
		assert.deepEqual((await readTray(basePath)).items, []);
	});
});
