/**
 * Research history and BM25 search (Milestone 4).
 *
 * The ranking tests assert PROPERTIES rather than exact scores. A score is an
 * implementation detail that changes with k1, b, or the corpus; "the document
 * about the thing you asked for ranks above the one that merely mentions it" is
 * the contract, and it survives tuning.
 *
 * Extraction is tested against the payload shapes read off the live store, not
 * off the documentation — this project has repeatedly found the two disagreeing.
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import {
	Bm25Index,
	PersistenceStore,
	ResearchIndex,
	extractResearchItem,
	tokenize,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

async function newStore() {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	const store = new PersistenceStore({ basePath });
	await store.initialize();
	return store;
}

/** A log entry shaped exactly like the ones in the live store. */
const log = (over = {}) => ({
	id: `log-${Math.random().toString(36).slice(2)}`,
	timestamp: "2026-09-03T10:00:00.000Z",
	level: "info",
	sessionId: "s1",
	hook: "PostToolUse",
	event: "PostToolUse",
	message: "",
	...over,
	details: {
		cwd: "/w/proj",
		gitRemote: "git@github.com:me/proj.git",
		projectName: "proj",
		...(over.details ?? {}),
	},
});

describe("tokenize", () => {
	it("splits code identifiers into findable parts", () => {
		// `tool_use_id` and `file-tracker.ts` must be reachable by their parts,
		// because that is how someone actually searches for them.
		assert.deepEqual(tokenize("tool_use_id"), ["tool", "use", "id"]);
		assert.deepEqual(tokenize("file-tracker.ts"), ["file", "tracker", "ts"]);
	});

	it("keeps a version number whole, not as loose digits", () => {
		// Splitting first destroys it: "0.1.7" becomes 0, 1, 7 — three single
		// characters, all dropped as noise — so the version vanishes from the
		// index and searching for it returns nothing. Versions and error codes
		// are exactly what someone searches a research corpus for.
		//
		// Dotted numbers are lifted out before the general split, so they lead
		// the token list; the assertion is on the SET, since ordering is an
		// artefact of that two-pass extraction rather than a contract.
		assert.deepEqual(
			[...tokenize("sqlite-vec 0.1.7 error 429")].sort(),
			["0.1.7", "429", "error", "sqlite", "vec"],
		);
	});

	it("a version number is findable by searching for it exactly", () => {
		const index = new Bm25Index();
		index.add("release", "upgraded sqlite-vec to 0.1.7 today");
		index.add("other", "upgraded biome to 2.3.1 today");

		const hits = index.search("0.1.7").hits;
		assert.equal(hits.length, 1, "the version must match exactly one document");
		assert.equal(hits[0].docId, "release");
	});

	it("drops stop words and single characters", () => {
		assert.deepEqual(tokenize("the a of x retention"), ["retention"]);
	});

	it("is total for junk input", () => {
		for (const junk of ["", "   ", "!!!", null, undefined, 42]) {
			assert.deepEqual(tokenize(junk), []);
		}
	});
});

describe("Bm25Index ranking", () => {
	const corpus = () => {
		const index = new Bm25Index();
		index.add("about", "retention retention retention deletes expired sessions");
		index.add("mentions", "a long document about many things including retention and much else besides padding padding padding");
		index.add("unrelated", "the diff engine computes hunks");
		return index;
	};

	it("ranks the document about a term above one that merely mentions it", () => {
		const { hits } = corpus().search("retention");
		assert.equal(hits[0].docId, "about");
		assert.equal(hits[1].docId, "mentions");
		assert.equal(hits.length, 2, "the unrelated document does not match at all");
	});

	it("scores a document matching two query terms above one matching one", () => {
		const index = new Bm25Index();
		index.add("both", "retention sessions");
		index.add("one", "retention elsewhere");
		const { hits } = index.search("retention sessions");
		assert.equal(hits[0].docId, "both");
	});

	it("REGRESSION: a term in most documents never scores NEGATIVE", () => {
		// Without the `1 +` inside the IDF logarithm, a term appearing in over
		// half the corpus produces a negative contribution -- so a document is
		// DEMOTED for containing a word you searched for, inverting the ranking.
		const index = new Bm25Index();
		for (let i = 0; i < 10; i++) index.add(`d${i}`, "common term here");
		index.add("rare", "common term here plus something distinctive");

		const { hits } = index.search("common");
		assert.ok(hits.length > 0);
		for (const hit of hits) {
			assert.ok(hit.score >= 0, `score must not be negative, got ${hit.score}`);
		}
	});

	it("reports which terms matched, so a hit can be explained", () => {
		const { hits } = corpus().search("retention hunks");
		const byId = Object.fromEntries(hits.map((h) => [h.docId, h.matched]));
		assert.deepEqual(byId.about, ["retention"]);
		assert.deepEqual(byId.unrelated, ["hunks"]);
	});

	it("orders ties stably, so a result set can be reasoned about", () => {
		const index = new Bm25Index();
		index.add("b", "same text");
		index.add("a", "same text");
		assert.deepEqual(
			index.search("same").hits.map((h) => h.docId),
			["a", "b"],
		);
	});

	it("returns nothing for a query of only stop words", () => {
		const result = corpus().search("the and of");
		assert.deepEqual(result.hits, []);
		assert.deepEqual(result.terms, []);
	});
});

describe("Bm25Index bookkeeping", () => {
	it("REGRESSION: re-adding a document does not double-count its terms", () => {
		// An index that double-counts drifts quietly from the corpus it claims
		// to describe, and nothing about the result set says so.
		const index = new Bm25Index();
		index.add("d", "retention retention");
		const first = index.search("retention").hits[0].score;

		index.add("d", "retention retention");
		const second = index.search("retention").hits[0].score;

		assert.equal(index.size, 1, "still one document");
		assert.equal(second, first, "and the same score");
	});

	it("removing a document drops its terms from the vocabulary", () => {
		// Otherwise IDF is computed against terms no document contains, which
		// skews every later score.
		const index = new Bm25Index();
		index.add("d", "distinctive");
		assert.equal(index.vocabulary, 1);

		assert.equal(index.remove("d"), true);
		assert.equal(index.vocabulary, 0);
		assert.equal(index.size, 0);
		assert.deepEqual(index.search("distinctive").hits, []);
	});

	it("removing an unknown document is a no-op, not an error", () => {
		assert.equal(new Bm25Index().remove("nope"), false);
	});

	it("records a document with no indexable terms", () => {
		const index = new Bm25Index();
		index.add("empty", "the a of");
		assert.equal(index.has("empty"), true, "it is a real state, not an absence");
		assert.equal(index.size, 1);
	});

	it("survives a round trip through JSON", () => {
		const index = new Bm25Index();
		index.add("a", "retention deletes expired sessions");
		index.add("b", "the diff engine computes hunks");

		const restored = Bm25Index.fromJSON(JSON.parse(JSON.stringify(index)));

		assert.equal(restored.size, index.size);
		assert.equal(restored.vocabulary, index.vocabulary);
		assert.equal(
			restored.search("retention").hits[0].score,
			index.search("retention").hits[0].score,
			"scores must be identical, or a restart silently changes ranking",
		);
	});

	it("interns document ids in the snapshot", () => {
		// 83% of a v1 snapshot was the same 36-character ids repeated, once per
		// posting -- 985KB of 1192KB on the real corpus. v2 lists each id once
		// and references it by position.
		const index = new Bm25Index();
		index.add("a-very-long-document-identifier-0001", "retention sessions expired");
		index.add("a-very-long-document-identifier-0002", "retention deletes archives");

		const snap = index.toJSON();
		assert.equal(snap.version, 2);
		assert.deepEqual(snap.docs, [
			"a-very-long-document-identifier-0001",
			"a-very-long-document-identifier-0002",
		]);
		assert.deepEqual(
			Object.keys(snap.postings.retention).sort(),
			["0", "1"],
			"postings reference positions, not ids",
		);

		const restored = Bm25Index.fromJSON(JSON.parse(JSON.stringify(snap)));
		assert.equal(
			restored.search("retention").hits[0].score,
			index.search("retention").hits[0].score,
		);
	});

	it("still reads a v1 snapshot", () => {
		// Nothing shipped writing v1, but an index from an intermediate build
		// should load rather than silently rebuild into something weaker.
		const restored = Bm25Index.fromJSON({
			version: 1,
			lengths: { a: 3, b: 3 },
			postings: { retention: { a: 1, b: 2 } },
		});
		assert.equal(restored.size, 2);
		assert.equal(restored.search("retention").hits.length, 2);
	});

	it("degrades to empty rather than throwing on a corrupt snapshot", () => {
		// A corrupt index should mean "search finds nothing until rebuilt",
		// never "the core will not start".
		for (const bad of [null, undefined, 42, {}, { version: 2 }, { version: 1 }]) {
			assert.equal(Bm25Index.fromJSON(bad).size, 0);
		}
	});

	it("drops a posting for a document the snapshot does not contain", () => {
		// A phantom posting would give the term an IDF computed against a
		// document that is not there.
		const restored = Bm25Index.fromJSON({
			version: 2,
			docs: ["a"],
			lengths: [2],
			postings: { term: { 0: 1, 9: 5 } },
		});
		assert.equal(restored.size, 1);
		assert.deepEqual(
			restored.search("term").hits.map((h) => h.docId),
			["a"],
			"the out-of-range position is discarded",
		);
	});
});

describe("extractResearchItem", () => {
	it("extracts a web search with the titles it surfaced", () => {
		const item = extractResearchItem(
			log({
				tool: "WebSearch",
				details: {
					tool_input: { query: "sqlite-vec node version" },
					tool_result: {
						query: "sqlite-vec node version",
						results: [
							{ content: [{ title: "sqlite-vec - npm", url: "https://npm/sqlite-vec" }] },
						],
					},
				},
			}),
		);
		assert.equal(item.kind, "web_search");
		assert.equal(item.title, "sqlite-vec node version");
		assert.match(item.text, /sqlite-vec - npm/);
		assert.equal(item.projectKey, "git@github.com:me/proj.git", "keyed by remote");
	});

	it("extracts a web fetch with url, ask and body", () => {
		const item = extractResearchItem(
			log({
				tool: "WebFetch",
				details: {
					tool_input: { url: "https://docs/hooks", prompt: "list every event" },
					tool_result: { result: "SessionStart, PreToolUse, ..." },
				},
			}),
		);
		assert.equal(item.kind, "web_fetch");
		assert.equal(item.url, "https://docs/hooks");
		assert.match(item.text, /list every event/);
		assert.match(item.text, /SessionStart/);
	});

	it("extracts a delegated task", () => {
		const item = extractResearchItem(
			log({
				tool: "Task",
				details: {
					tool_input: {
						description: "Digest the design docs",
						prompt: "Read every file under docs/",
						subagent_type: "Explore",
					},
				},
			}),
		);
		assert.equal(item.kind, "subagent_task");
		assert.equal(item.agentType, "Explore");
		assert.match(item.text, /Read every file/);
	});

	it("extracts a subagent report", () => {
		const item = extractResearchItem(
			log({
				hook: "SubagentStop",
				event: "SubagentStop",
				details: { lastAssistantMessage: "Found 4 stale assertions", agentType: "Explore" },
			}),
		);
		assert.equal(item.kind, "subagent_report");
		assert.equal(item.title, "Explore report");
	});

	it("extracts a user prompt", () => {
		const item = extractResearchItem(
			log({
				hook: "UserPromptSubmit",
				event: "UserPromptSubmit",
				details: { prompt: "fix the retention bug\nand the tests" },
			}),
		);
		assert.equal(item.kind, "user_prompt");
		assert.equal(item.title, "fix the retention bug", "headline is the first line");
	});

	it("does NOT index a StopFailure as a conclusion", () => {
		// StopFailure carries an API error in the same field a conclusion uses.
		// Indexing "API Error: rate limit reached" would put noise into the
		// corpus that reads exactly like a finding.
		assert.equal(
			extractResearchItem(
				log({
					hook: "StopFailure",
					event: "StopFailure",
					details: { lastAssistantMessage: "API Error: rate limit reached" },
				}),
			),
			null,
		);
	});

	it("ignores PreToolUse, so nothing is indexed twice", () => {
		assert.equal(
			extractResearchItem(
				log({
					hook: "PreToolUse",
					event: "PreToolUse",
					tool: "WebSearch",
					details: { tool_input: { query: "x" } },
				}),
			),
			null,
		);
	});

	it("returns null rather than throwing for anything unrecognised", () => {
		for (const bad of [
			log({ tool: "Bash", details: {} }),
			log({ hook: "PostToolUse", tool: "WebSearch", details: {} }),
			log({ hook: "Nonsense", details: null }),
		]) {
			assert.equal(extractResearchItem(bad), null);
		}
	});
});

describe("ResearchIndex", () => {
	const searchLog = (id, query) =>
		log({
			id,
			tool: "WebSearch",
			details: { tool_input: { query }, tool_result: { query, results: [] } },
		});

	it("indexes and finds an item end to end", () => {
		const index = new ResearchIndex();
		index.ingest(searchLog("a", "sqlite vec extension loading"));
		index.ingest(searchLog("b", "biome formatter configuration"));

		const result = index.search("sqlite");
		assert.equal(result.hits.length, 1);
		assert.equal(result.hits[0].item.id, "a");
		assert.equal(result.searched, 2);
	});

	it("weights the title above the body", () => {
		const index = new ResearchIndex();
		index.ingest(searchLog("titled", "retention"));
		index.ingest(
			log({
				id: "bodied",
				tool: "WebFetch",
				details: {
					tool_input: { url: "https://x", prompt: "unrelated" },
					tool_result: { result: "retention appears only in the body here" },
				},
			}),
		);

		const { hits } = index.search("retention");
		assert.equal(hits[0].item.id, "titled");
	});

	it("scopes by project, and searches across them by default", () => {
		// The cross-project search is the thing a machine-wide core can do that
		// per-project native memory structurally cannot, so it is the default.
		const index = new ResearchIndex();
		index.ingest(searchLog("mine", "retention bug"));
		index.ingest({
			...searchLog("other", "retention bug"),
			details: {
				cwd: "/w/other",
				gitRemote: "git@github.com:me/other.git",
				projectName: "other",
				tool_input: { query: "retention bug" },
				tool_result: { query: "retention bug", results: [] },
			},
		});

		assert.equal(index.search("retention").hits.length, 2, "all projects by default");
		const scoped = index.search("retention", {
			projectKey: "git@github.com:me/other.git",
		});
		assert.equal(scoped.hits.length, 1);
		assert.equal(scoped.hits[0].item.id, "other");
		assert.equal(scoped.searched, 1, "and it reports the scoped corpus size");
	});

	it("indexes a file read as a path, never its contents", () => {
		// M4 lists "files read" in its capture set. Only the PATH is indexed: a
		// Read result is the file itself, so indexing it would put a copy of the
		// codebase into the corpus -- enormous, redundant with the files on
		// disk, and it would drown every other kind in the ranking.
		const index = new ResearchIndex();
		index.ingest(
			log({
				tool: "Read",
				details: {
					tool_input: { file_path: "/w/proj/packages/core/src/managers/file-tracker.ts" },
					tool_result: { content: "SECRET FILE BODY THAT MUST NOT BE INDEXED" },
				},
			}),
		);

		const { hits } = index.search("file-tracker");
		assert.equal(hits.length, 1);
		assert.equal(hits[0].item.kind, "file_read");
		assert.doesNotMatch(hits[0].item.text, /SECRET FILE BODY/);
		assert.deepEqual(index.search("SECRET").hits, [], "contents are not searchable");
	});

	it("REGRESSION: reading one file repeatedly is ONE item", () => {
		// 165 read events over 100 distinct paths on the real corpus, with one
		// file appearing 14 times. Twenty reads of a file is one fact observed
		// twenty times; keeping twenty items pads the corpus and crowds the
		// other kinds out of the ranking.
		const index = new ResearchIndex();
		for (let i = 0; i < 5; i++) {
			index.ingest(
				log({
					id: `distinct-log-${i}`,
					timestamp: `2026-09-0${i + 1}T00:00:00.000Z`,
					tool: "Read",
					details: { tool_input: { file_path: "/w/proj/a.ts" } },
				}),
			);
		}
		assert.equal(index.size, 1, "one file, one item");
		assert.equal(
			index.search("a.ts").hits[0].item.timestamp,
			"2026-09-05T00:00:00.000Z",
			"and it carries the most recent read",
		);
	});

	it("reports the scope it searched, never leaving breadth implicit", () => {
		// "3 hits" means something different across one project than across
		// eleven, so a result always says which it was.
		const index = new ResearchIndex();
		index.ingest(searchLog("a", "retention"));

		assert.equal(index.search("retention").scope, "all");
		const scoped = index.search("retention", {
			projectKey: "git@github.com:me/proj.git",
		});
		assert.equal(scoped.scope, "project");
		assert.equal(scoped.projectKey, "git@github.com:me/proj.git");
	});

	it("filters by kind and by date", () => {
		const index = new ResearchIndex();
		index.ingest(searchLog("s", "retention"));
		index.ingest(
			log({
				id: "p",
				hook: "UserPromptSubmit",
				event: "UserPromptSubmit",
				timestamp: "2026-09-05T00:00:00.000Z",
				details: { prompt: "retention" },
			}),
		);

		assert.equal(index.search("retention", { kinds: ["user_prompt"] }).hits.length, 1);
		assert.equal(
			index.search("retention", { since: "2026-09-04T00:00:00.000Z" }).hits[0].item.id,
			"p",
		);
	});

	it("drops the oldest items once the cap is reached", () => {
		// The index is durable, so it needs its own bound or it grows without
		// limit -- the thing retention exists to prevent.
		const index = new ResearchIndex({ maxItems: 3 });
		for (let i = 0; i < 6; i++) {
			index.ingest({
				...searchLog(`q${i}`, `query ${i}`),
				timestamp: `2026-09-0${i + 1}T00:00:00.000Z`,
			});
		}
		assert.equal(index.size, 3);
		assert.equal(index.get("q0"), null, "oldest evicted");
		assert.ok(index.get("q5"), "newest kept");
	});

	it("reports composition", () => {
		const index = new ResearchIndex();
		index.ingest(searchLog("a", "one"));
		index.ingest(
			log({ id: "b", hook: "UserPromptSubmit", event: "UserPromptSubmit",
				details: { prompt: "two" } }),
		);

		const stats = index.stats();
		assert.equal(stats.items, 2);
		assert.equal(stats.byKind.web_search, 1);
		assert.equal(stats.byKind.user_prompt, 1);
		assert.equal(stats.byProject.proj, 2);
		assert.ok(stats.terms > 0);
	});

	it("survives a restart with identical results", () => {
		return (async () => {
			const store = await newStore();
			const index = new ResearchIndex({ persistence: store });
			index.ingest(searchLog("a", "sqlite vec extension"));
			index.ingest(searchLog("b", "biome formatter"));
			assert.equal(await index.flush(), true);

			const reloaded = new ResearchIndex({ persistence: store });
			const loaded = await reloaded.load();

			assert.equal(loaded.items, 2);
			assert.equal(loaded.rebuilt, false, "a consistent snapshot is trusted as-is");
			assert.deepEqual(
				reloaded.search("sqlite").hits.map((h) => h.item.id),
				["a"],
			);
		})();
	});

	it("REBUILDS rather than trusting an index inconsistent with its items", async () => {
		// The items are the source of truth and the postings are derived.
		// Trusting a stale index makes search quietly return the wrong set, and
		// a short result looks exactly like "nothing matched".
		const store = await newStore();
		await store.saveJSON("research", "index", {
			version: 1,
			items: [
				{ id: "a", kind: "web_search", timestamp: "2026-09-03T00:00:00.000Z",
					title: "sqlite vec", text: "sqlite vec extension" },
				{ id: "b", kind: "web_search", timestamp: "2026-09-03T00:00:00.000Z",
					title: "biome", text: "biome formatter" },
			],
			index: { version: 1, lengths: { a: 3 }, postings: { sqlite: { a: 1 } } },
		});

		const index = new ResearchIndex({ persistence: store });
		const loaded = await index.load();

		assert.equal(loaded.items, 2);
		assert.equal(loaded.rebuilt, true, "the mismatch must be detected");
		assert.equal(
			index.search("biome").hits.length,
			1,
			"and the rebuilt index finds what the stale one had lost",
		);
	});

	it("backfills from logs already on disk", () => {
		// Adopting an existing store: everything captured before the index
		// existed is still in the log, and re-reading it once beats telling a
		// user their history starts today.
		const index = new ResearchIndex();
		const result = index.backfill([
			searchLog("a", "retention"),
			log({ id: "noise", tool: "Bash", details: {} }),
			searchLog("b", "sqlite"),
		]);

		assert.deepEqual(result, { indexed: 2, scanned: 3 });
		assert.equal(index.size, 2);
	});

	it("load on an empty store reports nothing rather than failing", async () => {
		const index = new ResearchIndex({ persistence: await newStore() });
		assert.deepEqual(await index.load(), { items: 0, rebuilt: false });
	});
});
