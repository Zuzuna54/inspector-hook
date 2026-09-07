/**
 * "What would load" — the composed picture of what a session actually starts with.
 *
 * The three facts already existed and lived in three different places: the index
 * in the Context view, the file sizes in its file list, and the staged bytes in
 * the Tray. You could assemble the picture yourself; nothing assembled it for
 * you. This is the assembly.
 *
 * ## Two distinctions this pane exists to keep straight
 *
 * Getting either wrong would produce a confident total that is simply untrue,
 * which is worse than the three scattered numbers it replaces.
 *
 * 1. **MEMORY.md loads every session. The files it names do NOT.** They are
 *    loaded on demand, when Claude decides to open one. Adding them into a
 *    single "what loads" figure would overstate every session's starting
 *    context by the size of the whole corpus. They are reported separately, as
 *    reachable rather than loaded.
 *
 * 2. **The 200-line / 25 KB budget is REPORTING ONLY.** Nothing truncates the
 *    user's file — `native-memory.ts` is explicit that it never does. Past the
 *    budget Claude stops reading the tail, so the number describes where
 *    attention ends, not a limit the tool enforces. Rendering it as an error
 *    would be a warning about something that has not happened.
 */

const TrayPreviewMixin = {
	/**
	 * The whole pane.
	 *
	 * @param {Object|null} project the selected MemoryProject
	 * @param {Object|null} preview the tray's rendered preview
	 * @param {Object|null} staged what is already staged for the next session
	 */
	renderWhatWouldLoad(project, preview, staged) {
		if (!project) {
			return `
        <div class="empty-state">
          <div class="empty-state-title">Pick a project first</div>
          <div class="empty-state-description">
            What loads is per project. Choose one in Context and it appears here.
          </div>
        </div>
      `;
		}

		const files = project.files || [];
		// Only files the index NAMES are reachable by name. `indexState` already
		// carries this, and it distinguishes "the index does not mention it" from
		// "there is no index", which need different answers.
		const reachable = files.filter((f) => f.indexState === "referenced");
		const unreachable = files.filter((f) => f.indexState !== "referenced");
		const reachableBytes = reachable.reduce((n, f) => n + (f.size || 0), 0);

		return `
      <div class="tray-load">
        ${this.renderAlwaysLoaded(project, staged, preview)}
        ${this.renderOnDemand(reachable, reachableBytes)}
        ${this.renderNeverLoaded(unreachable, project)}
      </div>
    `;
	},

	/**
	 * What arrives without anyone asking.
	 *
	 * The index, plus anything staged. This is the only figure here that is a
	 * genuine "every session starts with this", so it is the only one presented
	 * as a total.
	 */
	renderAlwaysLoaded(project, staged, preview) {
		const indexBytes = project.hasIndex ? project.indexBytes || 0 : 0;
		// Past the budget Claude stops reading the tail, so only the part within
		// it actually reaches a session.
		const indexLoaded = Math.min(indexBytes, INDEX_LOAD_BYTES);
		const stagedBytes = staged?.text ? this.byteLength(staged.text) : 0;
		const trayBytes = preview?.bytes || 0;
		const total = indexLoaded + stagedBytes;

		return `
      <div class="tray-load-group always">
        <div class="tray-load-head">
          <strong>Every session starts with</strong>
          <span class="tray-load-total">${this.formatBytes(total)}</span>
        </div>
        <ul class="tray-load-list">
          ${
						project.hasIndex
							? `<li>
                  <span class="tray-load-name">MEMORY.md</span>
                  <span class="tray-load-meta">
                    ${project.indexLines || 0} lines · ${this.formatBytes(indexBytes)}
                    ${this.renderBudgetNote(project)}
                  </span>
                </li>`
							: `<li class="tray-load-none">
                  No <code>MEMORY.md</code>, so nothing in this project is loaded by name.
                </li>`
					}
          ${
						stagedBytes
							? `<li>
                  <span class="tray-load-name">Staged context</span>
                  <span class="tray-load-meta">${this.formatBytes(stagedBytes)} · used once, then gone</span>
                </li>`
							: `<li class="tray-load-none">Nothing staged for the next session.</li>`
					}
        </ul>
        ${
					trayBytes && !stagedBytes
						? `<div class="ctx-hint tray-load-hint">
                The tray holds ${this.formatBytes(trayBytes)} that is <strong>not</strong>
                staged yet — it will not load until you send it.
              </div>`
						: ""
				}
      </div>
    `;
	},

	/**
	 * The budget note.
	 *
	 * Stated as where reading stops, never as an error. Nothing truncates the
	 * file, and on this corpus the largest index is 16 lines against a limit of
	 * 200 — so a red warning would be alarming about a problem nobody has.
	 */
	renderBudgetNote(project) {
		const overLines = (project.indexLines || 0) > INDEX_LOAD_LINES;
		const overBytes = (project.indexBytes || 0) > INDEX_LOAD_BYTES;
		if (!overLines && !overBytes) return "";
		return `<span class="tray-load-budget">
      past ${INDEX_LOAD_LINES} lines / ${this.formatBytes(INDEX_LOAD_BYTES)}, so the tail is not read
    </span>`;
	},

	/**
	 * What Claude can reach, but only if it decides to.
	 *
	 * Kept out of the total on purpose. These load when a file is opened, so
	 * counting them as "what loads" would overstate every session by the size of
	 * the whole corpus.
	 */
	renderOnDemand(reachable, bytes) {
		return `
      <div class="tray-load-group ondemand">
        <div class="tray-load-head">
          <strong>Available on demand</strong>
          <span class="tray-load-total">${reachable.length} file${reachable.length === 1 ? "" : "s"} · ${this.formatBytes(bytes)}</span>
        </div>
        <p class="ctx-hint">
          Named by the index, so Claude can open them. They are
          <strong>not</strong> loaded automatically, which is why they are not in
          the total above.
        </p>
        ${
					reachable.length
						? `<ul class="tray-load-list">${reachable
								.slice(0, 12)
								.map(
									(f) => `<li>
                    <span class="tray-load-name">${Utils.escapeHtml(f.name || f.fileName)}</span>
                    <span class="tray-load-meta">${this.formatBytes(f.size || 0)}</span>
                  </li>`,
								)
								.join("")}${
									reachable.length > 12
										? `<li class="tray-load-none">…and ${reachable.length - 12} more</li>`
										: ""
								}</ul>`
						: `<div class="tray-load-none">Nothing is named by the index.</div>`
				}
      </div>
    `;
	},

	/**
	 * What exists and will never be read.
	 *
	 * The one thing invisible everywhere else, and the reason the Context view
	 * was built. A file the index does not name costs disk and does nothing.
	 */
	renderNeverLoaded(unreachable, project) {
		if (!unreachable.length) return "";
		const noIndex = !project.hasIndex;
		return `
      <div class="tray-load-group never">
        <div class="tray-load-head">
          <strong>Never loaded</strong>
          <span class="tray-load-total">${unreachable.length} file${unreachable.length === 1 ? "" : "s"}</span>
        </div>
        <p class="ctx-hint">
          ${
						noIndex
							? `This project has no <code>MEMORY.md</code>, so nothing in it is reachable by name — not just these.`
							: `Nothing in the index references these, so no session will ever open them.`
					}
        </p>
      </div>
    `;
	},

	/** UTF-8 byte length, matching how the core measures. */
	byteLength(text) {
		return new TextEncoder().encode(String(text ?? "")).length;
	},
};

window.TrayPreviewMixin = TrayPreviewMixin;
