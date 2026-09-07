/**
 * Saved bundles.
 *
 * The design decision worth guarding is what gets stored: THE ITEM LIST, never
 * rendered text. A rendered string is a snapshot of what the redactor knew and
 * what the cap was on the day it was saved, so a bundle loaded a month later
 * would ship material scrubbed by month-old patterns. Keeping items means it is
 * re-rendered through today's rules.
 *
 * It also keeps a bundle editable: loading one puts real items back in the tray,
 * which can be reordered, excluded and revised. A saved string could only be
 * sent or discarded.
 */

import { strict as assert } from "node:assert";
import { readdir } from "node:fs/promises";
import { after, describe, it } from "node:test";

import {
	addItem,
	deleteBundle,
	emptyTray,
	isSafeBundleId,
	listBundles,
	loadIntoTray,
	readBundle,
	renderTray,
	saveBundle,
	updateItem,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

async function store() {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	return basePath;
}

/** A tray with the given texts. */
function trayOf(...texts) {
	let tray = emptyTray();
	for (const [i, text] of texts.entries()) {
		tray = addItem(tray, { kind: "free_text", title: `item ${i}`, text }).tray;
	}
	return tray;
}

describe("saving a bundle", () => {
	it("keeps the items, not a rendered string", async () => {
		// The whole design. If this ever becomes `{text: "..."}` the bundle stops
		// being re-renderable and starts being a snapshot.
		const basePath = await store();
		const { bundle } = await saveBundle(basePath, {
			name: "auth context",
			items: trayOf("first", "second").items,
		});
		const back = await readBundle(basePath, bundle.id);
		assert.equal(back.items.length, 2);
		assert.equal(back.items[0].originalText, "first");
		assert.equal(back.text, undefined, "a rendered string was stored");
	});

	it("refuses an empty tray", async () => {
		const result = await saveBundle(await store(), { name: "empty", items: [] });
		assert.equal(result.ok, false);
		assert.match(result.reason, /nothing to save/i);
	});

	it("refuses a nameless bundle", async () => {
		const result = await saveBundle(await store(), {
			name: "   ",
			items: trayOf("x").items,
		});
		assert.equal(result.ok, false);
		assert.match(result.reason, /needs a name/i);
	});

	it("caps the name rather than storing an essay", async () => {
		const result = await saveBundle(await store(), {
			name: "x".repeat(200),
			items: trayOf("x").items,
		});
		assert.equal(result.ok, false);
		assert.match(result.reason, /80 characters/);
	});

	it("copies the items, so editing the tray afterwards changes nothing", async () => {
		// A bundle that mutated because its source tray was edited would be a
		// saved thing that does not stay saved.
		const basePath = await store();
		const tray = trayOf("original");
		const { bundle } = await saveBundle(basePath, { name: "b", items: tray.items });

		const { tray: edited } = updateItem(tray, tray.items[0].id, { text: "changed" });
		assert.equal(edited.items[0].editedText, "changed");

		const back = await readBundle(basePath, bundle.id);
		assert.equal(back.items[0].editedText, undefined, "the bundle followed the tray");
	});

	it("updates in place when given an id, keeping createdAt", async () => {
		const basePath = await store();
		const first = await saveBundle(basePath, { name: "v1", items: trayOf("a").items });
		const second = await saveBundle(basePath, {
			id: first.bundle.id,
			name: "v2",
			items: trayOf("a", "b").items,
		});
		assert.equal(second.bundle.id, first.bundle.id);
		assert.equal(second.bundle.name, "v2");
		assert.equal(second.bundle.createdAt, first.bundle.createdAt);
		assert.equal((await listBundles(basePath)).length, 1, "an update created a second file");
	});
});

describe("bundle ids build filenames, so they are validated", () => {
	it("rejects anything that could leave the directory", () => {
		for (const bad of ["../../etc/passwd", "a/b", "", "  ", null, 7]) {
			assert.equal(isSafeBundleId(bad), false, `${bad} was accepted`);
		}
	});

	it("refuses to save under a traversing id, and writes nothing", async () => {
		const basePath = await store();
		const result = await saveBundle(basePath, {
			id: "../../escaped",
			name: "x",
			items: trayOf("x").items,
		});
		assert.equal(result.ok, false);
		const entries = await readdir(basePath);
		assert.ok(!entries.includes("context"), "a refused save still created the tree");
	});

	it("returns null rather than reading through a traversing id", async () => {
		assert.equal(await readBundle(await store(), "../../../etc/passwd"), null);
	});
});

describe("listing and deleting", () => {
	it("lists newest first, with items so a size can be shown", async () => {
		const basePath = await store();
		await saveBundle(basePath, { name: "older", items: trayOf("a").items });
		await new Promise((r) => setTimeout(r, 5));
		await saveBundle(basePath, { name: "newer", items: trayOf("b").items });
		const bundles = await listBundles(basePath);
		assert.deepEqual(bundles.map((b) => b.name), ["newer", "older"]);
		assert.ok(bundles[0].items.length, "listed without items, so no size can be shown");
	});

	it("returns an empty list when there are none", async () => {
		assert.deepEqual(await listBundles(await store()), []);
	});

	it("deletes one and leaves the rest", async () => {
		const basePath = await store();
		const { bundle } = await saveBundle(basePath, { name: "a", items: trayOf("x").items });
		await saveBundle(basePath, { name: "b", items: trayOf("y").items });
		assert.equal(await deleteBundle(basePath, bundle.id), true);
		assert.deepEqual((await listBundles(basePath)).map((b) => b.name), ["b"]);
	});

	it("is safe to delete something that is not there", async () => {
		assert.equal(await deleteBundle(await store(), "nope"), false);
	});
});

describe("loading a bundle back", () => {
	it("replaces the tray by default", () => {
		const bundle = { items: trayOf("saved").items };
		const next = loadIntoTray(trayOf("current"), bundle);
		assert.deepEqual(next.items.map((i) => i.originalText), ["saved"]);
	});

	it("appends when asked", () => {
		const bundle = { items: trayOf("saved").items };
		const next = loadIntoTray(trayOf("current"), bundle, "append");
		assert.deepEqual(next.items.map((i) => i.originalText), ["current", "saved"]);
	});

	it("gives fresh ids, so loading twice makes two independent copies", () => {
		// Sharing ids would mean editing one copy silently edited the other.
		const bundle = { items: trayOf("x").items };
		const once = loadIntoTray(emptyTray(), bundle);
		const twice = loadIntoTray(once, bundle, "append");
		const [a, b] = twice.items;
		assert.notEqual(a.id, b.id);
		assert.notEqual(a.id, bundle.items[0].id, "reused the bundle's own id");
	});

	it("re-renders through TODAY's redaction, not the day it was saved", async () => {
		// The reason items are stored rather than text. A secret that a newer
		// pattern catches must be caught when the bundle is loaded, not left as
		// whatever the renderer produced months ago.
		const basePath = await store();
		const tray = trayOf("token is ghp_aaaaaaaaaaaaaaaaaaaaaaaa here");
		const { bundle } = await saveBundle(basePath, { name: "b", items: tray.items });

		const loaded = loadIntoTray(emptyTray(), await readBundle(basePath, bundle.id));
		const preview = renderTray(loaded);
		assert.ok(
			!preview.text.includes("ghp_aaaaaaaaaaaaaaaaaaaaaaaa"),
			"a saved secret shipped unredacted",
		);
		assert.ok(preview.redactions.total > 0, "redaction did not run on load");
	});

	it("keeps a bundle usable when its source is gone", async () => {
		// Items carry their own originalText, so a bundle citing a deleted
		// session still works — and the source usually IS gone: 27 of 33 memory
		// files cite an origin session and none of those sessions still exist.
		const basePath = await store();
		let tray = emptyTray();
		tray = addItem(tray, {
			kind: "session_digest",
			title: "from a session",
			text: "what happened",
			source: { sessionId: "long-since-deleted" },
		}).tray;
		const { bundle } = await saveBundle(basePath, { name: "b", items: tray.items });

		const loaded = loadIntoTray(emptyTray(), await readBundle(basePath, bundle.id));
		assert.equal(loaded.items[0].originalText, "what happened");
		assert.equal(loaded.items[0].source.sessionId, "long-since-deleted");
	});
});
