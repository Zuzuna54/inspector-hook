/**
 * Rendering for the graphify code/docs graph, mixed into ResearchView.
 *
 * Split out to keep research.js under the 600-line guard, and because the two
 * result shapes have nothing in common: a research hit is an event with a
 * timestamp and a project, a graph hit is a symbol with a file, a degree and
 * edges leading somewhere.
 *
 * ## The status line is not decoration
 *
 * A graph built ten commits ago will confidently return symbols that no longer
 * exist. `stale` is three-valued for that reason — true, false, or null when
 * the build commit or HEAD could not be read — and this renders all three
 * distinctly. "Unknown age" must never be drawn the same as "current".
 */

(() => {
	window.GraphRenderMixin = {
		/**
		 * The banner above graph results: size, age, and how to build one.
		 *
		 * When there is no graph this is the whole view, because "no graph yet"
		 * is a normal state with a specific remedy, not an error.
		 */
		renderGraphStatus() {
			const host = document.getElementById("rs-graph-status");
			if (!host) return;
			const s = State.researchView?.graphStatus;

			if (!s) {
				host.innerHTML = `<div class="rs-dim">Checking for a code graph…</div>`;
				return;
			}

			if (!s.available) {
				host.innerHTML = `
					<div class="rs-graph-missing">
						<strong>No code graph for this workspace.</strong>
						${s.error ? `<div class="rs-error-detail">${Utils.escapeHtml(s.error)}</div>` : ""}
						<div class="rs-dim">Build one with <code>graphify update .</code> — it is
						AST-only, so it needs no API key and no network.</div>
					</div>`;
				return;
			}

			host.innerHTML = `
				<div class="rs-graph-stats">
					<span>${s.nodes} nodes · ${s.edges} edges · ${s.communities} communities</span>
					${this.renderFreshness(s)}
				</div>`;
		},

		/** Three-valued freshness. See the header comment. */
		renderFreshness(s) {
			if (s.stale === null) {
				return `<span class="rs-badge rs-badge-unknown"
					title="No build commit recorded, or HEAD could not be read">age unknown</span>`;
			}
			if (s.stale) {
				return `<span class="rs-badge rs-badge-stale"
					title="Built at ${Utils.escapeHtml(String(s.builtAtCommit || "").slice(0, 8))}, HEAD is ${Utils.escapeHtml(String(s.headCommit || "").slice(0, 8))}">out of date</span>`;
			}
			return `<span class="rs-badge rs-badge-fresh" title="Built at the current HEAD">current</span>`;
		},

		renderGraphResults() {
			const host = document.getElementById("rs-results");
			if (!host) return;
			const v = State.researchView || {};

			if (v.searching) {
				host.innerHTML = `<div class="rs-empty">Searching the graph…</div>`;
				return;
			}
			if (v.error) {
				host.innerHTML = `<div class="rs-error"><strong>Graph query failed.</strong> ${Utils.escapeHtml(v.error)}</div>`;
				return;
			}
			const r = v.graphResults;
			if (!r) {
				host.innerHTML = `<div class="rs-empty">Search the code and docs graph — symbols, the files they live in, and what calls what.</div>`;
				return;
			}
			if (!r.hits || r.hits.length === 0) {
				host.innerHTML = `<div class="rs-empty">No nodes match <code>${Utils.escapeHtml(v.query || "")}</code>.</div>`;
				return;
			}

			// As with history results, the count carries its universe.
			const header = `<div class="rs-summary">
				${r.total} node${r.total === 1 ? "" : "s"} match
				${r.searched ? `<span class="rs-dim">of ${r.searched} in the graph</span>` : ""}
			</div>`;

			host.innerHTML =
				header + r.hits.map((h) => this.renderGraphHit(h, v)).join("");
			this._bindGraphHits();
		},

		renderGraphHit(hit, v) {
			const n = hit.node || {};
			const open = v.graphSelected && v.graphSelected.id === n.id;
			return `
				<div class="rs-hit rs-graph-hit${open ? " open" : ""}" data-node="${Utils.escapeHtml(n.id || "")}">
					<div class="rs-hit-head">
						<span class="rs-kind-tag rs-ft-${Utils.escapeHtml(n.fileType || "")}">${Utils.escapeHtml(n.fileType || "")}</span>
						<span class="rs-hit-title">${Utils.escapeHtml(n.label || n.id || "")}</span>
						<span class="rs-hit-meta">
							${Utils.escapeHtml(n.sourceFile || "")}${n.sourceLocation ? `:${Utils.escapeHtml(n.sourceLocation)}` : ""}
							<span class="rs-degree" title="edges touching this node">${hit.degree}</span>
						</span>
					</div>
					${open ? this.renderNeighbors(v) : ""}
				</div>`;
		},

		/** The expanded panel: what the selected node connects to. */
		renderNeighbors(v) {
			if (v.neighborsLoading) {
				return `<div class="rs-neighbors"><div class="rs-dim">Loading connections…</div></div>`;
			}
			const nb = v.graphNeighbors;
			if (!nb?.neighbors) return "";
			if (nb.neighbors.length === 0) {
				return `<div class="rs-neighbors"><div class="rs-dim">Nothing connects to this node.</div></div>`;
			}

			// Grouped by direction, because "what calls this" and "what this
			// calls" are different questions and the graph file itself does not
			// distinguish them.
			const out = nb.neighbors.filter((n) => n.direction === "out");
			const incoming = nb.neighbors.filter((n) => n.direction === "in");

			return `<div class="rs-neighbors">
				${this.renderNeighborGroup("This node →", out)}
				${this.renderNeighborGroup("→ This node", incoming)}
			</div>`;
		},

		renderNeighborGroup(title, list) {
			if (list.length === 0) return "";
			return `
				<div class="rs-neighbor-group">
					<div class="rs-neighbor-title">${Utils.escapeHtml(title)}</div>
					${list
						.map(
							(n) => `<div class="rs-neighbor">
								<span class="rs-relation">${Utils.escapeHtml(n.relation)}</span>
								<span class="rs-neighbor-label">${Utils.escapeHtml(n.node.label || "")}</span>
								<span class="rs-dim">${Utils.escapeHtml(n.node.sourceFile || "")}</span>
							</div>`,
						)
						.join("")}
				</div>`;
		},

		_bindGraphHits() {
			for (const el of document.querySelectorAll(".rs-graph-hit")) {
				el.addEventListener("click", () => {
					const id = el.dataset.node;
					const sel = State.researchView.graphSelected;
					// Toggle: clicking the open node closes it.
					if (sel && sel.id === id) {
						State.update("researchView", {
							...State.researchView,
							graphSelected: null,
							graphNeighbors: null,
						});
						return;
					}
					const node = (State.researchView.graphResults?.hits || [])
						.map((h) => h.node)
						.find((n) => n && n.id === id);
					State.update("researchView", {
						...State.researchView,
						graphSelected: node || null,
						graphNeighbors: null,
						neighborsLoading: true,
					});
					API.graphNeighbors({ id, depth: 1, limit: 40 });
				});
			}
		},
	};
})();
