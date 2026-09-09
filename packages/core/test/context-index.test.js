/**
 * Cross-corpus search (P8).
 *
 * Three properties carry this module, and each one is here because getting it
 * wrong produces a search that looks like it works:
 *
 * 1. **File contents are never indexed.** A change is its path plus the lines
 *    that changed. Index the bodies and every search matches every file that
 *    merely contains the word.
 * 2. **Caps are per corpus.** This is the entire reason the module exists
 *    rather than reusing `ResearchIndex`, whose single global cap lets prompt
 *    churn evict curated memory oldest-first.
 * 3. **Groups are never merged.** Separate indexes mean separate `avgdl` and
 *    separate IDF, so a cross-corpus ranking is arbitrary while looking
 *    authoritative.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	changedLines,
	ContextIndex,
	digestDoc,
	fileChangeDoc,
	findResult,
	memoryDoc,
	summaryDoc,
} from "../dist/index.js";

/** A memory file as `readMemoryProject` produces one. */
function memFile(name, body, description = "", modified = "2026-01-01T00:00:00Z") {
	return {
		path: `/memory/${name}.md`,
		fileName: `${name}.md`,
		name,
		description,
		body,
		modified,
		size: body.length,
		hasFrontmatter: true,
		indexState: "referenced",
	};
}

/** A file change, already turned into the document the index accepts. */
function change(id, filePath, before, after, timestamp = "2026-01-01T00:00:00Z") {
	return fileChangeDoc({
		id,
		filePath,
		sessionId: "s1",
		timestamp,
		beforeContent: before,
		afterContent: after,
		status: "pending",
		tool: "Edit",
	});
}

/** An identity as `projects.list` produces one. */
function proj(root) {
	return { id: root, name: root, root, paths: [root], counts: {} };
}

/** An index holding one document per local corpus. */
function seeded() {
	const index = new ContextIndex();
	index.add(memoryDoc(memFile("auth-notes", "the login flow uses PKCE"), { slug: "p" }));
	index.add(
		digestDoc(
			{
				sessionId: "sess-1",
				name: "session-1",
				description: "reworked the login flow",
				type: "project",
				body: "Rewrote the PKCE exchange.",
				title: "Login rework",
				worthKeeping: true,
			},
			{ timestamp: "2026-01-02T00:00:00Z" },
		),
	);
	index.add(change("c1", "src/auth/pkce.ts", "old line\n", "new pkce line\n"));
	return index;
}

describe("the rule: file contents are never indexed", () => {
	it("indexes changed lines, not the file they live in", () => {
		// `untouchedSecretWord` sits in a line present on BOTH sides, so it is
		// not part of what changed. Indexing bodies would match it.
		const before = "const a = 1;\nconst untouchedSecretWord = 2;\n";
		const after = "const a = 99;\nconst untouchedSecretWord = 2;\n";
		const index = new ContextIndex();
		index.add(change("c1", "src/thing.ts", before, after));

		const [group] = index.search("untouchedSecretWord", { corpora: ["filechange"] });
		assert.equal(group.hits.length, 0, "an unchanged line was indexed");

		// The line that DID change is findable, or the corpus would be useless.
		const [changed] = index.search("99", { corpora: ["filechange"] });
		assert.equal(changed.hits.length, 1);
	});

	it("finds a change by its path alone", () => {
		const index = new ContextIndex();
		index.add(change("c1", "packages/core/src/context/tray-store.ts", "a\n", "b\n"));
		const [group] = index.search("tray-store", { corpora: ["filechange"] });
		assert.equal(group.hits.length, 1, "the tokeniser did not split the path");
	});

	it("stores no searchable body on the document it returns", () => {
		// The bodies stay with their own stores. A copy here could drift from
		// the material it claims to describe, and nothing would report it.
		const [group] = seeded().search("PKCE", { corpora: ["memory"] });
		assert.equal(group.hits.length, 1);
		assert.equal(group.hits[0].text, undefined, "the full body came back");
		assert.ok(group.hits[0].snippet, "no snippet to display");
	});
});

describe("changed lines", () => {
	it("is a set difference in both directions", () => {
		const lines = changedLines("keep\nremoved\n", "keep\nadded\n");
		assert.deepEqual(lines.sort(), ["added", "removed"]);
	});

	it("ignores a moved line, which contributes no new vocabulary", () => {
		assert.deepEqual(changedLines("a\nb\n", "b\na\n"), []);
	});

	it("drops blank and punctuation-only lines", () => {
		// A reformatting change would otherwise fill the cap with braces.
		assert.deepEqual(changedLines("", "\n}\n  \n){\nreal\n"), ["real"]);
	});

	it("caps how many lines one change contributes", () => {
		const after = Array.from({ length: 500 }, (_, i) => `line${i}`).join("\n");
		assert.equal(changedLines("", after).length, 200);
		assert.equal(changedLines("", after, 5).length, 5);
	});
});

describe("caps are per corpus — the reason this is not ResearchIndex", () => {
	it("file-change churn cannot evict a memory file", () => {
		// The exact failure of a shared global cap: the corpus that churns
		// evicts the curated one, oldest first, silently.
		const index = new ContextIndex({ filechange: 5 });
		index.add(memoryDoc(memFile("keeper", "irreplaceable note"), { slug: "p" }));

		for (let i = 0; i < 50; i++) {
			index.add(
				change(`c${i}`, `src/f${i}.ts`, "", `body${i}\n`, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`),
			);
		}

		assert.equal(index.sizeOf("filechange"), 5, "the cap did not hold");
		assert.equal(index.sizeOf("memory"), 1, "memory was evicted by file-change churn");
		const [group] = index.search("irreplaceable", { corpora: ["memory"] });
		assert.equal(group.hits.length, 1, "the memory file is gone from the postings");
	});

	it("evicts oldest first, and counts it", () => {
		const index = new ContextIndex({ digest: 2 });
		for (const [i, day] of ["01", "02", "03"].entries()) {
			index.add(
				digestDoc(
					{
						sessionId: `s${i}`,
						name: `n${i}`,
						description: `d${i}`,
						type: "project",
						body: `marker${i}`,
						title: `t${i}`,
						worthKeeping: true,
					},
					{ timestamp: `2026-01-${day}T00:00:00Z` },
				),
			);
		}
		assert.equal(index.sizeOf("digest"), 2);
		assert.equal(index.search("marker0", { corpora: ["digest"] })[0].hits.length, 0, "kept the oldest");
		assert.equal(index.search("marker2", { corpora: ["digest"] })[0].hits.length, 1, "dropped the newest");

		const digest = index.stats().find((s) => s.corpus === "digest");
		assert.equal(digest.evicted, 1, "eviction was not counted");
		assert.equal(digest.cap, 2);
	});

	it("a bulk load keeps the newest, whatever order they arrive in", () => {
		// Batch trimming is a cost optimisation, NOT a behaviour change: oldest-
		// first eviction is order-independent, because anything dropped mid-batch
		// already had `cap` newer documents present and would fail the final trim
		// too. This pins the property so the two paths cannot silently diverge.
		const day = (n) => `2026-01-${String(n).padStart(2, "0")}T00:00:00Z`;
		const docs = [1, 2, 3, 4, 5].map((n) =>
			change(`c${n}`, `f${n}.ts`, "", `keep${n}\n`, day(n)),
		);

		const batched = new ContextIndex({ filechange: 3 });
		batched.addAll([...docs].reverse());

		const oneByOne = new ContextIndex({ filechange: 3 });
		for (const doc of docs) oneByOne.add(doc);

		for (const index of [batched, oneByOne]) {
			assert.equal(index.sizeOf("filechange"), 3);
			for (const n of [1, 2]) {
				assert.equal(
					index.search(`keep${n}`, { corpora: ["filechange"] })[0].hits.length,
					0,
					`keep${n} is older than the cap allows and survived`,
				);
			}
			for (const n of [3, 4, 5]) {
				assert.equal(
					index.search(`keep${n}`, { corpora: ["filechange"] })[0].hits.length,
					1,
					`keep${n} is among the newest and was evicted`,
				);
			}
		}
	});

	it("refuses to hold the delegated corpus", () => {
		// `prompt` is ResearchIndex's. A local copy would diverge from it with
		// nothing reporting the difference.
		const index = new ContextIndex();
		const accepted = index.add({
			id: "prompt:1",
			corpus: "prompt",
			title: "t",
			text: "body",
			snippet: "body",
			timestamp: "2026-01-01T00:00:00Z",
		});
		assert.equal(accepted, false);
		assert.equal(index.size, 0);
	});
});

describe("searching", () => {
	it("returns one group per corpus, never a merged list", () => {
		const groups = seeded().search("PKCE");
		// Events joined the local corpora when the header search became global.
		assert.deepEqual(
			groups.map((g) => g.corpus),
			["memory", "digest", "filechange", "logs"],
		);
		// Every group carries its own terms and its own totals; there is no
		// field anywhere holding a combined ranking.
		for (const group of groups) {
			assert.ok(Array.isArray(group.hits));
			assert.equal(typeof group.total, "number");
			assert.equal(typeof group.searched, "number");
		}
	});

	it("limits per corpus, not in total", () => {
		const index = new ContextIndex();
		for (let i = 0; i < 10; i++) {
			index.add(memoryDoc(memFile(`m${i}`, "shared term here"), { slug: "p" }));
			index.add(change(`c${i}`, `f${i}.ts`, "", "shared term here\n"));
		}
		const groups = index.search("shared", { limit: 3 });
		for (const group of groups) {
			assert.ok(group.hits.length <= 3, `${group.corpus} exceeded the limit`);
		}
		assert.equal(groups.find((g) => g.corpus === "memory").total, 10, "total ignored the limit");
	});

	it("counts `searched` within the scope, not across the corpus", () => {
		// "0 of 0" reads as an empty scope; "0 of 8000" reads as a failed query.
		const index = new ContextIndex();
		index.add(memoryDoc(memFile("a", "text"), { slug: "p", projectKey: "/proj-a" }));
		index.add(memoryDoc(memFile("b", "text"), { slug: "q", projectKey: "/proj-b" }));

		const [all] = index.search("text", { corpora: ["memory"] });
		assert.equal(all.searched, 2);

		const [scoped] = index.search("text", {
			corpora: ["memory"],
			project: proj("/proj-a"),
		});
		assert.equal(scoped.searched, 1);
		assert.equal(scoped.hits.length, 1);
		assert.equal(scoped.hits[0].projectKey, "/proj-a");
	});

	it("never hides a document that has no project identity", () => {
		// Three-valued: in, out, and cannot tell. There are three identity
		// spaces here — memory keyed on a slug, digests on the working
		// directory, prompts on the git remote — so "no key" means unknown, and
		// a boolean would turn that into "no". Measured on the live corpus, a
		// boolean hid 0-of-17 memory files and 0-of-238 file changes.
		const index = new ContextIndex();
		index.add(memoryDoc(memFile("mine", "shared term"), { slug: "p", projectKey: "/proj-a" }));
		index.add(memoryDoc(memFile("theirs", "shared term"), { slug: "q", projectKey: "/proj-b" }));
		index.add(memoryDoc(memFile("unknown", "shared term"), { slug: "r" }));

		const [group] = index.search("shared", {
			corpora: ["memory"],
			project: proj("/proj-a"),
		});
		const titles = group.hits.map((h) => h.title).sort();
		assert.deepEqual(titles, ["mine", "unknown"], "an unattributable file was hidden");
		assert.equal(group.searched, 2);
	});

	it("counts what it could not attribute, so the scope is not overstated", () => {
		// Including them silently would claim they belong to the project.
		const index = new ContextIndex();
		index.add(memoryDoc(memFile("a", "term"), { slug: "p", projectKey: "/proj-a" }));
		index.add(memoryDoc(memFile("b", "term"), { slug: "r" }));
		const [group] = index.search("term", {
			corpora: ["memory"],
			project: proj("/proj-a"),
		});
		assert.equal(group.unattributed, 1);
	});

	it("does not report an unattributed count when nothing was scoped", () => {
		const index = new ContextIndex();
		index.add(memoryDoc(memFile("b", "term"), { slug: "r" }));
		const [group] = index.search("term", { corpora: ["memory"] });
		assert.equal(group.unattributed, undefined, "a count appeared with no filter to explain it");
	});

	it("still excludes a document that belongs to a DIFFERENT project", () => {
		// Three-valued is not "include everything": a known non-match is out.
		const index = new ContextIndex();
		index.add(memoryDoc(memFile("theirs", "term"), { slug: "q", projectKey: "/proj-b" }));
		const [group] = index.search("term", {
			corpora: ["memory"],
			project: proj("/proj-a"),
		});
		assert.equal(group.hits.length, 0);
	});

	it("reports which terms matched, so a hit can be explained", () => {
		const [group] = seeded().search("PKCE login", { corpora: ["memory"] });
		assert.ok(group.hits[0].matched.length > 0);
	});

	it("an empty query matches nothing rather than everything", () => {
		for (const group of seeded().search("   ")) {
			assert.equal(group.hits.length, 0, `${group.corpus} answered an empty query`);
		}
	});
});

describe("documents", () => {
	it("re-adding the same source replaces it", () => {
		// Ids are deterministic per source, so re-indexing is idempotent by
		// construction — the drift that makes an index disagree with its corpus.
		const index = new ContextIndex();
		index.add(memoryDoc(memFile("note", "first version"), { slug: "p" }));
		index.add(memoryDoc(memFile("note", "second version"), { slug: "p" }));
		assert.equal(index.sizeOf("memory"), 1);
		assert.equal(index.search("first", { corpora: ["memory"] })[0].hits.length, 0);
		assert.equal(index.search("second", { corpora: ["memory"] })[0].hits.length, 1);
	});

	it("a collapsed session replaces its live digest rather than doubling it", () => {
		const index = new ContextIndex();
		index.add(
			digestDoc(
				{
					sessionId: "sess-9",
					name: "n",
					description: "d",
					type: "project",
					body: "live body",
					title: "t",
					worthKeeping: true,
				},
				{ timestamp: "2026-01-01T00:00:00Z" },
			),
		);
		index.add(
			summaryDoc({
				id: "sess-9",
				collapsedAt: "2026-01-02T00:00:00Z",
				description: "collapsed description",
				digest: "collapsed body",
				toolExecutionCount: 3,
				fileChangeCount: 1,
			}),
		);
		assert.equal(index.sizeOf("digest"), 1, "the session is in the corpus twice");
		assert.equal(index.search("live", { corpora: ["digest"] })[0].hits.length, 0);
		assert.equal(index.search("collapsed", { corpora: ["digest"] })[0].hits.length, 1);
	});

	it("skips a summary with nothing in it", () => {
		assert.equal(
			summaryDoc({ id: "s", collapsedAt: "2026-01-01T00:00:00Z", description: "", toolExecutionCount: 0, fileChangeCount: 0 }),
			null,
		);
	});

	it("redacts before storing, in the snippet as well as the postings", () => {
		// Memory files and file changes are read from disk, not through the
		// already-redacted log path, so this is the only pass over them.
		const index = new ContextIndex();
		const secret = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		index.add(memoryDoc(memFile("leaky", `token is ${secret} here`), { slug: "p" }));

		const [group] = index.search("token", { corpora: ["memory"] });
		assert.equal(group.hits.length, 1);
		assert.ok(!group.hits[0].snippet.includes(secret), "a secret shipped in the snippet");
		assert.equal(
			index.search(secret, { corpora: ["memory"] })[0].hits.length,
			0,
			"the secret is searchable, so it is in the postings",
		);
	});

	it("removes a document from both the postings and the map", () => {
		const index = seeded();
		const [hit] = index.search("PKCE", { corpora: ["memory"] })[0].hits;
		assert.equal(index.remove(hit.id), true);
		assert.equal(index.remove(hit.id), false);
		assert.equal(index.search("PKCE", { corpora: ["memory"] })[0].hits.length, 0);
	});

	it("clears one corpus without touching the others", () => {
		const index = seeded();
		index.clear("filechange");
		assert.equal(index.sizeOf("filechange"), 0);
		assert.equal(index.sizeOf("memory"), 1);
		assert.equal(index.sizeOf("digest"), 1);
	});
});

describe("the result envelope", () => {
	it("reports its own breadth", () => {
		assert.equal(findResult("q", [], undefined).scope, "all");
		const scoped = findResult("q", [], "proj-a");
		assert.equal(scoped.scope, "project");
		assert.equal(scoped.projectKey, "proj-a");
	});
});
