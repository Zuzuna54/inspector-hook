/**
 * The analyser registry (M7).
 *
 * knip only sees JavaScript and TypeScript. Measured across the 17 observed
 * projects: TS/JS 20540 files, Rust 3757, Go 2608, Python 1760 — so Python,
 * Rust and Go were added by file count, not by guess.
 *
 * Two behaviours here were measured, not assumed, and both are load-bearing:
 *
 *   - vulture on a Django project reported 66 findings, **62 inside
 *     `.venv/site-packages`**. With exclusions: 4. Trusting a tool's default
 *     is 94% noise.
 *   - Rust uses clippy rather than cargo-machete because clippy ships with any
 *     rustup toolchain and machete needs `cargo install`. A scan that requires
 *     a setup step is a scan that does not run.
 */

import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	ANALYZERS,
	analyzersFor,
	detectLanguages,
	estimateSeconds,
	findJsRoot,
	hasManifest,
	VENDOR_DIRS,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** A tree with the given files, relative to a temp root. */
async function tree(files) {
	const root = await makeTempStore();
	dirs.push(root);
	for (const [path, body] of Object.entries(files)) {
		const full = join(root, path);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, body ?? "x\n", "utf-8");
	}
	return root;
}

const ctx = (languages, hasPackageJson = true) => ({
	root: "/p",
	languages,
	hasPackageJson,
});

describe("registry: language detection", () => {
	it("counts the languages a project actually uses", async () => {
		const root = await tree({
			"src/a.ts": null,
			"src/b.tsx": null,
			"src/c.js": null,
			"api/x.py": null,
			"api/y.py": null,
			"api/z.py": null,
		});
		const langs = detectLanguages(root);
		assert.equal(langs["ts-js"], 3);
		assert.equal(langs.python, 3);
	});

	it("REGRESSION: never counts vendored directories", async () => {
		// vulture on a Django project put 62 of 66 findings inside
		// .venv/site-packages. If detection counted them, every TS project with
		// a Python dependency would run vulture over third-party code.
		const root = await tree({
			"src/a.ts": null,
			"src/b.ts": null,
			"src/c.ts": null,
			"node_modules/dep/index.js": null,
			".venv/lib/site-packages/thing.py": null,
			"target/debug/build.rs": null,
			"__pycache__/x.py": null,
		});
		const langs = detectLanguages(root);
		assert.equal(langs["ts-js"], 3);
		assert.equal(
			langs.python,
			undefined,
			"vendored Python is not this project's",
		);
		assert.equal(langs.rust, undefined, "target/ is build output");
	});

	it("applies a floor, so one stray file is not a language", async () => {
		// Running an analyser that finds nothing still costs seconds and still
		// has to be explained in the report.
		const root = await tree({
			"src/a.ts": null,
			"src/b.ts": null,
			"src/c.ts": null,
			"scripts/one-off.py": null,
		});
		const langs = detectLanguages(root);
		assert.equal(langs["ts-js"], 3);
		assert.equal(langs.python, undefined, "1 file is incidental");
	});

	it("handles a missing or unreadable directory", () => {
		assert.deepEqual(detectLanguages("/nonexistent-xyz"), {});
	});

	it("VENDOR_DIRS covers the four ecosystems' output directories", () => {
		for (const d of [
			"node_modules",
			".venv",
			"site-packages",
			"target",
			"dist",
		]) {
			assert.ok(VENDOR_DIRS.includes(d), d);
		}
	});
});

describe("registry: which analysers apply", () => {
	it("a polyglot project gets an analyser per language", () => {
		// cere-full is TS 5207 + Rust 3514 + Go 946. One project, four analysers
		// plus the language-agnostic one.
		const ids = analyzersFor(ctx({ "ts-js": 5207, rust: 3514, go: 946 })).map(
			(a) => a.id,
		);
		assert.ok(ids.includes("knip"));
		assert.ok(ids.includes("madge"));
		assert.ok(ids.includes("clippy"));
		assert.ok(ids.includes("go-deadcode"));
		assert.ok(ids.includes("sonar-secrets"), "language-agnostic");
		assert.ok(!ids.includes("vulture"), "no Python here");
	});

	it("a Python-only project gets the Python analysers and not knip", () => {
		const ids = analyzersFor(ctx({ python: 115 }, false)).map((a) => a.id);
		assert.deepEqual(ids.sort(), ["ruff", "sonar-secrets", "vulture"]);
	});

	it("REGRESSION: knip needs BOTH a package.json and JS files", () => {
		// A package.json with no JavaScript in it has no entry points to trace,
		// and knip would report the whole tree.
		assert.ok(
			!analyzersFor(ctx({ python: 9 }, true)).some((a) => a.id === "knip"),
		);
		assert.ok(
			!analyzersFor(ctx({ "ts-js": 9 }, false)).some((a) => a.id === "knip"),
		);
		assert.ok(
			analyzersFor(ctx({ "ts-js": 9 }, true)).some((a) => a.id === "knip"),
		);
	});

	it("the secrets scanner applies to every project, whatever the language", () => {
		assert.ok(analyzersFor(ctx({})).some((a) => a.id === "sonar-secrets"));
	});

	it("estimates how long a scan will take", () => {
		const quick = estimateSeconds(ctx({ python: 20 }, false));
		const heavy = estimateSeconds(ctx({ "ts-js": 20, rust: 20, go: 20 }));
		assert.ok(heavy > quick, `${heavy} should exceed ${quick}`);
	});
});

describe("registry: every analyser declares how to run without an install", () => {
	it("uses a no-install runner wherever the ecosystem has one", () => {
		// Verified on this machine, which had only ruff installed.
		const runner = (id) => {
			const a = ANALYZERS.find((x) => x.id === id);
			return a.command(ctx({ "ts-js": 1, python: 1, go: 1, rust: 1 }))[0];
		};
		assert.equal(runner("knip"), "npx");
		assert.equal(runner("madge"), "npx");
		assert.equal(runner("vulture"), "uvx");
		assert.equal(runner("ruff"), "uvx");
		assert.equal(runner("go-deadcode"), "go");
		assert.equal(runner("clippy"), "cargo");
	});

	it("REGRESSION: Rust uses clippy, not cargo-machete", () => {
		// clippy ships with any rustup toolchain; machete needs `cargo install`.
		// dead_code is a rustc lint, so clippy surfaces it.
		const rust = ANALYZERS.find((a) => a.language === "rust");
		const [cmd, args] = rust.command(ctx({ rust: 10 }));
		assert.equal(cmd, "cargo");
		assert.equal(args[0], "clippy");
		assert.ok(!args.includes("machete"));
		assert.equal(rust.needsInstall, undefined, "no install step required");
	});

	it("only the analyser that genuinely needs installing says so", () => {
		const needing = ANALYZERS.filter((a) => a.needsInstall);
		assert.deepEqual(
			needing.map((a) => a.id),
			["sonar-secrets"],
		);
		assert.match(needing[0].needsInstall, /install/i);
	});

	it("REGRESSION: vulture is given exclusions, or it scans site-packages", () => {
		// 66 findings became 4 with these. Without them Python results are 94%
		// third-party code the developer cannot act on.
		const vulture = ANALYZERS.find((a) => a.id === "vulture");
		const [, args] = vulture.command(ctx({ python: 10 }));
		const exclude = args[args.indexOf("--exclude") + 1];
		assert.ok(exclude, "an --exclude argument is passed");
		for (const d of ["site-packages", ".venv", "node_modules"]) {
			assert.ok(exclude.includes(d), `${d} must be excluded`);
		}
	});

	it("ruff selects only the unused-code rules", () => {
		// A full ruff run is a style opinion and would bury the dead-code
		// signal this view is about.
		const ruff = ANALYZERS.find((a) => a.id === "ruff");
		const [, args] = ruff.command(ctx({ python: 10 }));
		const select = args[args.indexOf("--select") + 1];
		assert.match(select, /F401/);
	});
});

describe("registry: parsing each tool's real output shape", () => {
	const parse = (id, stdout) =>
		ANALYZERS.find((a) => a.id === id).parse(stdout, {
			root: "/p",
			languages: {},
			hasPackageJson: true,
		});

	it("knip separates a dead FILE from dead symbols inside a live file", () => {
		const out = parse(
			"knip",
			JSON.stringify({
				issues: [
					{ file: "src/dead.ts" },
					{ file: "src/alive.ts", exports: [{ name: "stale" }] },
				],
			}),
		);
		assert.equal(out.find((f) => f.file === "src/dead.ts").kind, "dead-file");
		assert.equal(
			out.find((f) => f.file === "src/alive.ts").kind,
			"dead-symbol",
		);
	});

	it("vulture: the real text format, not JSON", () => {
		// `path:line: unused function 'name' (80% confidence)` -- vulture has no
		// JSON reporter, so this is parsed from text.
		const out = parse(
			"vulture",
			"lib/http_logger.py:150: unused function 'log_info' (80% confidence)\n" +
				"noise that is not a finding\n",
		);
		assert.equal(out.length, 1);
		assert.equal(out[0].file, "lib/http_logger.py");
		assert.equal(out[0].line, 150);
		assert.equal(out[0].kind, "dead-symbol");
		assert.match(out[0].detail, /unused function 'log_info'/);
	});

	it("ruff: JSON with a location row", () => {
		const out = parse(
			"ruff",
			JSON.stringify([
				{
					code: "F401",
					filename: "/p/api/views.py",
					message: "`os` imported but unused",
					location: { row: 3, column: 8 },
				},
			]),
		);
		assert.equal(out[0].file, "api/views.py", "made project-relative");
		assert.equal(out[0].line, 3);
		assert.match(out[0].detail, /F401/);
	});

	it("go deadcode: the Package/Funcs shape, skipping generated code", () => {
		// Generated code is not the developer's to delete.
		const out = parse(
			"go-deadcode",
			JSON.stringify([
				{
					Name: "error",
					Funcs: [
						{
							Name: "Error.Is",
							Position: { File: "error/error.go", Line: 14 },
							Generated: false,
						},
						{
							Name: "Gen.Thing",
							Position: { File: "pb/x.pb.go", Line: 9 },
							Generated: true,
						},
					],
				},
			]),
		);
		assert.equal(out.length, 1, "the generated func is skipped");
		assert.equal(out[0].file, "error/error.go");
		assert.equal(out[0].line, 14);
		assert.match(out[0].detail, /Error\.Is/);
	});

	it("clippy: newline-delimited JSON, only dead_code and unused_ lints", () => {
		// cargo emits one object per line, not an array, and most of them are
		// not lints at all.
		const lines = [
			JSON.stringify({ reason: "compiler-artifact" }),
			JSON.stringify({
				reason: "compiler-message",
				message: {
					code: { code: "dead_code" },
					message: "function `helper` is never used",
					spans: [{ file_name: "src/lib.rs", line_start: 42 }],
				},
			}),
			JSON.stringify({
				reason: "compiler-message",
				message: {
					code: { code: "clippy::needless_return" },
					message: "style",
					spans: [{ file_name: "src/lib.rs", line_start: 9 }],
				},
			}),
		].join("\n");
		const out = parse("clippy", lines);
		assert.equal(out.length, 1, "style lints are not dead code");
		assert.equal(out[0].file, "src/lib.rs");
		assert.equal(out[0].line, 42);
		assert.match(out[0].detail, /dead_code/);
	});

	it("madge: cycles carry the whole path", () => {
		const out = parse("madge", JSON.stringify([["a.ts", "b.ts", "a.ts"]]));
		assert.equal(out[0].kind, "cycle");
		assert.deepEqual(out[0].cycle, ["a.ts", "b.ts", "a.ts"]);
	});

	it("REGRESSION: sonar keeps the rule, never the secret value", () => {
		const out = parse(
			"sonar-secrets",
			JSON.stringify([
				{
					file: "/p/config.ts",
					rule: "aws-access-key",
					line: 4,
					secret: "AKIAEXAMPLE",
				},
			]),
		);
		assert.equal(out[0].kind, "secret");
		assert.equal(out[0].detail, "aws-access-key");
		assert.ok(!JSON.stringify(out).includes("AKIA"), "no value survives");
	});

	it("every parser survives malformed output", () => {
		for (const a of ANALYZERS) {
			for (const bad of ["", "not json", "{}", "[]", "null"]) {
				assert.doesNotThrow(
					() =>
						a.parse(bad, { root: "/p", languages: {}, hasPackageJson: true }),
					`${a.id} on ${JSON.stringify(bad)}`,
				);
			}
		}
	});
});

describe("registry: project manifests", () => {
	it("recognises each ecosystem's manifest", async () => {
		const root = await tree({
			"go.mod": "module x\n",
			"Cargo.toml": "[package]\n",
		});
		assert.equal(hasManifest(root, "go"), true);
		assert.equal(hasManifest(root, "rust"), true);
		assert.equal(hasManifest(root, "ts-js"), false);
		assert.equal(hasManifest(root, "python"), false);
	});
});

describe("registry: the JS manifest is not always at the root", () => {
	it("uses the root when it has a package.json", async () => {
		const root = await tree({ "package.json": "{}", "src/a.ts": null });
		const js = findJsRoot(root);
		assert.equal(js.dir, root);
		assert.deepEqual(js.nested, []);
	});

	it("REGRESSION: recovers a single nested package", async () => {
		// Measured: five observed projects have TS/JS at scale and no
		// package.json at the root, because the transcript recorded a container
		// directory. A root-only check left four of them with no dead-code
		// analysis at all. Coverage went 3 -> 9 projects with this.
		const root = await tree({
			"photographer-portfolio/package.json": "{}",
			"photographer-portfolio/src/a.ts": null,
		});
		const js = findJsRoot(root);
		assert.equal(js.dir, join(root, "photographer-portfolio"));
		assert.equal(js.nested.length, 1);
	});

	it("REFUSES to pick when several packages exist", async () => {
		// Ordex holds ordex/ and ordex-e2e/ — two independent packages, not a
		// workspace. Choosing one would analyse half the project and report it
		// as the whole; each is discovered as its own project instead.
		const root = await tree({
			"ordex/package.json": "{}",
			"ordex-e2e/package.json": "{}",
		});
		const js = findJsRoot(root);
		assert.equal(js.dir, "", "no guess");
		assert.equal(js.nested.length, 2, "but it reports what it found");
	});

	it("never descends into vendored directories", async () => {
		const root = await tree({
			"node_modules/dep/package.json": "{}",
			".venv/lib/package.json": "{}",
		});
		assert.equal(findJsRoot(root).dir, "");
		assert.deepEqual(findJsRoot(root).nested, []);
	});

	it("handles a missing directory", () => {
		assert.equal(findJsRoot("/nonexistent-xyz").dir, "");
	});
});
