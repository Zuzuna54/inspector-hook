/**
 * Rendering for the four-corpus search.
 *
 * ## One list per corpus, and never one list
 *
 * The core returns groups because their scores are not comparable — four
 * indexes, four different average document lengths, four different IDFs for
 * the same term. This renderer therefore has no "all results" mode and no
 * sort-by-score across groups. That is not an omission to be filled in later:
 * a merged order would look authoritative and be arbitrary.
 *
 * ## Every count carries its denominator
 *
 * "3 hits" means something different out of 34 memory files than out of 8,000
 * prompts, so a group header always reads `3 of 56 · searched 240`. The core
 * reports `searched` per group precisely so this number is not ambiguous here.
 */

const FindRenderMixin = {
	/** Labels, kept beside the corpus names the core sends. */
	CORPUS_LABELS: {
		memory: "Memory files",
		digest: "Session digests",
		filechange: "File changes",
		prompt: "Prompts and replies",
		logs: "Events",
	},

	/** What each corpus is, in one line, so the grouping explains itself. */
	CORPUS_NOTES: {
		memory: "Curated notes Claude loads by name.",
		digest: "What each session did, as facts.",
		filechange: "Paths and the lines that changed — never file contents.",
		prompt: "What you asked and what came back. Searched by the research index.",
		logs: "Every captured hook event — the tool, the arguments, the outcome.",
	},

	renderGroups(state) {
		const groups = state.groups || [];
		if (!state.query) {
			return `
        <div class="empty-state">
          <div class="empty-state-title">Search your own history</div>
          <div class="empty-state-description">
            Four corpora, searched separately and reported separately:
            memory files, session digests, file changes, and your prompts.
          </div>
        </div>
      `;
		}
		if (state.searching) {
			return `<div class="fd-searching">Searching…</div>`;
		}
		if (!groups.length) {
			return `<div class="fd-searching">No corpora answered.</div>`;
		}
		return groups.map((group) => this.renderGroup(group, state)).join("");
	},

	renderGroup(group, state) {
		const collapsed = (state.collapsed || []).includes(group.corpus);
		const label = this.CORPUS_LABELS[group.corpus] || group.corpus;
		const note = this.CORPUS_NOTES[group.corpus] || "";

		return `
      <section class="fd-group ${collapsed ? "collapsed" : ""}" data-corpus="${group.corpus}">
        <header class="fd-group-head">
          <button class="fd-group-toggle" data-corpus="${group.corpus}"
                  aria-expanded="${collapsed ? "false" : "true"}">
            <span class="fd-group-name">${Utils.escapeHtml(label)}</span>
            ${this.renderCount(group)}
          </button>
        </header>
        <p class="ctx-hint fd-group-note">${Utils.escapeHtml(note)}</p>
        ${collapsed ? "" : this.renderGroupBody(group)}
      </section>
    `;
	},

	/**
	 * The count, with its denominator.
	 *
	 * `total` is how many matched, `hits.length` how many were returned, and
	 * `searched` how many documents were in scope. All three, because any one
	 * alone is ambiguous.
	 */
	renderCount(group) {
		const shown = (group.hits || []).length;
		const total = group.total || 0;
		const searched = group.searched || 0;
		if (group.unavailable) {
			return `<span class="fd-count fd-count-off">unavailable</span>`;
		}
		const of = total > shown ? `${shown} of ${total}` : String(total);
		// `unattributed` only appears on a project-scoped search. Shown because
		// those documents carry no project identity at all, so they were
		// INCLUDED rather than judged — excluding them would hide real
		// material, and including them silently would claim they belong to this
		// project. Neither is true, so the count says which.
		const unknown = group.unattributed
			? `<span class="fd-unattributed"> · ${group.unattributed} unattributed</span>`
			: "";
		return `<span class="fd-count">${of}<span class="fd-searched"> · searched ${searched}</span>${unknown}</span>`;
	},

	renderGroupBody(group) {
		if (group.unavailable) {
			// A reason, not an empty list. "Nothing matched" and "this corpus
			// could not be searched" are different statements and the second one
			// must never render as the first.
			return `<div class="fd-unavailable">${Utils.escapeHtml(group.unavailable)}</div>`;
		}
		const hits = group.hits || [];
		if (!hits.length) {
			return `<div class="fd-none">Nothing in this corpus matched.</div>`;
		}
		return `<ul class="fd-hits">${hits.map((hit) => this.renderHit(hit)).join("")}</ul>`;
	},

	renderHit(hit) {
		// `prompt` hits are stored as snippets by the research index, so the
		// full turn cannot be recovered. Saying so on the button is the honest
		// alternative to adding 600 characters labelled as the whole thing.
		const excerptOnly = hit.corpus === "prompt";
		return `
      <li class="fd-hit" data-hit-id="${Utils.escapeHtml(hit.id)}">
        <div class="fd-hit-head">
          <span class="fd-hit-title">${Utils.escapeHtml(hit.title || "Untitled")}</span>
          <span class="fd-hit-score" title="BM25 score — comparable inside this group only">
            ${Number(hit.score || 0).toFixed(2)}
          </span>
        </div>
        <div class="fd-hit-snippet">${Utils.escapeHtml(hit.snippet || "")}</div>
        <div class="fd-hit-foot">
          ${this.renderHitMeta(hit)}
          <button class="btn btn-xs btn-success fd-add" data-hit-id="${Utils.escapeHtml(hit.id)}"
                  ${excerptOnly ? "disabled" : ""}
                  title="${excerptOnly ? "The research index stores only a snippet of a turn, so the full text cannot be added." : "Adds the full source, not this snippet."}">
            Add to tray
          </button>
        </div>
      </li>
    `;
	},

	renderHitMeta(hit) {
		const bits = [];
		if (hit.projectName) bits.push(Utils.escapeHtml(hit.projectName));
		if (hit.timestamp) bits.push(Utils.formatDate(hit.timestamp));
		if (hit.matched?.length) {
			bits.push(`matched ${hit.matched.map((m) => Utils.escapeHtml(m)).join(", ")}`);
		}
		return `<span class="fd-hit-meta">${bits.join(" · ")}</span>`;
	},

	/**
	 * Corpus sizes, and what the store costs.
	 *
	 * A delegated corpus omits vocabulary, cap and eviction count rather than
	 * reporting zero for them — the core cannot read those from the index that
	 * owns it, and `0` would read as "no terms, no limit".
	 */
	renderStats(stats) {
		if (!stats?.corpora?.length) return "";
		const rows = stats.corpora
			.map((c) => {
				const label = this.CORPUS_LABELS[c.corpus] || c.corpus;
				const parts = [`${c.documents} indexed`];
				if (c.delegatedTo) {
					parts.push(`held by the ${Utils.escapeHtml(c.delegatedTo)} index`);
				} else {
					if (c.cap) parts.push(`cap ${c.cap}`);
					if (c.evicted) parts.push(`${c.evicted} evicted`);
				}
				return `<li><span class="fd-stat-name">${Utils.escapeHtml(label)}</span>
                <span class="fd-stat-meta">${parts.join(" · ")}</span></li>`;
			})
			.join("");

		const store = stats.store
			? `<div class="ctx-hint fd-store">
           Store: ${this.formatBytes(stats.store.totalSize)} across
           ${stats.store.sessionCount} sessions, ${stats.store.logCount} logs,
           ${stats.store.versionCount} versions.
           Retention is off, so this only grows.
         </div>`
			: "";

		return `<ul class="fd-stats">${rows}</ul>${store}`;
	},

	/**
	 * Bytes, up to GB.
	 *
	 * `Utils` has no byte formatter and the tray's stops at MB, which was fine
	 * for a 256 KB injection budget. This reports the whole store, which is
	 * already 110 MB here and has no retention deleting from it, so GB is a
	 * size this number will reach rather than a hypothetical.
	 */
	formatBytes(bytes) {
		if (!bytes) return "0 B";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	},
};

window.FindRenderMixin = FindRenderMixin;
