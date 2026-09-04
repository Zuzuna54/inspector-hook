/**
 * The checked-in webview fixtures still match what this package produces.
 *
 * This is the test that makes the whole fixture scheme load-bearing. Without
 * it, `packages/vscode/test/fixtures/payloads.js` is just another hand-written
 * file that drifts away from reality -- which is the exact failure it exists to
 * end.
 *
 * With it, renaming `SessionDigest.body` or dropping `sessionId` fails HERE, in
 * the package that owns the contract, rather than silently in a webview suite
 * that would keep asserting against the old shape and keep passing.
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildFixtures, renderFixtureFile } from "./generate-fixtures.js";

const fixturePath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"vscode",
	"test",
	"fixtures",
	"payloads.js",
);

describe("webview payload fixtures", () => {
	it("match what the builders produce right now", async () => {
		const onDisk = await readFile(fixturePath, "utf8");
		const regenerated = await renderFixtureFile();
		assert.equal(
			regenerated,
			onDisk,
			"fixtures are stale -- run: cd packages/core && pnpm build && node test/generate-fixtures.js",
		);
	});

	it("record the ENVELOPE and the unwrapped payload as different shapes", async () => {
		// The distinction B1 and B2 both turned on. If these ever collapse into
		// one shape the fixtures stop being able to express the bug.
		const { digestEnvelope, digestPayload } = await buildFixtures();
		assert.ok(digestEnvelope.digest, "envelope wraps the digest");
		assert.equal(
			digestEnvelope.sessionId,
			undefined,
			"the envelope must NOT carry sessionId -- reading it there was the bug",
		);
		assert.equal(
			digestPayload.sessionId,
			digestEnvelope.digest.sessionId,
			"the unwrapped payload is what the webview must receive",
		);
	});

	it("carry body, and never a field called text", async () => {
		// `renderDigest` had a `digest.text ||` fallback for a field that has
		// never existed on any payload.
		const { digestPayload } = await buildFixtures();
		assert.equal(typeof digestPayload.body, "string");
		assert.ok(digestPayload.body.length > 0);
		assert.equal(digestPayload.text, undefined, "no payload has ever had .text");
	});

	it("record a staging refusal as a distinct shape from a staged context", async () => {
		const { stagedOk, stagedRefusal } = await buildFixtures();
		assert.equal(stagedOk.staged, true);
		assert.equal(typeof stagedOk.text, "string");
		assert.equal(stagedRefusal.staged, false);
		assert.equal(
			stagedRefusal.text,
			undefined,
			"a refusal has no text -- storing it as a staged context is what drew an empty success box",
		);
		assert.ok(stagedRefusal.reason);
	});

	it("include the un-index success shape that used to render as a refusal", async () => {
		const { results } = await buildFixtures();
		assert.deepEqual(results.unindexed, { changed: true });
	});
});
