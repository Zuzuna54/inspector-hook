/**
 * Find — search four corpora at once (M3 P8).
 *
 * ## Why this is separate from the Search view
 *
 * Search (M4) answers "what did I look up" over the research corpus, with
 * embeddings and query expansion. This answers "where did I do this before"
 * over the material the context surfaces hold: memory files, session digests,
 * file changes — and prompts, which it delegates back to that same research
 * index rather than keeping a second, weaker copy.
 *
 * The two overlap on exactly one corpus, and that overlap is deliberate: the
 * prompt group here IS the research index answering, kind-filtered.
 *
 * ## The subscription is the behaviour
 *
 * `State.update` only notifies subscribers. The Search view shipped once with
 * every claim in its header comment true and no subscription, so results
 * arrived, landed in state, and nothing re-rendered — every search spun
 * forever. A comment is not the behaviour; `init` is. This view subscribes
 * before it can receive anything.
 *
 * ## Rendering is split so the input survives
 *
 * State changes while a search is in flight, and re-rendering the whole view
 * destroys the search box and the caret inside it. So the shell is written
 * once and the results region updates on its own.
 */

const FindView = {
	_unsubscribers: [],
	_debounce: null,

	init() {
		// The shell FIRST: the router calls init() and never render(), so
		// without this the panel keeps its static fallback and every region
		// render finds no element to write into.
		this.render();

		this._unsubscribers.push(
			// The global filter scopes this view, so a change to it has to
			// re-run the query. Without this the results stay scoped to
			// whatever was selected when they were fetched, while the header
			// says something else.
			State.subscribe("projectFilter", (next, prev) => {
				if (prev && next.selectedId === prev.selectedId) return;
				this.renderScope();
				if (State.contextFind.query) this.search(State.contextFind.query);
			}),
		);

		this._unsubscribers.push(
			State.subscribe("contextFind", (next, prev) => {
				const p = prev || {};
				if (
					next.groups !== p.groups ||
					next.searching !== p.searching ||
					next.collapsed !== p.collapsed
				) {
					this.renderResults();
				}
				if (next.stats !== p.stats) this.renderStatsRegion();
				if (next.groups !== p.groups) this.renderScope();
			}),
		);

		API.contextFindStats();
	},

	destroy() {
		for (const off of this._unsubscribers) {
			if (typeof off === "function") off();
		}
		this._unsubscribers = [];
		if (this._debounce) clearTimeout(this._debounce);
	},

	render() {
		const container = document.getElementById("find-view");
		if (!container) return;

		const state = State.contextFind || {};
		container.innerHTML = `
      <div class="fd-header">
        <div class="fd-searchbar">
          <input type="search" id="fd-query" class="fd-input"
                 placeholder="Search memory, digests, changes and prompts…"
                 value="${Utils.escapeHtml(state.query || "")}"
                 aria-label="Search your history">
          <button class="btn btn-sm fd-refresh" title="Re-read the sources now, instead of waiting for the staleness window">
            Rebuild
          </button>
        </div>
        <div id="fd-stats"></div>
        <div id="fd-scope"></div>
      </div>
      <div id="fd-results" class="fd-results"></div>
    `;

		this.bind(container);
		this.renderStatsRegion();
		this.renderScope();
		this.renderResults();
	},

	bind(container) {
		const input = container.querySelector("#fd-query");
		if (input) {
			// Debounced: every keystroke would otherwise ask the core, and a
			// search past the staleness window re-reads every memory file.
			input.addEventListener("input", (e) => {
				const query = e.target.value;
				if (this._debounce) clearTimeout(this._debounce);
				this._debounce = setTimeout(() => this.search(query), 220);
			});
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					if (this._debounce) clearTimeout(this._debounce);
					this.search(e.target.value);
				}
			});
		}

		container.addEventListener("click", (e) => {
			if (e.target.closest(".fd-refresh")) {
				API.contextFindRefresh();
				const query = State.contextFind?.query;
				if (query) this.search(query, true);
				return;
			}

			const toggle = e.target.closest(".fd-group-toggle");
			if (toggle) {
				this.toggleCorpus(toggle.dataset.corpus);
				return;
			}

			const add = e.target.closest(".fd-add");
			if (add && !add.disabled) {
				// The id, not the snippet. The core resolves it back to the
				// source, because a 600-character snippet added as if it were
				// the whole file is the quiet wrongness this project keeps
				// finding.
				API.contextAddFromFind({ id: add.dataset.hitId });
				add.textContent = "Added";
				add.disabled = true;
			}
		});
	},

	search(query, refresh) {
		const trimmed = String(query || "").trim();
		State.update("contextFind", {
			...State.contextFind,
			query: trimmed,
			searching: Boolean(trimmed),
			groups: trimmed ? State.contextFind.groups : [],
		});
		if (!trimmed) return;
		// The GLOBAL filter, not a per-view one. A scope you have to re-apply in
		// each view is a scope you will forget you applied.
		API.contextFind({
			query: trimmed,
			projectId: ProjectFilter.selected()?.id,
			limit: 20,
			refresh: Boolean(refresh),
		});
	},

	toggleCorpus(corpus) {
		if (!corpus) return;
		const collapsed = State.contextFind.collapsed || [];
		State.update("contextFind", {
			...State.contextFind,
			collapsed: collapsed.includes(corpus)
				? collapsed.filter((c) => c !== corpus)
				: [...collapsed, corpus],
		});
	},

	renderResults() {
		const host = document.getElementById("fd-results");
		if (!host) return;
		host.innerHTML = this.renderGroups(State.contextFind || {});
	},

	/** What this view is scoped to, and what it could not attribute. */
	renderScope() {
		const host = document.getElementById("fd-scope");
		if (!host) return;
		const unattributed = (State.contextFind?.groups || []).reduce(
			(n, g) => n + (g.unattributed || 0),
			0,
		);
		host.innerHTML = ProjectPicker.scopeLine(unattributed);
	},

	renderStatsRegion() {
		const host = document.getElementById("fd-stats");
		if (!host) return;
		host.innerHTML = this.renderStats(State.contextFind?.stats);
	},
};

if (typeof window !== "undefined" && window.FindRenderMixin) {
	Object.assign(FindView, window.FindRenderMixin);
}

if (typeof window !== "undefined") window.FindView = FindView;

// Register, or the tab does nothing at all: router.js warns to a console
// nobody reads and returns, so an unregistered view is indistinguishable from
// an empty one. The Research view was one line from working for exactly this
// reason.
if (typeof Router !== "undefined" && Router.register) {
	Router.register("find", FindView);
}
