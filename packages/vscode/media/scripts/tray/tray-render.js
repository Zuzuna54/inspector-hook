/**
 * Context tray: pure renderers.
 *
 * Data in, HTML out. The byte figures shown here all come from the CORE's
 * preview — nothing is recomputed client-side, because two places deciding
 * "what would be injected" is how a preview starts disagreeing with the
 * delivery, and that guarantee is the reason the tray exists in this shape.
 */

const TrayRenderMixin = {
	/**
	 * The whole tray.
	 * @param {Object|null} tray
	 * @param {Object|null} preview
	 * @param {string|null} refusal
	 * @param {string|null} editingId
	 * @param {string} draft
	 * @returns {string}
	 */
	renderTray(tray, preview, refusal, editingId, draft) {
		const items = (tray && tray.items) || [];
		return `
      ${refusal ? `<div class="ctx-notice ctx-notice-refused">${Utils.escapeHtml(refusal)}</div>` : ""}
      ${this.renderTrayBudget(preview, items.length)}
      ${
				items.length === 0
					? `<div class="empty-state">
              <div class="empty-state-title">Nothing staged</div>
              <div class="empty-state-description">
                Add a session digest, a memory file, or your own notes. They
                compose in order and go to the next session that starts.
              </div>
            </div>`
					: `<div class="tray-items">${items
							.map((item, i) =>
								this.renderTrayItem(item, i, items.length, preview, editingId, draft),
							)
							.join("")}</div>`
			}
      ${items.length ? this.renderTrayActions(preview) : ""}
    `;
	},

	/**
	 * The running cost.
	 *
	 * Shown always, not only when it is a problem: the reason to see a byte
	 * total is to notice it growing, and a number that appears only past a
	 * threshold cannot do that.
	 */
	renderTrayBudget(preview, itemCount) {
		if (!preview) return "";
		const over = preview.warnThresholdExceeded;
		const included = (preview.items || []).filter((i) => i.included).length;
		return `
      <div class="tray-budget ${over ? "over" : ""}">
        <span class="tray-budget-size">${this.formatBytes(preview.bytes || 0)}</span>
        <span class="tray-budget-count">${included} of ${itemCount} item${itemCount === 1 ? "" : "s"}</span>
        ${
					over
						? `<span class="tray-budget-warn">large — this is most of a context window</span>`
						: ""
				}
        ${
					preview.truncated
						? `<span class="tray-budget-warn">truncated at the cap</span>`
						: ""
				}
        ${this.renderRedactionNote(preview.redactions)}
      </div>
    `;
	},

	/**
	 * What was removed on the way out.
	 *
	 * Named by pattern, because "3 secrets removed" is only actionable if you
	 * can tell whether one of them was a false positive in your own text.
	 */
	renderRedactionNote(redactions) {
		if (!redactions || !redactions.total) return "";
		const kinds = (redactions.byName || [])
			.map((r) => `${Utils.escapeHtml(r.name)}${r.count > 1 ? ` ×${r.count}` : ""}`)
			.join(", ");
		return `<span class="tray-redacted" title="Removed before injection">
      ${redactions.total} redacted${kinds ? `: ${kinds}` : ""}
    </span>`;
	},

	/** One item. */
	renderTrayItem(item, index, total, preview, editingId, draft) {
		const measured = ((preview && preview.items) || []).find(
			(i) => i.itemId === item.id,
		);
		const edited = item.editedText !== undefined;
		const editing = editingId === item.id;

		return `
      <div class="tray-item ${item.include ? "" : "excluded"} ${editing ? "editing" : ""}" data-item-id="${Utils.escapeHtml(item.id)}">
        <div class="tray-item-head">
          <input type="checkbox" class="tray-include" ${item.include ? "checked" : ""}
                 aria-label="Include ${Utils.escapeHtml(item.title)}">
          <span class="tray-item-title">${Utils.escapeHtml(item.title)}</span>
          <span class="tray-item-kind">${Utils.escapeHtml(this.kindLabel(item.kind))}</span>
          ${edited ? '<span class="tray-item-edited" title="Edited; the original is kept">edited</span>' : ""}
          <span class="tray-item-bytes">${this.formatBytes(measured ? measured.bytes : item.bytes || 0)}</span>
          ${measured && measured.truncated ? '<span class="tray-budget-warn">cut</span>' : ""}
        </div>
        <div class="tray-item-actions">
          <button class="btn btn-xs tray-up" ${index === 0 ? "disabled" : ""}>Up</button>
          <button class="btn btn-xs tray-down" ${index === total - 1 ? "disabled" : ""}>Down</button>
          <button class="btn btn-xs tray-edit">${editing ? "Close" : "Edit"}</button>
          ${edited ? '<button class="btn btn-xs tray-reset" title="Restore the original text">Revert</button>' : ""}
          <button class="btn btn-xs btn-danger tray-remove">Remove</button>
        </div>
        ${editing ? this.renderTrayEditor(item, draft) : ""}
      </div>
    `;
	},

	/**
	 * The editor for one item.
	 *
	 * The original is stated, not just kept, so "Revert" is visibly a promise
	 * rather than a hope.
	 */
	renderTrayEditor(item, draft) {
		const value = draft !== undefined && draft !== null ? draft : (item.editedText ?? item.originalText);
		return `
      <div class="tray-editor">
        <textarea class="tray-editor-body" rows="10"
                  aria-label="Edit ${Utils.escapeHtml(item.title)}">${Utils.escapeHtml(value)}</textarea>
        <div class="tray-editor-foot">
          <span class="ctx-hint">The original is kept; Revert restores it.</span>
          <button class="btn btn-xs btn-success tray-save">Save</button>
        </div>
      </div>
    `;
	},

	/** Stage and clear. */
	renderTrayActions(preview) {
		const empty = !preview || !preview.bytes;
		return `
      <div class="tray-actions">
        <p class="ctx-hint">
          Staging replaces whatever is currently staged, and it lands on the
          <strong>next session that starts</strong> — not this one.
        </p>
        <button class="btn btn-sm btn-success tray-stage" ${empty ? "disabled" : ""}>
          Stage for the next session
        </button>
        <button class="btn btn-sm btn-danger tray-clear">Clear the tray</button>
      </div>
    `;
	},

	/** @param {string} kind */
	kindLabel(kind) {
		return (
			{
				session_digest: "session",
				memory_file: "memory",
				free_text: "note",
				file_change: "diff",
			}[kind] || kind
		);
	},

	/** @param {number} bytes */
	formatBytes(bytes) {
		if (!bytes) return "0 B";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	},
};

window.TrayRenderMixin = TrayRenderMixin;
