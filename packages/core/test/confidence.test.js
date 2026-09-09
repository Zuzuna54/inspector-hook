/**
 * Confidence tiering for quality findings (M7).
 *
 * ## What this protects
 *
 * Raw knip on this repo flags 66 files, 64 of them false positives — a 97%
 * error rate. Tiering turns that into 1 high, 1 medium, 1 low and 64
 * suppressed. The rules that make that safe are the ones tested here, and two
 * of them are refusals:
 *
 *   - only GROUND TRUTH suppresses; a tool's opinion never does
 *   - absence from the graph is not evidence either way
 *
 * The second matters because `views/agents.js` had zero graph nodes purely
 * because it was newer than the last graph build.
 */

import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	groundTruthReport,
	groundTruthsFor,
	rankFindings,
	toRelative,
	webviewManifestStatus,
	webviewManifestTruth,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

const truth = (name, files) => ({ name, used: new Set(files) });

describe("confidence: only ground truth suppresses", () => {
	it("REGRESSION: the graph cannot veto knip, even when it disagrees", () => {
		// The measured case that decides this design: persistence/index.ts is
		// genuinely dead and the graph shows 6 edges, because graphify's
		// contains/imports relations are not reachability. Letting the graph
		// suppress would have HIDDEN a true finding.
		const findings = rankFindings(
			{
				knip: ["src/persistence/index.ts"],
				graphConnected: new Map([["src/persistence/index.ts", 6]]),
			},
			[],
		);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].confidence, "low", "downgraded, not removed");
		assert.notEqual(findings[0].confidence, "suppressed");
		assert.deepEqual(findings[0].agreed, ["knip"]);
		assert.match(findings[0].disagreed[0].because, /6 edges/);
	});

	it("a ground truth suppresses and names itself", () => {
		const findings = rankFindings(
			{
				knip: ["media/scripts/api.js"],
				graphOrphans: ["media/scripts/api.js"],
			},
			[truth("the webview manifest", ["media/scripts/api.js"])],
		);
		assert.equal(findings[0].confidence, "suppressed");
		assert.equal(findings[0].suppressedBy, "the webview manifest");
		// Both signals still recorded: suppression is not amnesia.
		assert.deepEqual(findings[0].agreed, ["graph-orphan", "knip"]);
	});
});

describe("confidence: the tiers", () => {
	it("two agreeing signals is high", () => {
		const f = rankFindings({ knip: ["a.js"], graphOrphans: ["a.js"] }, [])[0];
		assert.equal(f.confidence, "high");
		assert.deepEqual(f.agreed, ["graph-orphan", "knip"]);
	});

	it("one signal with nothing against it is medium", () => {
		// The Python case: knip is structurally blind, the graph is not.
		const f = rankFindings({ graphOrphans: ["lib/http_logger.py"] }, [])[0];
		assert.equal(f.confidence, "medium");
		assert.deepEqual(f.agreed, ["graph-orphan"]);
	});

	it("REGRESSION: absence from the graph is not disagreement", () => {
		// views/agents.js had 0 graph nodes only because it postdated the last
		// build. Treating that as "the graph says it is alive" would downgrade
		// every new file; treating it as agreement would inflate every one.
		const f = rankFindings(
			{ knip: ["views/agents.js"], graphUnknown: new Set(["views/agents.js"]) },
			[],
		)[0];
		assert.equal(f.confidence, "medium", "neither raised nor lowered");
		assert.deepEqual(f.disagreed, []);
		assert.deepEqual(f.agreed, ["knip"]);
	});

	it("orders high before medium before low before suppressed, stably", () => {
		const findings = rankFindings(
			{
				knip: ["low.js", "med.js", "high.js", "sup.js"],
				graphOrphans: ["high.js", "sup.js"],
				graphConnected: new Map([["low.js", 4]]),
			},
			[truth("t", ["sup.js"])],
		);
		assert.deepEqual(
			findings.map((f) => `${f.confidence}:${f.file}`),
			["high:high.js", "medium:med.js", "low:low.js", "suppressed:sup.js"],
		);
	});

	it("no signals means no findings", () => {
		assert.deepEqual(rankFindings({}, []), []);
	});
});

describe("confidence: the manifest is read from its source", () => {
	it("extracts the loaded scripts and styles", async () => {
		const root = await makeTempStore();
		dirs.push(root);
		await mkdir(join(root, "packages", "vscode", "src"), { recursive: true });
		await writeFile(
			join(root, "packages", "vscode", "src", "webview-html.ts"),
			`const MANIFEST = [
				["styles", "views", "quality.css"],
				["scripts", "views", "quality.js"],
				["scripts", "api", "inbound-quality.js"],
				["not-a-script", "ignored.txt"],
			];`,
			"utf-8",
		);

		const t = webviewManifestTruth(root);
		assert.ok(t);
		assert.ok(t.used.has("packages/vscode/media/scripts/views/quality.js"));
		assert.ok(t.used.has("packages/vscode/media/styles/views/quality.css"));
		assert.ok(
			!t.used.has("packages/vscode/media/not-a-script/ignored.txt"),
			"only scripts and styles",
		);
		assert.match(t.name, /webview-html\.ts/, "it names the file it read");
	});

	it("reads the manifest after it moved to webview-assets.ts", async () => {
		// The arrays were split out of webview-html.ts when that file crossed
		// the package's 600-line limit. Both locations are read, so a checkout
		// from either side of the split resolves.
		const root = await makeTempStore();
		await mkdir(join(root, "packages", "vscode", "src"), { recursive: true });
		await writeFile(
			join(root, "packages", "vscode", "src", "webview-assets.ts"),
			`export const SCRIPTS = [["scripts", "views", "skills.js"]];`,
			"utf-8",
		);
		const t = webviewManifestTruth(root);
		assert.ok(t);
		assert.ok(t.used.has("packages/vscode/media/scripts/views/skills.js"));
		assert.match(t.name, /webview-assets\.ts/);
	});

	it("REGRESSION: a MISSING manifest is reported, not silently ignored", async () => {
		// This is the failure the split actually caused. webviewManifestTruth
		// returns null for "no manifest", which the ranker reads as "suppress
		// nothing" -- so 64 of this repo's 66 knip findings went from
		// suppressed to high and nothing on screen said the suppressor had
		// moved. Only a test caught it, so now the scan carries the reason.
		const root = await makeTempStore();
		// A webview exists...
		await mkdir(join(root, "packages", "vscode", "media", "scripts"), {
			recursive: true,
		});
		// ...but no manifest names its files.
		await mkdir(join(root, "packages", "vscode", "src"), { recursive: true });

		const status = webviewManifestStatus(root);
		assert.equal(status.expected, true, "this project has a webview");
		assert.equal(status.files, 0);
		assert.match(status.error, /no asset manifest was found/);
		assert.match(status.error, /reported as real/);

		const report = groundTruthReport(root);
		assert.deepEqual(report.available, []);
		assert.equal(report.problems.length, 1, "the absence reaches the caller");
	});

	it("REGRESSION: a project with no webview gets NO suppression, not an empty one", () => {
		// An empty ground truth would look authoritative and suppress nothing
		// while implying it had checked. Returning null says "not applicable".
		assert.equal(webviewManifestTruth("/nonexistent/project"), null);
		assert.deepEqual(groundTruthsFor("/nonexistent/project"), []);
		// And it is not reported as a problem: there was nothing to vouch for.
		const status = webviewManifestStatus("/nonexistent/project");
		assert.equal(status.expected, false);
		assert.equal(status.error, undefined);
	});

	it("reads the REAL manifest of this repository, wherever it now lives", () => {
		// Resolved from the repo root rather than a hardcoded absolute path, so
		// this runs on CI and on another machine.
		const repo = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"..",
		);
		const t = webviewManifestTruth(repo);
		assert.ok(t, "this repo has a webview");
		assert.ok(t.used.size > 80, `manifest lists ${t.used.size} files`);
		assert.ok(t.used.has("packages/vscode/media/scripts/views/research.js"));
		// And nothing is reported missing, which is what the split broke.
		assert.deepEqual(groundTruthReport(repo).problems, []);
	});
});

describe("confidence: joining paths from different tools", () => {
	it("makes an absolute path project-relative", () => {
		// knip reports repo-relative, the graph reports repo-relative, sonar
		// reports absolute. They cannot be joined without normalising.
		assert.equal(toRelative("/a/b", "/a/b/src/x.ts"), "src/x.ts");
		assert.equal(toRelative("/a/b", "src/x.ts"), "src/x.ts");
	});

	it("leaves a path outside the project absolute rather than mangling it", () => {
		assert.equal(toRelative("/a/b", "/other/x.ts"), "/other/x.ts");
	});
});
