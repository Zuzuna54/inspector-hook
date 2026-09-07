/**
 * Local embeddings and hybrid retrieval (M4).
 *
 * ## Why these tests use a fake embedder
 *
 * The real model is a 255MB optional dependency with a native binding. A suite
 * that required it would be untestable on any machine that cannot build sharp
 * — which, as it happens, is the machine this was written on until the build
 * script was allowlisted. `loadEmbedder` takes a `loader` for exactly this: the
 * fusion, the vector store and the fallback behaviour are all testable without
 * downloading anything, and the model's own quality is a measurement (recorded
 * in embeddings.ts) rather than an assertion.
 *
 * The numbers that justify hybrid at all were taken against the live corpus of
 * 693 items: BM25 MRR 0.440, embeddings 0.614, hybrid 0.700.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	cosine,
	EMBEDDING_DIMENSIONS,
	loadEmbedder,
	MAX_EMBED_CHARS,
	ResearchIndex,
	RRF_K,
	reciprocalRankFusion,
	VectorStore,
} from "../dist/index.js";

/** An L2-normalised vector, so cosine is a dot product as the code assumes. */
function unit(values) {
	const v = new Float32Array(EMBEDDING_DIMENSIONS);
	values.forEach((x, i) => {
		v[i] = x;
	});
	const norm = Math.hypot(...v) || 1;
	for (let i = 0; i < v.length; i++) v[i] /= norm;
	return v;
}

describe("embeddings: loading is allowed to fail", () => {
	it("returns null and says why, instead of throwing", async () => {
		// The real failure that motivated this: sharp's native binding was
		// missing, the loader returned null, and nothing anywhere said why. A
		// caller that cannot find out why cannot fix it.
		let reason;
		const embedder = await loadEmbedder({
			loader: async () => {
				throw new Error(
					'Something went wrong installing the "sharp" module\nmore detail',
				);
			},
			onError: (r) => {
				reason = r;
			},
		});
		assert.equal(embedder, null);
		assert.match(reason, /sharp/);
		assert.ok(
			!reason.includes("\n"),
			"first line only, it is a status not a dump",
		);
	});

	it("returns null for a module that is not a transformers package", async () => {
		assert.equal(await loadEmbedder({ loader: async () => ({}) }), null);
	});

	it("wraps a working pipeline into the Embedder interface", async () => {
		const embedder = await loadEmbedder({
			loader: async () => ({
				env: {},
				pipeline: async () => async (texts) => ({
					tolist: () =>
						texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.1)),
				}),
			}),
		});
		assert.ok(embedder);
		assert.equal(embedder.dimensions, EMBEDDING_DIMENSIONS);
		const out = await embedder.embed(["a", "b"]);
		assert.equal(out.length, 2);
		assert.ok(out[0] instanceof Float32Array);
	});

	it("truncates long text before embedding, matching what was measured", async () => {
		let seen;
		const embedder = await loadEmbedder({
			loader: async () => ({
				pipeline: async () => async (texts) => {
					seen = texts;
					return {
						tolist: () =>
							texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0)),
					};
				},
			}),
		});
		await embedder.embed(["x".repeat(MAX_EMBED_CHARS * 3)]);
		assert.equal(seen[0].length, MAX_EMBED_CHARS);
	});

	it("never sends an empty string, which the model cannot pool", async () => {
		let seen;
		const embedder = await loadEmbedder({
			loader: async () => ({
				pipeline: async () => async (texts) => {
					seen = texts;
					return {
						tolist: () =>
							texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0)),
					};
				},
			}),
		});
		await embedder.embed([""]);
		assert.equal(seen[0], " ");
	});
});

describe("embeddings: the vector store", () => {
	it("ranks by cosine, stably", () => {
		const store = new VectorStore();
		store.add("retention", unit([1, 0, 0]));
		store.add("traversal", unit([0, 1, 0]));
		const hits = store.search(unit([1, 0.1, 0]), { limit: 2 });
		assert.equal(hits[0].id, "retention");
		assert.ok(hits[0].score > hits[1].score);
	});

	it("refuses a wrong-length vector rather than storing a corrupt one", () => {
		const store = new VectorStore();
		assert.equal(store.add("bad", new Float32Array(7)), false);
		assert.equal(store.add("", unit([1])), false);
		assert.equal(store.size, 0);
	});

	it("returns nothing for a wrong-length query", () => {
		const store = new VectorStore();
		store.add("a", unit([1]));
		assert.deepEqual(store.search(new Float32Array(3)), []);
	});

	it("honours a filter, so scope is not lost in the vector half", () => {
		const store = new VectorStore();
		store.add("keep", unit([1, 0]));
		store.add("drop", unit([1, 0]));
		const hits = store.search(unit([1, 0]), { filter: (id) => id === "keep" });
		assert.deepEqual(
			hits.map((h) => h.id),
			["keep"],
		);
	});

	it("round-trips exactly through JSON, ranking included", () => {
		// Base64 of the raw float32 bytes, so nothing is lost to decimal
		// formatting. A ranking that shifts after a restart would be a bug
		// nobody could reproduce.
		const store = new VectorStore();
		store.add("a", unit([0.123456789, 0.98765, -0.5]));
		store.add("b", unit([-0.2, 0.4, 0.9]));
		const restored = VectorStore.fromJSON(
			JSON.parse(JSON.stringify(store.toJSON())),
		);

		assert.equal(restored.size, 2);
		const q = unit([0.1, 0.9, 0.4]);
		assert.deepEqual(
			restored.search(q).map((h) => [h.id, h.score]),
			store.search(q).map((h) => [h.id, h.score]),
		);
	});

	it("drops a corrupt entry without losing the rest", () => {
		const store = VectorStore.fromJSON({
			dimensions: EMBEDDING_DIMENSIONS,
			vectors: {
				good: Buffer.from(unit([1]).buffer).toString("base64"),
				truncated: "AAAA",
				wrongType: 42,
			},
		});
		assert.equal(store.size, 1);
		assert.ok(store.has("good"));
	});

	it("survives junk input entirely", () => {
		for (const raw of [null, {}, { vectors: null }, "nope"]) {
			assert.doesNotThrow(() => VectorStore.fromJSON(raw));
		}
	});

	it("cosine refuses mismatched lengths rather than reading past the end", () => {
		assert.equal(cosine(new Float32Array(3), new Float32Array(4)), 0);
	});
});

describe("embeddings: rank fusion", () => {
	it("rewards agreement between the two signals", () => {
		// An item both lists rank must beat one that only appears in a single
		// list at the same position -- that is the whole mechanism.
		const fused = reciprocalRankFusion({
			lexical: ["both", "lexicalOnly"],
			semantic: ["both", "semanticOnly"],
		});
		assert.equal(fused[0].id, "both");
		assert.ok(fused[0].score > fused[1].score);
	});

	it("fuses on rank, so one list's score scale cannot dominate", () => {
		// BM25 scores run to double digits and cosines are bounded by 1. Any
		// numeric combination is a hidden guess about their relative magnitude;
		// positions are directly comparable.
		const fused = reciprocalRankFusion({ a: ["x"], b: ["x"] });
		assert.equal(fused[0].score, 2 / (RRF_K + 1));
	});

	it("reports which list contributed and at what rank", () => {
		const fused = reciprocalRankFusion({
			lexical: ["a", "b"],
			semantic: ["b"],
		});
		const b = fused.find((f) => f.id === "b");
		assert.deepEqual(b.ranks, { lexical: 2, semantic: 1 });
	});

	it("handles empty and single lists", () => {
		assert.deepEqual(reciprocalRankFusion({}), []);
		assert.deepEqual(reciprocalRankFusion({ a: [] }), []);
		assert.deepEqual(
			reciprocalRankFusion({ a: ["x"] }).map((f) => f.id),
			["x"],
		);
	});
});

describe("embeddings: hybrid search on the index", () => {
	/** A WebSearch log, the shape ResearchIndex.ingest actually accepts. */
	const searchLog = (id, query, projectName = "proj") => ({
		id,
		timestamp: "2026-09-03T10:00:00.000Z",
		level: "info",
		sessionId: "s1",
		hook: "PostToolUse",
		event: "PostToolUse",
		message: "",
		tool: "WebSearch",
		details: {
			cwd: `/w/${projectName}`,
			gitRemote: `git@github.com:me/${projectName}.git`,
			projectName,
			tool_input: { query },
			tool_result: { query, results: [] },
		},
	});

	/**
	 * Install the fake through the REAL loader path.
	 *
	 * Assigning to the private field would test a code path that does not
	 * exist in production; `loader` is the seam the module actually provides.
	 */
	async function makeIndex(options = {}) {
		const state = { fail: Boolean(options.fail) };
		const index = new ResearchIndex();
		index.breakModel = () => {
			state.fail = true;
		};
		index.ingest(searchLog("1", "retention deletes old logs"));
		index.ingest(searchLog("2", "path traversal containment"));
		index.ingest(searchLog("3", "diff hunk boundaries", "other"));

		if (options.embedder !== false) {
			const AXES = {
				retention: 0,
				prune: 0,
				growing: 0,
				traversal: 1,
				path: 1,
				diff: 2,
				hunk: 2,
			};
			await index.enableEmbeddings({
				loader: async () => ({
					env: {},
					pipeline: async () => async (texts) => {
						if (state.fail) throw new Error("model exploded");
						return {
							tolist: () =>
								(options.short ? texts.slice(0, 1) : texts).map((t) => {
									const values = new Array(8).fill(0);
									for (const [word, axis] of Object.entries(AXES)) {
										if (String(t).toLowerCase().includes(word))
											values[axis] += 1;
									}
									if (values.every((x) => x === 0)) values[7] = 1;
									return [...unit(values)];
								}),
						};
					},
				}),
			});
		}
		return index;
	}

	it("falls back to lexical and SAYS so when there is no embedder", async () => {
		// The failure mode that matters: a hybrid search quietly degrading is
		// indistinguishable from one that merely ranked differently.
		const index = await makeIndex({ embedder: false });
		const result = await index.searchHybrid("retention");
		assert.equal(result.retrieval, "lexical");
		assert.equal(index.embeddingsAvailable, false);
	});

	it("falls back to lexical when nothing has been embedded yet", async () => {
		const index = await makeIndex();
		assert.equal(index.embeddingsAvailable, true);
		assert.equal(index.embeddedCount, 0);
		assert.equal((await index.searchHybrid("retention")).retrieval, "lexical");
	});

	it("embeds pending items incrementally and stops when done", async () => {
		const index = await makeIndex();
		assert.equal(await index.embedPending(2), 2, "bounded by the limit");
		assert.equal(await index.embedPending(10), 1, "then the remainder");
		assert.equal(await index.embedPending(10), 0, "then nothing");
		assert.equal(index.embeddedCount, 3);
	});

	it("REGRESSION: reports hybrid, and finds a document sharing no words", async () => {
		// "growing" appears in no document, so BM25 alone returns nothing. The
		// semantic half is the only thing that reaches the retention document,
		// which is exactly the gap this milestone was meant to close.
		const index = await makeIndex();
		await index.embedPending(10);

		assert.equal(
			index.search("growing").hits.length,
			0,
			"BM25 cannot reach it",
		);

		const hybrid = await index.searchHybrid("growing");
		assert.equal(hybrid.retrieval, "hybrid");
		assert.equal(hybrid.hits[0].item.id, "1", "the retention document");
		assert.deepEqual(
			hybrid.hits[0].matched,
			[],
			"a purely semantic hit matched no typed word",
		);
	});

	it("keeps the lexical answer when only BM25 can find it", async () => {
		// The measured case for hybrid over replacement: embeddings ranked
		// "writing outside the folder" 14th and BM25 found it 5th.
		const index = await makeIndex();
		await index.embedPending(10);
		const hybrid = await index.searchHybrid("traversal");
		assert.equal(hybrid.hits[0].item.id, "2");
	});

	it("honours project scope in the vector half too", async () => {
		// Fusing two lists drawn from different corpora would be meaningless.
		const index = await makeIndex();
		await index.embedPending(10);
		const key = index.get("3").projectKey;
		const result = await index.searchHybrid("diff hunk", { projectKey: key });
		assert.ok(result.hits.length > 0);
		assert.ok(result.hits.every((h) => h.item.projectKey === key));
		assert.equal(result.scope, "project");
	});

	it("honours a kind filter in the vector half too", async () => {
		const index = await makeIndex();
		await index.embedPending(10);
		const result = await index.searchHybrid("retention", {
			kinds: ["subagent_report"],
		});
		assert.deepEqual(
			result.hits,
			[],
			"no web searches may leak through the vector half",
		);
	});

	it("a model that fails mid-session degrades to lexical, not to an error", async () => {
		// The first version of this test broke the model BEFORE embedding, so it
		// took the "nothing embedded yet" branch and passed without ever
		// exercising a mid-session failure. Embed first, then break it.
		const index = await makeIndex();
		await index.embedPending(10);
		assert.equal((await index.searchHybrid("retention")).retrieval, "hybrid");

		index.breakModel();
		const result = await index.searchHybrid("retention");
		assert.equal(result.retrieval, "lexical", "degraded, and said so");
		assert.ok(result.hits.length > 0, "the lexical answer still arrives");
	});

	it("a short batch never pairs a vector with the wrong item", async () => {
		// Attaching vector[i] to item[i] past the end of a short response would
		// silently mislabel documents, which is worse than embedding none.
		const index = await makeIndex({ short: true });
		assert.equal(await index.embedPending(10), 1);
	});

	it("reports coverage in stats, not just availability", async () => {
		const bare = await makeIndex({ embedder: false });
		assert.equal(bare.stats().embeddings.available, false);

		const index = await makeIndex();
		await index.embedPending(2);
		const stats = index.stats();
		assert.equal(stats.embeddings.available, true);
		assert.equal(
			stats.embeddings.embedded,
			2,
			"2 of 3 -- coverage, not a boolean",
		);
		assert.equal(stats.items, 3);
	});
});

describe("embeddings: retrieval mode is always stated", () => {
	it("REGRESSION: the plain lexical path reports its mode too", async () => {
		// The protocol says `retrieval` is always present. It was set only on
		// the hybrid path, so a lexical search returned undefined and a caller
		// could not tell "lexical" from "a core too old to report" -- which is
		// exactly what the field exists to distinguish. Caught by running a
		// restarted core, not by reading the code.
		const index = new ResearchIndex();
		index.ingest({
			id: "1",
			timestamp: "2026-09-03T10:00:00.000Z",
			level: "info",
			sessionId: "s1",
			hook: "PostToolUse",
			event: "PostToolUse",
			message: "",
			tool: "WebSearch",
			details: {
				cwd: "/w/proj",
				projectName: "proj",
				tool_input: { query: "retention" },
				tool_result: { query: "retention", results: [] },
			},
		});
		assert.equal(index.search("retention").retrieval, "lexical");
		assert.equal((await index.searchHybrid("retention")).retrieval, "lexical");
	});
});
