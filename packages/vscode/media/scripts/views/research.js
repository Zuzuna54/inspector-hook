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
	 * Called by the router when this view becomes visible.
	 *
	 * The subscription is the load-bearing line. Without it the view renders
	 * once, at a moment when there are no results, and never again.
	 */
	init() {
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
				if (
					next.stats !== p.stats ||
					next.scope !== p.scope ||
					next.kinds !== p.kinds
				) {
					this.renderFilters();
					this.renderStats();
				}
			}),
		);
		if (!State.researchView.stats) API.researchStats();
	},

	cleanup() {
		this._unsubscribers.forEach((unsub) => unsub());
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
				<div class="rs-searchbar">
					<input id="rs-query" class="rs-input" type="search"
						placeholder="Search what you looked up, asked, delegated and concluded…"
						value="${Utils.escapeHtml((State.researchView || {}).query || "")}" />
					<button id="rs-go" class="btn btn-primary">Search</button>
				</div>
				<div id="rs-filters"></div>
				<div id="rs-stats"></div>
			</div>
			<div id="rs-results" class="rs-results"></div>
		`;
		this._bindSearch();
		this.renderFilters();
		this.renderStats();
		this.renderResults();
	},

	renderFilters() {
		const host = document.getElementById("rs-filters");
		if (!host) return;
		const v = State.researchView || {};
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
		if (!v.stats) {
			host.innerHTML = "";
			return;
		}
		const projects = Object.keys(v.stats.byProject || {}).length;
		host.className = "rs-stats";
		host.innerHTML = `${v.stats.items} items · ${v.stats.terms} terms · ${projects} project${projects === 1 ? "" : "s"}`;
	},

	renderResults() {
		const host = document.getElementById("rs-results");
		if (!host) return;
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
			${
				r.expandedWith && r.expandedWith.length
					? `<span class="rs-dim" title="terms the corpus associated with your query">+ ${r.expandedWith.map(Utils.escapeHtml).join(", ")}</span>`
					: ""
			}
		</div>`;

		host.innerHTML = header + r.hits.map((h) => this._renderHit(h, v)).join("");
		this._bindHits();
	},

	_scopeLabel(r) {
		return r.scope === "project" ? `this project` : `all projects`;
	},

	_renderHit(hit, v) {
		const item = hit.item || {};
		const kind = (this.KINDS.find(([k]) => k === item.kind) || [null, item.kind])[1];
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
		API.researchSearch({
			query,
			// Scope is only sent when the user asked for it. Omitting the key
			// is what makes the search cross-project.
			...(v.scope === "project" && v.stats && v.stats.defaultProjectKey
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
					State.update("researchView", { ...State.researchView, selected: null });
					return;
				}
				const found = (State.researchView.results?.hits || [])
					.map((h) => h.item)
					.find((i) => i && i.id === id);
				State.update("researchView", { ...State.researchView, selected: found || null });
			});
		}
	},
};

if (typeof window !== "undefined") window.ResearchView = ResearchView;

// Register with the router, or the Research tab does nothing at all: router.js
// warns to a console nobody reads and returns, so an unregistered view is
// indistinguishable from an empty one. Every other view does this; this file
// was one line from working.
if (typeof Router !== "undefined" && Router.register) {
	Router.register("research", ResearchView);
}
