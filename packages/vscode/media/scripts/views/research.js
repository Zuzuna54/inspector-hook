/**
 * Research view (M4) — search your own work history.
 *
 * The core has indexed research since M4 landed and nothing could reach it:
 * 599 items, three registered IPC methods, zero references in the webview. This
 * is the client half.
 *
 * ## Two things this view refuses to do
 *
 * It never shows a hit count without its scope. "12 hits" means something
 * different across one project than across eleven, and the core reports which
 * it searched precisely so the number is not ambiguous here.
 *
 * It never leaves a spinner running on failure. A search that errors renders as
 * a failed search with the reason — this project has shipped a permanent
 * loading state three times (the archived diff-error gap, the version-content
 * chain, the digest envelope), every time because a failure path sent nothing.
 *
 * The first version of this file claimed both of those and shipped the second
 * one broken. It never subscribed to `researchView`, and `State.update` only
 * notifies subscribers — so results arrived, landed in state, and nothing
 * re-rendered. Every search spun forever. The claim in a comment is not the
 * behaviour; the subscription in `init` is.
 *
 * ## Why rendering is split into regions
 *
 * Re-rendering the whole view on every state change destroys the search input
 * and the caret inside it, and state changes while a search is in flight. So
 * the shell is written once and each region updates on the slice it depends
 * on: results on results, filters on stats/scope/kinds. The input survives
 * because nothing rewrites it.
 */

const ResearchView = {
	/** Kinds the corpus can hold, with labels a person recognises. */
	KINDS: [
		["web_search", "Searches"],
		["web_fetch", "Pages read"],
		["subagent_task", "Delegated"],
		["subagent_report", "Reports"],
		["user_prompt", "Prompts"],
		["conclusion", "Conclusions"],
		["file_read", "Files"],
	],

	_unsubscribers: [],

	/**
	 * Sources this view can search.
	 *
	 * The plan's division of labour, made visible: "graphify owns the code/docs
	 * graph; the hybrid index owns session/research history. They compose."
	 * They are one search box and two corpora, never blended into one ranked
	 * list -- a symbol and a web lookup have no comparable score, and pretending
	 * otherwise would produce an ordering that means nothing.
	 */
	SOURCES: [
		["history", "History"],
		["graph", "Code graph"],
	],

	/**
	 * Called by the router when this view becomes visible.
	 *
	 * The subscription is the load-bearing line. Without it the view renders
	 * once, at a moment when there are no results, and never again.
	 */
	init() {
		// Build the shell FIRST -- the router calls init() and never render(),
		// so without this the panel keeps its static "Loading research history…"
		// fallback and every region render finds no element.
		this.render();

		this._unsubscribers.push(
			State.subscribe("researchView", (next, prev) => {
				const p = prev || {};
				if (
					next.results !== p.results ||
					next.searching !== p.searching ||
					next.error !== p.error ||
					next.selected !== p.selected
				) {
					this.renderResults();
				}
				// Backfill loop. Each answered batch asks for the next, so a
				// 23-second embed never becomes one blocking call and the view
				// keeps rendering progress in between.
				if (next.embedding && !p.embedding) API.researchEmbedPending(200);
				else if (next.embedding && next.stats !== p.stats) {
					API.researchEmbedPending(200);
				}
				if (
					next.stats !== p.stats ||
					next.embedding !== p.embedding ||
					next.scope !== p.scope ||
					next.kinds !== p.kinds ||
					next.source !== p.source ||
					next.graphStatus !== p.graphStatus
				) {
					this.renderFilters();
					this.renderStats();
				}
				if (
					next.graphResults !== p.graphResults ||
					next.graphSelected !== p.graphSelected ||
					next.graphNeighbors !== p.graphNeighbors ||
					next.neighborsLoading !== p.neighborsLoading ||
					next.source !== p.source
				) {
					this.renderResults();
				}
			}),
		);
		if (!State.researchView.stats) API.researchStats();
		// Asked for unconditionally: whether a graph exists is the first thing
		// the Code graph tab has to be able to say, and "no graph yet" is a
		// normal answer with a specific remedy rather than an error.
		if (!State.researchView.graphStatus) API.graphStatus({});
	},

	cleanup() {
		for (const unsub of this._unsubscribers) unsub();
		this._unsubscribers = [];
	},

	isVisible() {
		return State.currentView === "research";
	},

	render() {
		const container = document.getElementById("research-view");
		if (!container) return;

		// The shell is written once. Regions fill themselves, so a re-render of
		// results cannot take the search input down with it.
		container.innerHTML = `
			<div class="rs-header">
				<div class="rs-sources">${this._renderSources()}</div>
				<div class="rs-searchbar">
					<input id="rs-query" class="rs-input" type="search"
						placeholder="Search what you looked up, asked, delegated and concluded…"
						value="${Utils.escapeHtml((State.researchView || {}).query || "")}" />
					<button id="rs-go" class="btn btn-primary">Search</button>
				</div>
				<div id="rs-filters"></div>
				<div id="rs-stats"></div>
				<div id="rs-graph-status"></div>
			</div>
			<div id="rs-results" class="rs-results"></div>
		`;
		this._bindSearch();
		this._bindSources();
		this.renderFilters();
		this.renderStats();
		this.renderResults();
	},

	_renderSources() {
		const current = (State.researchView || {}).source || "history";
		return this.SOURCES.map(
			([key, label]) =>
				`<button class="rs-source${current === key ? " active" : ""}" data-source="${key}">${label}</button>`,
		).join("");
	},

	_bindSources() {
		for (const btn of document.querySelectorAll(".rs-source")) {
			btn.addEventListener("click", () => {
				const source = btn.dataset.source;
				if (source === State.researchView.source) return;
				for (const other of document.querySelectorAll(".rs-source")) {
					other.classList.toggle("active", other.dataset.source === source);
				}
				// The other source's results are kept, not cleared: switching back
				// should not silently discard a search the user already ran.
				State.update("researchView", {
					...State.researchView,
					source,
					error: null,
				});
				if ((State.researchView.query || "").trim()) this.search();
			});
		}
	},

	/** True when the graph tab is showing. */
	isGraph() {
		return (State.researchView || {}).source === "graph";
	},

	renderFilters() {
		const host = document.getElementById("rs-filters");
		if (!host) return;
		const v = State.researchView || {};

		// Project scope and research kinds mean nothing to a code graph, and
		// leaving them on screen would imply they filter it.
		if (this.isGraph()) {
			host.innerHTML = "";
			this.renderGraphStatus();
			return;
		}
		const graphHost = document.getElementById("rs-graph-status");
		if (graphHost) graphHost.innerHTML = "";
		const project = v.stats && v.stats.defaultProjectKey;
		const kinds = this.KINDS.map(([key, label]) => {
			const on = (v.kinds || []).includes(key);
			const n = v.stats && v.stats.byKind ? v.stats.byKind[key] || 0 : 0;
			return `<button class="rs-kind${on ? " active" : ""}" data-kind="${key}"
				${n === 0 ? "disabled" : ""}>${label}${n ? ` <span class="rs-count">${n}</span>` : ""}</button>`;
		}).join("");

		host.className = "rs-filters";
		host.innerHTML = `
			<div class="rs-scope">
				<button class="rs-scope-btn${v.scope === "all" ? " active" : ""}" data-scope="all">All projects</button>
				<button class="rs-scope-btn${v.scope === "project" ? " active" : ""}" data-scope="project"
					${project ? "" : "disabled title='This core has no default project'"}>This project</button>
			</div>
			<div class="rs-kinds">${kinds}</div>`;
		this._bindFilters();
	},

	renderStats() {
		const host = document.getElementById("rs-stats");
		if (!host) return;
		const v = State.researchView || {};
		if (this.isGraph()) {
			host.innerHTML = "";
			return;
		}
		if (!v.stats) {
			host.innerHTML = "";
			return;
		}
		const projects = Object.keys(v.stats.byProject || {}).length;
		host.className = "rs-stats";
		host.innerHTML = `${v.stats.items} items · ${v.stats.terms} terms · ${projects} project${projects === 1 ? "" : "s"}${this._renderEmbeddingState(v.stats)}`;

		const enable = document.getElementById("rs-enable-embed");
		if (enable) {
			enable.addEventListener("click", () => {
				State.update("researchView", {
					...State.researchView,
					embedding: true,
				});
				API.researchEnableEmbeddings();
			});
		}
	},

	/**
	 * Semantic coverage, as a fraction rather than a light.
	 *
	 * An embedder that is loaded but has embedded 3 of 693 items serves
	 * semantic results for 0.4% of the corpus. Rendering that as "on" would be
	 * true and useless; the fraction is what tells someone whether to wait.
	 */
	_renderEmbeddingState(stats) {
		const e = stats.embeddings;
		if (!e) return "";
		const v = State.researchView || {};

		if (v.embedding) {
			return ` · <span class="rs-embed-partial">embedding ${e.embedded}/${stats.items}…</span>`;
		}
		if (!e.available) {
			// Offered, not performed. Loading the model and embedding a real
			// corpus is roughly half a minute of CPU, which is the user's call.
			const why = e.error ? ` title="${Utils.escapeHtml(e.error)}"` : "";
			return ` · <span class="rs-embed-off"${why}>lexical only</span>
				<button id="rs-enable-embed" class="rs-link-btn">enable semantic search</button>`;
		}
		if (e.embedded < stats.items) {
			return ` · <span class="rs-embed-partial">semantic ${e.embedded}/${stats.items}</span>`;
		}
		return ` · <span class="rs-embed-on">semantic</span>`;
	},

	renderResults() {
		const host = document.getElementById("rs-results");
		if (!host) return;
		if (this.isGraph()) return this.renderGraphResults();
		const v = State.researchView || {};

		if (v.searching) {
			host.innerHTML = `<div class="rs-empty">Searching…</div>`;
			return;
		}
		if (v.error) {
			// The backend's own words, not a paraphrase.
			host.innerHTML = `<div class="rs-error"><strong>Search failed.</strong> ${Utils.escapeHtml(v.error)}</div>`;
			return;
		}
		if (!v.results) {
			host.innerHTML = `<div class="rs-empty">Search your research history — web lookups, subagent reports, prompts, conclusions and the files you read.</div>`;
			return;
		}

		const r = v.results;
		if (!r.hits || r.hits.length === 0) {
			host.innerHTML = `<div class="rs-empty">No matches for <code>${Utils.escapeHtml(v.query || "")}</code> in ${this._scopeLabel(r)}.</div>`;
			return;
		}

		// The count ALWAYS carries its scope. See the header comment.
		const header = `<div class="rs-summary">
			${r.total} match${r.total === 1 ? "" : "es"} in ${this._scopeLabel(r)}
			${r.searched ? `<span class="rs-dim">of ${r.searched} indexed</span>` : ""}
			${this._renderRetrieval(r)}
			${
				r.expandedWith && r.expandedWith.length
					? `<span class="rs-dim" title="terms the corpus associated with your query">+ ${r.expandedWith.map(Utils.escapeHtml).join(", ")}</span>`
					: ""
			}
		</div>`;

		host.innerHTML = header + r.hits.map((h) => this._renderHit(h, v)).join("");
		this._bindHits();
	},

	/**
	 * Which signals produced this ranking.
	 *
	 * Shown because a hybrid search that silently degraded to lexical is
	 * otherwise indistinguishable from one that merely ranked differently --
	 * and the difference is whether a result that shares no words with the
	 * query could have been found at all.
	 */
	_renderRetrieval(r) {
		if (r.retrieval === "hybrid") {
			return `<span class="rs-retrieval" title="BM25 and local embeddings, fused on rank">hybrid</span>`;
		}
		if (r.retrieval === "lexical") {
			return `<span class="rs-retrieval rs-retrieval-lexical" title="Keyword matching only — embeddings are unavailable">lexical</span>`;
		}
		return "";
	},

	_scopeLabel(r) {
		return r.scope === "project" ? `this project` : `all projects`;
	},

	_renderHit(hit, v) {
		const item = hit.item || {};
		const kind = (this.KINDS.find(([k]) => k === item.kind) || [
			null,
			item.kind,
		])[1];
		const open = v.selected && v.selected.id === item.id;
		const when = item.timestamp ? item.timestamp.slice(0, 10) : "";
		const project = item.projectName || "";

		return `
			<div class="rs-hit${open ? " open" : ""}" data-id="${Utils.escapeHtml(item.id || "")}">
				<div class="rs-hit-head">
					<span class="rs-kind-tag rs-kind-${Utils.escapeHtml(item.kind || "")}">${Utils.escapeHtml(kind || "")}</span>
					<span class="rs-hit-title">${Utils.escapeHtml(item.title || "(untitled)")}</span>
					<span class="rs-hit-meta">${Utils.escapeHtml(project)} ${when}</span>
				</div>
				${open ? `<pre class="rs-hit-body">${Utils.escapeHtml(item.text || "")}</pre>` : ""}
				${item.url ? `<a class="rs-hit-url" href="${Utils.escapeHtml(item.url)}">${Utils.escapeHtml(item.url)}</a>` : ""}
			</div>`;
	},

	/** Run the current query. Exposed on the object so tests can drive it. */
	search() {
		const input = document.getElementById("rs-query");
		const query = input ? input.value : "";
		State.update("researchView", {
			...State.researchView,
			query,
			searching: Boolean(query.trim()),
			error: null,
		});
		if (!query.trim()) return;
		const v = State.researchView;
		if (this.isGraph()) {
			API.graphSearch({ query, limit: 30 });
			return;
		}
		// The GLOBAL project filter wins when one is selected.
		//
		// This view's own toggle resolves "this project" through
		// `stats.defaultProjectKey`, which the core INFERS from the workspace
		// and which reaches a minority of the corpus. The global filter does
		// not infer: it is a project the user picked from a list the core
		// reconciled, and it carries the git remote — which is the key this
		// index actually stores. So when it is set, it is the better answer.
		const picked =
			typeof ProjectFilter !== "undefined" ? ProjectFilter.selected() : null;
		const globalKey = picked && picked.gitRemote;

		API.researchSearch({
			query,
			// Scope is only sent when the user asked for it. Omitting the key
			// is what makes the search cross-project.
			...(globalKey
				? { projectKey: globalKey }
				: v.scope === "project" && v.stats && v.stats.defaultProjectKey
					? { projectKey: v.stats.defaultProjectKey }
					: {}),
			...(v.kinds && v.kinds.length ? { kinds: v.kinds } : {}),
			limit: 30,
		});
	},

	_bindSearch() {
		const input = document.getElementById("rs-query");
		const go = document.getElementById("rs-go");
		if (go) go.addEventListener("click", () => this.search());
		if (input) {
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.search();
			});
		}
	},

	_bindFilters() {
		for (const btn of document.querySelectorAll(".rs-scope-btn")) {
			btn.addEventListener("click", () => {
				State.update("researchView", {
					...State.researchView,
					scope: btn.dataset.scope,
				});
				if ((State.researchView.query || "").trim()) this.search();
			});
		}

		for (const btn of document.querySelectorAll(".rs-kind")) {
			btn.addEventListener("click", () => {
				const kind = btn.dataset.kind;
				const current = State.researchView.kinds || [];
				const next = current.includes(kind)
					? current.filter((k) => k !== kind)
					: [...current, kind];
				State.update("researchView", { ...State.researchView, kinds: next });
				if ((State.researchView.query || "").trim()) this.search();
			});
		}
	},

	_bindHits() {
		for (const hit of document.querySelectorAll(".rs-hit")) {
			hit.addEventListener("click", () => {
				const id = hit.dataset.id;
				const sel = State.researchView.selected;
				// Toggle: clicking the open hit closes it.
				if (sel && sel.id === id) {
					State.update("researchView", {
						...State.researchView,
						selected: null,
					});
					return;
				}
				const found = (State.researchView.results?.hits || [])
					.map((h) => h.item)
					.find((i) => i && i.id === id);
				State.update("researchView", {
					...State.researchView,
					selected: found || null,
				});
			});
		}
	},
};

// The graph renderer lives in research/graph-render.js so this file stays
// under the size guard. Composed rather than merged into the literal so a
// missing module is a load-time absence, not a silently undefined method.
if (typeof window !== "undefined" && window.GraphRenderMixin) {
	Object.assign(ResearchView, window.GraphRenderMixin);
}

if (typeof window !== "undefined") window.ResearchView = ResearchView;

// Register with the router, or the Research tab does nothing at all: router.js
// warns to a console nobody reads and returns, so an unregistered view is
// indistinguishable from an empty one. Every other view does this; this file
// was one line from working.
if (typeof Router !== "undefined" && Router.register) {
	Router.register("research", ResearchView);
}
