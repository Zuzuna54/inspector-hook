/**
 * Local embeddings — the other half of M4's hybrid retrieval.
 *
 * ## What was tried before this, and why it was thrown away
 *
 * `semantic.ts` approximates meaning with corpus co-occurrence and no
 * dependency at all. It was measured against the live corpus and it does not
 * work: better than lexical on 0 of 3 known-answer queries, and it expanded
 * queries with git hashes and uids. It is still there, off by default, because
 * a rejected approach is worth more recorded than deleted.
 *
 * This is the real thing: sentence embeddings from a local model, offline,
 * no API key — exactly what the plan asked for.
 *
 * ## Measured on the live corpus, 693 items, 5 known-answer queries
 *
 * Relevance was fixed by regex BEFORE any ranking was looked at, so neither
 * method could be tuned to the answer. Mean reciprocal rank:
 *
 *     BM25 alone        0.440
 *     embeddings alone  0.614
 *     HYBRID (RRF)      0.700     <- and never worse than either alone
 *
 *     query                        BM25   embed  hybrid
 *     stop the store growing          2       1       1
 *     tool call reported wrong        1       1       1
 *     writing outside the folder      5      14       2   <- lexical saves it
 *     how do agents talk to me        2       1       1
 *
 * That third row is the whole argument for hybrid rather than replacement.
 * "writing outside the folder" is answered by documents about *path traversal*,
 * which embeddings rank at 14 and BM25 finds at 5 — and fusing them puts it at
 * 2. Neither signal is reliably better; used together they beat both.
 *
 * Cost, same run: 23.3s to embed 693 items (33.7ms each), 1.0MB of float32
 * vectors, 4.5s one-time model load.
 *
 * ## Why the dependency is optional and loaded dynamically
 *
 * `@xenova/transformers` pulls ~255MB with a native onnxruntime binary. A core
 * that cannot start without it would be a worse tool for everyone who does not
 * want semantic search, so `loadEmbedder` returns null on any failure and
 * retrieval falls back to BM25 alone. Degrading is a supported state, not an
 * error path.
 *
 * There is a concrete reason to distrust "it installs, therefore it runs": the
 * plan chose `@huggingface/transformers`, and on this machine that package
 * cannot load at all. It resolves its native binding as
 * `bin/napi-v6/darwin/x64/...`, ships only `darwin/arm64`, and imports it
 * eagerly, so even `device: "wasm"` throws. This machine is a genuine Intel
 * Mac. `@xenova/transformers` pins an onnxruntime that still ships darwin/x64,
 * which is why it is the one used here.
 */

/** The interface a search needs. Anything satisfying it can be swapped in. */
export interface Embedder {
	readonly name: string;
	readonly dimensions: number;
	/** Embed a batch. Vectors are L2-normalised, so cosine is a dot product. */
	embed(texts: string[]): Promise<Float32Array[]>;
}

/**
 * 384 dimensions, ~23MB quantised, and the smallest model that measured well
 * on this corpus. Bigger models are better in benchmarks and slower here.
 */
export const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Text beyond this is dropped before embedding.
 *
 * The model truncates at 256 word-pieces regardless, so sending more is time
 * spent on tokens the model will discard. The measurement above used this
 * limit; a different one would invalidate those numbers.
 */
export const MAX_EMBED_CHARS = 1200;

/** Items per forward pass. Larger batches are faster but hold more memory. */
export const EMBED_BATCH = 32;

/**
 * The package name, held in a constant rather than written inline.
 *
 * A literal `import("@xenova/transformers")` is resolved at BUILD time —
 * esbuild fails the bundle and tsc fails the typecheck when the package is
 * absent, which defeats the entire point of an optional dependency. An opaque
 * specifier defers the resolution to runtime, where a failure is caught and
 * reported as "no embeddings" exactly as intended.
 */
const EMBEDDING_PACKAGE = "@xenova/transformers";

/**
 * Load the local embedding model, or return null.
 *
 * Never throws. A missing dependency, a missing native binary, or a failed
 * model download all mean the same thing to a caller: no embeddings, use BM25.
 */
export async function loadEmbedder(options?: {
	model?: string;
	/** Override the import, so tests do not need the real 255MB dependency. */
	loader?: () => Promise<unknown>;
	/** Where the model is cached. Defaults to the library's own location. */
	cacheDir?: string;
	/**
	 * Called with the reason when loading fails.
	 *
	 * Not optional decoration. The first real failure here was sharp's native
	 * binding missing, and because this function only returned null, the
	 * symptom was "semantic search is quietly off" with nothing anywhere saying
	 * why. A caller that cannot find out why cannot fix it, so the reason is
	 * always offered even though the return value stays null.
	 */
	onError?: (reason: string) => void;
}): Promise<Embedder | null> {
	const model = options?.model ?? DEFAULT_MODEL;
	try {
		const mod = (await (options?.loader
			? options.loader()
			: import(EMBEDDING_PACKAGE))) as {
			pipeline: (
				task: string,
				model: string,
				opts?: unknown,
			) => Promise<unknown>;
			env?: { cacheDir?: string };
		};

		if (options?.cacheDir && mod.env) mod.env.cacheDir = options.cacheDir;

		const extractor = (await mod.pipeline("feature-extraction", model, {
			quantized: true,
		})) as (
			texts: string[],
			opts: unknown,
		) => Promise<{ tolist(): number[][] }>;

		return {
			name: model,
			dimensions: EMBEDDING_DIMENSIONS,
			async embed(texts: string[]): Promise<Float32Array[]> {
				const out: Float32Array[] = [];
				for (let i = 0; i < texts.length; i += EMBED_BATCH) {
					const batch = texts
						.slice(i, i + EMBED_BATCH)
						.map((t) => (t ?? "").slice(0, MAX_EMBED_CHARS) || " ");
					const result = await extractor(batch, {
						pooling: "mean",
						normalize: true,
					});
					for (const vector of result.tolist()) {
						out.push(Float32Array.from(vector));
					}
				}
				return out;
			},
		};
	} catch (error) {
		options?.onError?.(
			error instanceof Error ? error.message.split("\n")[0] : String(error),
		);
		return null;
	}
}

/**
 * Cosine similarity of two L2-normalised vectors, which is their dot product.
 *
 * Not re-normalised here. Every vector in this module comes out of the model
 * already normalised, and normalising twice would hide a bug where one is not.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) return 0;
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
}

export interface VectorHit {
	id: string;
	score: number;
}

/**
 * Brute-force vector search.
 *
 * No ANN index, deliberately. At the measured corpus size a full scan of 693
 * vectors is well under a millisecond, and an approximate index would add a
 * dependency, a build step and a class of "the right answer was not in the
 * candidate set" bug in exchange for nothing at this scale.
 */
export class VectorStore {
	private readonly vectors = new Map<string, Float32Array>();

	constructor(readonly dimensions: number = EMBEDDING_DIMENSIONS) {}

	get size(): number {
		return this.vectors.size;
	}

	has(id: string): boolean {
		return this.vectors.has(id);
	}

	/** Store a vector. A wrong-length vector is refused, not silently kept. */
	add(id: string, vector: Float32Array): boolean {
		if (!id || vector.length !== this.dimensions) return false;
		this.vectors.set(id, vector);
		return true;
	}

	remove(id: string): boolean {
		return this.vectors.delete(id);
	}

	clear(): void {
		this.vectors.clear();
	}

	/** Ids present here, for finding what still needs embedding. */
	ids(): string[] {
		return [...this.vectors.keys()];
	}

	search(
		query: Float32Array,
		options?: { limit?: number; filter?: (id: string) => boolean },
	): VectorHit[] {
		if (query.length !== this.dimensions) return [];
		const hits: VectorHit[] = [];
		for (const [id, vector] of this.vectors) {
			if (options?.filter && !options.filter(id)) continue;
			hits.push({ id, score: cosine(query, vector) });
		}
		// Ties broken by id so the ordering is stable across runs; an unstable
		// ranking cannot be reasoned about or tested.
		hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
		return hits.slice(0, options?.limit ?? 20);
	}

	/**
	 * Serialise.
	 *
	 * Base64 of the raw float32 bytes rather than JSON arrays: a 384-dimension
	 * vector is 2KB of base64 against roughly 8KB as decimal text, and the
	 * bytes round-trip exactly instead of through decimal formatting.
	 */
	toJSON(): {
		version: 1;
		dimensions: number;
		vectors: Record<string, string>;
	} {
		const vectors: Record<string, string> = {};
		for (const [id, vector] of this.vectors) {
			vectors[id] = Buffer.from(
				vector.buffer,
				vector.byteOffset,
				vector.byteLength,
			).toString("base64");
		}
		return { version: 1, dimensions: this.dimensions, vectors };
	}

	static fromJSON(raw: unknown): VectorStore {
		const doc = (raw ?? {}) as {
			dimensions?: unknown;
			vectors?: Record<string, unknown>;
		};
		const dimensions =
			typeof doc.dimensions === "number"
				? doc.dimensions
				: EMBEDDING_DIMENSIONS;
		const store = new VectorStore(dimensions);
		for (const [id, encoded] of Object.entries(doc.vectors ?? {})) {
			if (typeof encoded !== "string") continue;
			try {
				const buffer = Buffer.from(encoded, "base64");
				// A truncated or padded entry would otherwise become a vector of
				// the wrong length and silently score against everything.
				if (buffer.byteLength !== dimensions * 4) continue;
				const copy = new Float32Array(dimensions);
				Buffer.from(copy.buffer).set(buffer);
				store.add(id, copy);
			} catch {
				// One unreadable vector must not lose the rest of the store.
			}
		}
		return store;
	}
}

/**
 * How steeply rank position is discounted in fusion.
 *
 * 60 is the value from the original reciprocal-rank-fusion paper and the one
 * the measurement above used. It is large enough that the top few ranks are
 * not overwhelmingly dominant, which is what stops a single confident-but-wrong
 * list from deciding the result.
 */
export const RRF_K = 60;

export interface FusedHit {
	id: string;
	score: number;
	/** Which input list contributed, and at what rank — for explaining a hit. */
	ranks: Record<string, number>;
}

/**
 * Reciprocal rank fusion of several ranked id lists.
 *
 * Fusing on RANK rather than score is the point. A BM25 score and a cosine
 * similarity are not on a comparable scale and no weighting makes them so;
 * any attempt to combine them numerically is really a hidden guess about their
 * relative magnitudes. Rank positions are directly comparable, need no
 * normalisation, and cannot be distorted by one list's scores being large.
 */
export function reciprocalRankFusion(
	lists: Record<string, string[]>,
	k: number = RRF_K,
): FusedHit[] {
	const scores = new Map<string, number>();
	const ranks = new Map<string, Record<string, number>>();

	for (const [name, ids] of Object.entries(lists)) {
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			if (!id) continue;
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
			const existing = ranks.get(id);
			if (existing) existing[name] = i + 1;
			else ranks.set(id, { [name]: i + 1 });
		}
	}

	return [...scores.entries()]
		.map(([id, score]) => ({ id, score, ranks: ranks.get(id) ?? {} }))
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
