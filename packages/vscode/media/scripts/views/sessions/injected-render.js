/**
 * What was injected INTO this session (P10).
 *
 * The other direction from everything else in the Context surfaces. The tray
 * composes context and sends it somewhere; this reads the log the HOOKS write
 * at delivery, and answers what a given session actually received.
 *
 * ## It is not `sourceSessionId`
 *
 * That field records the session the text came FROM — the one whose digest was
 * staged, which is usually a different session, because that is the point of
 * staging. Rendering it here would answer the question backwards, confidently.
 *
 * ## Pinned is the reason the log exists
 *
 * Arming happens once. A pinned payload is delivered on every prompt, and this
 * is the only surface that can show that it was paid for eleven times.
 */

const InjectedRenderMixin = {
	TIER_LABELS: {
		"next-session": "At session start",
		now: "Next prompt",
		pinned: "Pinned",
	},

	TIER_NOTES: {
		"next-session": "one-shot, consumed at startup",
		now: "one-shot, consumed by the next prompt",
		pinned: "repeats on every prompt until unpinned",
	},

	renderInjectedTab(contentEl, session) {
		const view = State.injectionsView || {};
		// A reply for a different session is stale, not empty. Rendering it
		// would attribute one session's deliveries to another.
		const mine = view.sessionId === session.id ? view.records || [] : [];

		if (view.loading && view.sessionId === session.id) {
			contentEl.innerHTML = `<div class="sv-loading">Reading the delivery log…</div>`;
			return;
		}

		if (!mine.length) {
			contentEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Nothing was injected into this session</div>
          <div class="empty-state-description">
            Context sent from the Tray is recorded here by the hook that
            delivered it — not by what was armed, so this is what the session
            actually received.
          </div>
        </div>
      `;
			return;
		}

		const total = mine.reduce((n, r) => n + (r.bytes || 0), 0);
		const pinned = mine.filter((r) => r.tier === "pinned").length;

		contentEl.innerHTML = `
      <div class="sv-injected">
        <div class="sv-injected-summary">
          <strong>${mine.length} deliver${mine.length === 1 ? "y" : "ies"}</strong>
          <span class="sv-injected-bytes">${this.formatInjectedBytes(total)} in total</span>
          ${
						pinned > 1
							? `<span class="sv-injected-repeat">${pinned} of them from one pinned payload</span>`
							: ""
					}
        </div>
        ${
					view.unparseable
						? `<div class="sv-injected-warn">${view.unparseable} line${
								view.unparseable === 1 ? "" : "s"
							} in the log could not be read. The rest are shown.</div>`
						: ""
				}
        <ul class="sv-injected-list">
          ${mine.map((r) => this.renderInjectedRow(r)).join("")}
        </ul>
      </div>
    `;
	},

	renderInjectedRow(record) {
		const label = this.TIER_LABELS[record.tier] || record.tier;
		const note = this.TIER_NOTES[record.tier] || "";
		return `
      <li class="sv-injected-row ${record.tier}">
        <span class="sv-injected-tier">${Utils.escapeHtml(label)}</span>
        <span class="sv-injected-when">${Utils.formatDate(record.at)}</span>
        <span class="sv-injected-size">${this.formatInjectedBytes(record.bytes || 0)}</span>
        ${
					record.label
						? `<span class="sv-injected-label">${Utils.escapeHtml(record.label)}</span>`
						: ""
				}
        <span class="sv-injected-note">${Utils.escapeHtml(note)}</span>
      </li>
    `;
	},

	/**
	 * A marker for a session row.
	 *
	 * Returns "" when the session received nothing, so the list stays quiet for
	 * the common case rather than printing a zero against every row.
	 */
	injectedMarker(sessionId) {
		const counts = (State.injectionsView || {}).counts || {};
		const held = counts[sessionId];
		if (!held || !held.count) return "";
		return `<span class="sv-session-injected" title="${held.count} injection${
			held.count === 1 ? "" : "s"
		}, ${this.formatInjectedBytes(held.bytes)} delivered">⇢ ${held.count}</span>`;
	},

	/**
	 * Does this session already have a memory file?
	 *
	 * Derived from the memory corpus the Context view loads, matched on the
	 * digest naming convention `session-<YYYY-MM-DD>-<first 8 of id>` that
	 * `session-digest.ts` builds.
	 *
	 * Returns "" — NOT a "no memory" badge — when the corpus has not been
	 * loaded yet. "I cannot tell" and "there is none" are different claims, and
	 * only one of them is safe to render before the Context view has ever been
	 * opened.
	 */
	memoryMarker(session) {
		const projects = (State.contextView || {}).projects;
		if (!projects || !projects.length) return "";
		const started = session.startTime ? new Date(session.startTime) : null;
		if (!started || Number.isNaN(started.getTime())) return "";
		const name = `session-${started.toISOString().slice(0, 10)}-${String(session.id).slice(0, 8)}`;
		for (const project of projects) {
			for (const file of project.files || []) {
				if (file.name === name) {
					return `<span class="sv-session-memory" title="A memory file exists for this session: ${Utils.escapeHtml(file.fileName)}">✎ memory</span>`;
				}
			}
		}
		return "";
	},

	formatInjectedBytes(bytes) {
		if (!bytes) return "0 B";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	},
};

window.InjectedRenderMixin = InjectedRenderMixin;
