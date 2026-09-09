/**
 * Scanning a project, and refusing to lie about what ran (M7).
 *
 * The rule the whole module exists to keep: **"0 findings" and "nothing ran"
 * must never render the same.** A project with no Sonar connection showing as
 * clean, or one where knip crashed showing zero unused files, is the
 * false-reporting class this codebase treats as its priority bug.
 *
 * Tool commands are injectable, so none of knip, madge or sonar needs to be
 * installed for these to run — and the fakes let the failure modes be tested,
 * which is the part that matters.
 */

import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	parseKnipFiles,
	parseMadgeCycles,
	parseSonarSecrets,
	projectStoreId,
	QualityStore,
	scanProject,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/**
 * A project on disk, optionally with a package.json.
 *
 * Real source files are written because applicability is now LANGUAGE-driven:
 * a package.json with no JavaScript in it correctly gets `not-applicable` for
 * knip, which is stricter than the old package.json-only check.
 */
async function makeProject({ pkg = true, languages = ["ts-js"] } = {}) {
	const root = await makeTempStore();
	dirs.push(root);
	if (pkg) await writeFile(join(root, "package.json"), "{}", "utf-8");
	await mkdir(join(root, "src"), { recursive: true });
	const files = {
		"ts-js": ["a.ts", "b.ts", "c.ts"],
		python: ["a.py", "b.py", "c.py"],
		go: ["a.go", "b.go", "c.go"],
		rust: ["a.rs", "b.rs", "c.rs"],
	};
	for (const language of languages) {
		for (const name of files[language] ?? []) {
			await writeFile(join(root, "src", name), "// x\n", "utf-8");
		}
	}
	return {
		root,
		name: "fixture",
		transcriptDir: "-fixture",
		exists: true,
		hasGit: false,
		hasPackageJson: pkg,
		hasTsconfig: false,
		hasGraph: false,
		tools: {
			knip: pkg,
			madge: pkg,
			graphify: true,
			sonarSecrets: true,
		},
		rootSource: "transcript",
	};
}

/** A command that prints the given stdout and exits 0. */
const emits = (text) => [
	"node",
	["-e", `process.stdout.write(${JSON.stringify(text)})`],
];
/** A command that does not exist. */
const missing = ["definitely-not-a-real-binary-xyz", []];
/** A command that exits non-zero with no output. */
const broken = ["node", ["-e", "process.exit(3)"]];

describe("quality: parsing tool output", () => {
	it("knip: a file with symbol findings is NOT an unused file", () => {
		// An entry carrying `exports` is about symbols inside a file that IS
		// used. Counting it as an unused file would report every file with one
		// stale export as dead.
		const stdout = JSON.stringify({
			issues: [
				{ file: "src/dead.ts" },
				{ file: "src/alive.ts", exports: [{ name: "stale" }] },
				{ file: "src/also-alive.ts", dependencies: ["lodash"] },
			],
		});
		assert.deepEqual(parseKnipFiles(stdout), ["src/dead.ts"]);
	});

	it("knip: malformed output yields nothing rather than throwing", () => {
		for (const bad of ["", "not json", "{}", '{"issues":null}']) {
			assert.deepEqual(parseKnipFiles(bad), [], JSON.stringify(bad));
		}
	});

	it("madge: cycles come back as arrays of paths", () => {
		const out = parseMadgeCycles(JSON.stringify([["a.ts", "b.ts"], []]));
		assert.deepEqual(out, [{ cycle: ["a.ts", "b.ts"] }]);
		assert.deepEqual(parseMadgeCycles("nope"), []);
	});

	it("REGRESSION: sonar secrets keeps the RULE, never the secret", () => {
		// This report is persisted to disk and served over IPC. Copying a live
		// credential into it would turn a security tool into a second leak.
		const stdout = JSON.stringify([
			{
				file: "src/config.ts",
				rule: "aws-access-key",
				line: 12,
				secret: "AKIAIOSFODNN7EXAMPLE",
				match: "AKIAIOSFODNN7EXAMPLE",
			},
		]);
		const out = parseSonarSecrets(stdout);
		assert.deepEqual(out, [
			{ file: "src/config.ts", rule: "aws-access-key", line: 12 },
		]);
		const serialised = JSON.stringify(out);
		assert.ok(!serialised.includes("AKIA"), "no secret value survives");
	});

	it("sonar: accepts both a bare array and an issues wrapper", () => {
		assert.equal(
			parseSonarSecrets('[{"path":"a.ts","ruleKey":"r"}]').length,
			1,
		);
		assert.equal(
			parseSonarSecrets('{"issues":[{"file":"a.ts","rule":"r"}]}').length,
			1,
		);
		assert.deepEqual(parseSonarSecrets("garbage"), []);
	});
});

describe("quality: a tool that did not run never reports zero", () => {
	it("REGRESSION: a missing tool is `unavailable`, not `ok` with no findings", async () => {
		const project = await makeProject();
		const report = await scanProject(project, {
			commands: { knip: missing, madge: missing, "sonar-secrets": missing },
			timeoutMs: 20_000,
		});

		for (const tool of ["knip", "madge", "sonar-secrets"]) {
			const result = report.tools.find((t) => t.tool === tool);
			assert.equal(result.status, "unavailable", tool);
			assert.ok(result.error, `${tool} says why`);
		}
		// And the summary is explicit about it.
		assert.deepEqual(report.summary.measured, []);
		assert.ok(report.summary.unmeasured.includes("knip"));
		assert.equal(report.summary.high, 0, "zero, but unmeasured says why");
	});

	it("a tool that ran and broke is `failed`, distinct from unavailable", async () => {
		const project = await makeProject();
		const report = await scanProject(project, {
			commands: { knip: broken, madge: missing, "sonar-secrets": missing },
			timeoutMs: 20_000,
		});
		assert.equal(report.tools.find((t) => t.tool === "knip").status, "failed");
	});

	it("knip on a project with no package.json is `not-applicable`, with a reason", async () => {
		// Not a failure: knip without entry points reports the whole tree as
		// unused, so not running it is correct and must be distinguishable.
		const project = await makeProject({ pkg: false });
		const report = await scanProject(project, {
			commands: { "sonar-secrets": missing },
			timeoutMs: 20_000,
		});
		const knip = report.tools.find((t) => t.tool === "knip");
		assert.equal(knip.status, "not-applicable");
		assert.match(knip.reason, /package\.json/);
	});

	it("a project that no longer exists reports every tool not-applicable", async () => {
		const report = await scanProject({
			root: "/tmp/gone-project-xyz",
			name: "gone",
			transcriptDir: "-gone",
			exists: false,
			hasGit: false,
			hasPackageJson: false,
			hasTsconfig: false,
			hasGraph: false,
			tools: {
				knip: false,
				madge: false,
				graphify: false,
				sonarSecrets: false,
			},
			rootSource: "transcript",
		});
		// One per registry analyser plus graphify. A hardcoded 4 was the old
		// shape; the point of the registry is that this grows with languages.
		assert.ok(report.tools.length >= 7, `got ${report.tools.length} tools`);
		assert.ok(report.tools.every((t) => t.status === "not-applicable"));
		assert.deepEqual(report.summary.measured, []);
	});

	it("REGRESSION: a non-zero exit WITH output is a successful run", async () => {
		// knip and madge exit non-zero when they FIND something. Treating that
		// as a failure would report every project with dead code as unscannable.
		const project = await makeProject();
		const findings = JSON.stringify({ issues: [{ file: "src/dead.ts" }] });
		const report = await scanProject(project, {
			commands: {
				knip: [
					"node",
					[
						"-e",
						`process.stdout.write(${JSON.stringify(findings)}); process.exit(1)`,
					],
				],
				madge: missing,
				"sonar-secrets": missing,
			},
			timeoutMs: 20_000,
		});
		assert.equal(report.tools.find((t) => t.tool === "knip").status, "ok");
		assert.ok(report.findings.some((f) => f.file === "src/dead.ts"));
	});
});

describe("quality: findings and the graph", () => {
	it("ranks a knip finding with no contradicting signal as medium", async () => {
		const project = await makeProject();
		const report = await scanProject(project, {
			commands: {
				knip: emits(JSON.stringify({ issues: [{ file: "src/dead.ts" }] })),
				madge: missing,
				"sonar-secrets": missing,
			},
			timeoutMs: 20_000,
		});
		const finding = report.findings.find((f) => f.file === "src/dead.ts");
		assert.equal(finding.confidence, "medium");
		assert.deepEqual(finding.agreed, ["knip"]);
	});

	it("reports cycles from madge", async () => {
		const project = await makeProject();
		const report = await scanProject(project, {
			commands: {
				knip: missing,
				madge: emits(JSON.stringify([["a.ts", "b.ts", "a.ts"]])),
				"sonar-secrets": missing,
			},
			timeoutMs: 20_000,
		});
		assert.equal(report.summary.circular, 1);
		assert.deepEqual(report.circular[0].cycle, ["a.ts", "b.ts", "a.ts"]);
	});

	it("graphify is `unavailable` with a remedy when no graph exists", async () => {
		const project = await makeProject();
		const report = await scanProject(project, {
			commands: { knip: missing, madge: missing, "sonar-secrets": missing },
			timeoutMs: 20_000,
		});
		const g = report.tools.find((t) => t.tool === "graphify");
		assert.equal(g.status, "unavailable");
		assert.match(g.error, /graphify update/);
		assert.equal(report.graph, undefined);
	});

	it("analyses a graph when one is present", async () => {
		const project = await makeProject();
		await mkdir(join(project.root, "graphify-out"), { recursive: true });
		await writeFile(
			join(project.root, "graphify-out", "graph.json"),
			JSON.stringify({
				nodes: [
					{
						id: "a",
						label: "a",
						file_type: "code",
						source_file: "a.ts",
						source_location: "L1",
						community: 1,
					},
					{
						id: "b",
						label: "b",
						file_type: "code",
						source_file: "b.ts",
						source_location: "L1",
						community: 1,
					},
					{
						id: "orphan",
						label: "orphan",
						file_type: "code",
						source_file: "gone.ts",
						source_location: "L1",
						community: 2,
					},
				],
				links: [
					{
						source: "a",
						target: "b",
						relation: "calls",
						confidence: "EXTRACTED",
						weight: 1,
						source_file: "a.ts",
						source_location: "L1",
					},
				],
			}),
			"utf-8",
		);
		const report = await scanProject(project, {
			commands: { knip: missing, madge: missing, "sonar-secrets": missing },
			timeoutMs: 20_000,
		});
		assert.equal(report.tools.find((t) => t.tool === "graphify").status, "ok");
		assert.equal(report.graph.nodes, 3);
		assert.equal(report.graph.orphanCount, 1);
		assert.equal(report.graph.rot.checked, true);
	});
});

describe("quality: stored history and trends", () => {
	const report = (over = {}) => ({
		projectRoot: "/p",
		projectName: "p",
		scannedAt: over.scannedAt ?? "2026-09-09T10:00:00.000Z",
		durationMs: 100,
		tools: [],
		findings: [],
		circular: [],
		secrets: [],
		summary: {
			high: over.high ?? 0,
			medium: 0,
			low: 0,
			suppressed: 0,
			circular: 0,
			secrets: 0,
			measured: over.measured ?? ["knip"],
			unmeasured: [],
		},
		...over,
	});

	/** An in-memory persistence stand-in. */
	function fakePersistence() {
		const docs = new Map();
		return {
			docs,
			saveJSON: async (cat, id, doc) => docs.set(`${cat}/${id}`, doc),
			loadJSON: async (cat, id) => docs.get(`${cat}/${id}`) ?? null,
		};
	}

	it("keeps history oldest-first and returns the newest", async () => {
		const store = new QualityStore(fakePersistence());
		await store.save(
			report({ scannedAt: "2026-09-01T00:00:00.000Z", high: 5 }),
		);
		await store.save(
			report({ scannedAt: "2026-09-02T00:00:00.000Z", high: 3 }),
		);
		assert.equal((await store.load("/p")).length, 2);
		assert.equal((await store.latest("/p")).summary.high, 3);
	});

	it("is bounded, dropping the oldest", async () => {
		const store = new QualityStore(fakePersistence());
		for (let i = 0; i < 40; i++) {
			await store.save(
				report({
					scannedAt: `2026-09-09T10:${String(i).padStart(2, "0")}:00.000Z`,
				}),
			);
		}
		assert.equal((await store.load("/p")).length, 30);
	});

	it("REGRESSION: a trend only compares scans measured by the SAME tools", async () => {
		// A project where knip was unavailable last week and available today
		// would otherwise show a jump in dead code that is really a jump in
		// coverage -- a false trend.
		const store = new QualityStore(fakePersistence());
		await store.save(
			report({
				scannedAt: "2026-09-01T00:00:00.000Z",
				high: 1,
				measured: ["graphify"],
			}),
		);
		await store.save(
			report({
				scannedAt: "2026-09-02T00:00:00.000Z",
				high: 9,
				measured: ["knip", "graphify"],
			}),
		);

		const trend = await store.trend("/p");
		assert.equal(trend.points.length, 2);
		assert.equal(trend.highDelta, 0, "no comparable earlier scan, so no delta");

		await store.save(
			report({
				scannedAt: "2026-09-03T00:00:00.000Z",
				high: 12,
				measured: ["knip", "graphify"],
			}),
		);
		assert.equal(
			(await store.trend("/p")).highDelta,
			3,
			"12 - 9, same tool set",
		);
	});

	it("an unscanned project has no history and no delta", async () => {
		const store = new QualityStore(fakePersistence());
		assert.deepEqual(await store.load("/never"), []);
		assert.equal(await store.latest("/never"), null);
		assert.equal((await store.trend("/never")).highDelta, 0);
	});

	it("works with no persistence at all", async () => {
		const store = new QualityStore();
		await store.save(report());
		assert.deepEqual(await store.load("/p"), []);
	});

	it("encodes a project path into a readable file id", () => {
		// Readable rather than hashed: a hash makes the store unreadable during
		// exactly the debugging it would be needed for.
		const id = projectStoreId("/Users/me/Desktop/my-app");
		assert.match(id, /Users_me_Desktop_my-app/);
		assert.ok(!id.includes("/"));
	});
});
