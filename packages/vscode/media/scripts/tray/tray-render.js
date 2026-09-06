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
	renderTray(tray, preview, refusal, editingId, draft, targets, targetSessionId, armed) {
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
      ${items.length ? this.renderTrayActions(preview, targets, targetSessionId, armed) : ""}
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

	/**
	 * Where this tray goes, and when.
	 *
	 * Three tiers, and they differ in WHEN the text arrives, so they are laid
	 * out as a choice rather than hidden behind one button. The wording is
	 * deliberate: "next session" and "next prompt" are the difference between
	 * waiting for a restart and not, and it is the thing a reasonable person
	 * would otherwise have to discover by being surprised.
	 */
	renderTrayActions(preview, targets, targetSessionId, armed) {
		const empty = !preview || !preview.bytes;
		const needsTarget = !targetSessionId;
		return `
      <div class="tray-actions">
        ${this.renderArmed(armed, preview)}
        <div class="tray-tier">
          <div class="tray-tier-row">
            <button class="btn btn-sm btn-success tray-stage" ${empty ? "disabled" : ""}>
              Next session
            </button>
            <span class="ctx-hint">Lands when a new session starts. Used once.</span>
          </div>
          <div class="tray-tier-row">
            <button class="btn btn-sm tray-arm-now" ${empty || needsTarget ? "disabled" : ""}>
              Next prompt
            </button>
            <span class="ctx-hint">
              Reaches a session that is already running, on its next message. Used once.
            </span>
          </div>
          <div class="tray-tier-row">
            <button class="btn btn-sm tray-arm-pinned" ${empty || needsTarget ? "disabled" : ""}>
              Pin
            </button>
            <span class="ctx-hint">
              Repeats on <strong>every</strong> prompt until unpinned. Expires in 24 hours.
            </span>
          </div>
        </div>
        ${this.renderTargets(targets, targetSessionId)}
        <button class="btn btn-sm btn-danger tray-clear">Clear the tray</button>
      </div>
    `;
	},

	/**
	 * Which session receives it.
	 *
	 * Ages are shown raw rather than as a live/dead badge: there is no
	 * heartbeat, a session's status decays on a timer, and a confident "live"
	 * label would be an assertion nothing can support. "4m ago" lets the reader
	 * judge, which is what they asked for.
	 */
	renderTargets(targets, targetSessionId) {
		const list = targets || [];
		if (!list.length) {
			return `<div class="ctx-hint tray-targets-empty">
        No sessions retained, so there is nothing running to send to.
      </div>`;
		}
		return `
      <div class="tray-targets">
        <label class="ctx-hint" for="tray-target">Send to</label>
        <select id="tray-target" class="tray-target-select">
          <option value="">Choose a session…</option>
          ${list
						.map(
							(t) => `<option value="${Utils.escapeHtml(t.sessionId)}" ${
								t.sessionId === targetSessionId ? "selected" : ""
							}>${Utils.escapeHtml(t.projectName || t.name || t.sessionId.slice(0, 8))} — ${this.formatAge(t.ageMs)}${
								t.armed && (t.armed.now || t.armed.pinned) ? " · armed" : ""
							}</option>`,
						)
						.join("")}
        </select>
      </div>
    `;
	},

	/**
	 * What is already armed for this session.
	 *
	 * A pin repeats on every prompt, so its cost is stated as what it HAS cost,
	 * not as the payload size — a number that only showed the size would
	 * describe a recurring charge as a one-off.
	 */
	renderArmed(armed, _preview) {
		if (!armed) return "";
		const rows = [];
		if (armed.now) {
			rows.push(`<div class="tray-armed-row">
        <span class="tray-armed-tier">next prompt</span>
        <span>${this.formatBytes(armed.now.bytes || 0)}, used once</span>
        <button class="btn btn-xs btn-danger tray-disarm" data-tier="now">Cancel</button>
      </div>`);
		}
		if (armed.pinned) {
			const repeat = armed.pinned.estimatedRepeatBytes || armed.pinned.bytes || 0;
			rows.push(`<div class="tray-armed-row pinned">
        <span class="tray-armed-tier">pinned</span>
        <span>${this.formatBytes(armed.pinned.bytes || 0)} × ${armed.pinned.deliveries ?? 0} prompts
          = <strong>${this.formatBytes(repeat)}</strong> so far</span>
        <span class="ctx-hint">expires ${Utils.formatDate(armed.pinned.expiresAt)}</span>
        <button class="btn btn-xs btn-danger tray-disarm" data-tier="pinned">Unpin</button>
      </div>`);
		}
		return rows.length ? `<div class="tray-armed">${rows.join("")}</div>` : "";
	},

	/** @param {number|null} ms */
	formatAge(ms) {
		if (ms === null || ms === undefined) return "unknown";
		const mins = Math.floor(ms / 60000);
		if (mins < 1) return "just now";
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
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
