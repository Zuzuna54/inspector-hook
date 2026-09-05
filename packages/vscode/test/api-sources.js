/**
 * Every file that makes up the webview's API layer.
 *
 * api.js has been split three times — mergeActivity, the senders, then the
 * inbound handlers — and each time a test that read only "scripts/api.js"
 * stopped checking anything without failing. That is the vacuous-guard shape
 * these suites exist to catch, so the list lives in one place and every test
 * that scrapes the API layer reads from here.
 *
 * Discovered from disk rather than enumerated, so a new module is covered the
 * moment it exists instead of the next time someone remembers.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readMedia } from "./harness.js";

const mediaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "media");

/** Relative paths of api.js plus everything under scripts/api/. */
export function apiSourcePaths() {
	const paths = ["scripts/api.js"];
	for (const entry of readdirSync(join(mediaDir, "scripts", "api"), {
		withFileTypes: true,
	})) {
		if (entry.isFile() && entry.name.endsWith(".js")) {
			paths.push(`scripts/api/${entry.name}`);
		}
	}
	return paths.sort();
}

/** The concatenated source of the whole API layer. */
export function apiSource() {
	return apiSourcePaths().map((p) => readMedia(p)).join("\n");
}
