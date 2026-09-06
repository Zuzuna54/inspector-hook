/**
 * Research view (M4) — search your own work history.
 *
 * The core has indexed research since M4 landed and nothing could reach it:
 * 569 items, three registered IPC methods, zero references in the webview. This
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

	/** Called by the router when this view becomes visible. */
	init() {
		if (!State.researchView.stats) API.researchStats();
	},

	isVisible() {
		return State.currentView === "research";
	},

	render() {
		const v = State.researchView || {};
		const container = document.getElementById("research-view");
		if (!container) return;

		container.innerHTML = `
			<div class="rs-header">
				<div class="rs-searchbar">
					<input id="rs-query" class="rs-input" type="search"
						placeholder="Search what you looked up, asked, delegated and concluded…"
						value="${Utils.escapeHtml(v.query || "")}" />
					<button id="rs-go" class="btn btn-primary">Search</button>
				</div>
				${this._renderScope(v)}
				${this._renderStats(v)}
			</div>
			<div class="rs-results">${this._renderResults(v)}</div>
		`;
		this._bind();
	},

	_renderScope(v) {
		const project = v.stats && v.stats.defaultProjectKey;
		const kinds = this.KINDS.map(([key, label]) => {
			const on = (v.kinds || []).includes(key);
			const n = v.stats && v.stats.byKind ? v.stats.byKind[key] || 0 : 0;
			return `<button class="rs-kind${on ? " active" : ""}" data-kind="${key}"
				${n === 0 ? "disabled" : ""}>${label}${n ? ` <span class="rs-count">${n}</span>` : ""}</button>`;
		}).join("");

		return `
			<div class="rs-filters">
				<div class="rs-scope">
					<button class="rs-scope-btn${v.scope === "all" ? " active" : ""}" data-scope="all">All projects</button>
					<button class="rs-scope-btn${v.scope === "project" ? " active" : ""}" data-scope="project"
						${project ? "" : "disabled title='This core has no default project'"}>This project</button>
				</div>
				<div class="rs-kinds">${kinds}</div>
			</div>`;
	},

	_renderStats(v) {
		if (!v.stats) return "";
		const projects = Object.keys(v.stats.byProject || {}).length;
		return `<div class="rs-stats">${v.stats.items} items · ${v.stats.terms} terms · ${projects} project${projects === 1 ? "" : "s"}</div>`;
	},

	_renderResults(v) {
		if (v.searching) return `<div class="rs-empty">Searching…</div>`;
		if (v.error) {
			// The backend's own words, not a paraphrase.
			return `<div class="rs-error"><strong>Search failed.</strong> ${Utils.escapeHtml(v.error)}</div>`;
		}
		if (!v.results) {
			return `<div class="rs-empty">Search your research history — web lookups, subagent reports, prompts, conclusions and the files you read.</div>`;
		}

		const r = v.results;
		if (!r.hits || r.hits.length === 0) {
			return `<div class="rs-empty">No matches for <code>${Utils.escapeHtml(v.query)}</code> in ${this._scopeLabel(r)}.</div>`;
		}

		// The count ALWAYS carries its scope. See the header comment.
		const header = `<div class="rs-summary">
			${r.total} match${r.total === 1 ? "" : "es"} in ${this._scopeLabel(r)}
			${r.searched ? `<span class="rs-dim">of ${r.searched} indexed</span>` : ""}
			${r.expandedWith && r.expandedWith.length
				? `<span class="rs-dim" title="terms the corpus associated with your query">+ ${r.expandedWith.map(Utils.escapeHtml).join(", ")}</span>`
				: ""}
		</div>`;

		return header + r.hits.map((h) => this._renderHit(h, v)).join("");
	},

	_scopeLabel(r) {
		return r.scope === "project"
			? `this project`
			: `all projects`;
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

	_bind() {
		const input = document.getElementById("rs-query");
		const go = document.getElementById("rs-go");

		const run = () => {
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
		};

		if (go) go.addEventListener("click", run);
		if (input) {
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") run();
			});
		}

		for (const btn of document.querySelectorAll(".rs-scope-btn")) {
			btn.addEventListener("click", () => {
				State.update("researchView", {
					...State.researchView,
					scope: btn.dataset.scope,
				});
				if (State.researchView.query.trim()) run();
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
				if (State.researchView.query.trim()) run();
			});
		}

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
