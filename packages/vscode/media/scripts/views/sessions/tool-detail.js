/**
 * An expanded tool call: input, output, error, files, copy.
 *
 * Moved verbatim out of the 1539-line views/sessions.js. Composed onto
 * SessionsView with Object.assign, so `this` resolves exactly as before.
 */

const ToolDetailMixin = {

	/**
	 * Stash text for a copy button and return the key to reference it by
	 * @param {string} text
	 * @returns {string} key for data-copy-key
	 */
	registerCopyPayload(text) {
		const key = `c${++this._copyKeySeq}`;
		this._copyPayloads.set(key, text);
		return key;
	},


	/**
	 * Render expanded tool details
	 * @param {Object} tool
	 * @returns {string}
	 */
	renderToolDetails(tool) {
		const inputStr = this.safeStringify(tool.input, 5000);
		const outputStr = this.safeStringify(tool.result, 2000);
		const affectedFiles = this.safeArray(tool.affectedFiles);
		const inputCopyKey = inputStr ? this.registerCopyPayload(inputStr) : "";
		const outputCopyKey = outputStr ? this.registerCopyPayload(outputStr) : "";

		return `
      <div class="sv-tool-details">
        ${
					inputStr
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Input</span>
              <button class="sv-copy-btn" data-copy-key="${inputCopyKey}">Copy</button>
            </div>
            <div class="sv-code-block" style="max-height: 300px; overflow: auto;">
              <pre>${Utils.highlightCode(inputStr, "json")}</pre>
            </div>
          </div>
        `
						: ""
				}
        ${
					outputStr
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Output</span>
              <button class="sv-copy-btn" data-copy-key="${outputCopyKey}">Copy</button>
            </div>
            <div class="sv-code-block" style="max-height: 300px; overflow: auto;">
              <pre>${Utils.highlightCode(outputStr, Utils.detectLanguage(tool.affectedFiles?.[0] || "", outputStr))}</pre>
            </div>
          </div>
        `
						: ""
				}
        ${
					tool.error
						? `
          <div class="sv-tool-section error">
            <div class="sv-tool-section-header">
              <span>Error</span>
            </div>
            <div class="sv-error-content">${Utils.escapeHtml(tool.error)}</div>
          </div>
        `
						: ""
				}
        ${
					affectedFiles.length > 0
						? `
          <div class="sv-tool-section">
            <div class="sv-tool-section-header">
              <span>Affected Files</span>
            </div>
            <div class="sv-affected-files">
              ${affectedFiles
								.map(
									(f) => `
                <span class="sv-file-chip">${Utils.escapeHtml(Utils.getFileName(f))}</span>
              `,
								)
								.join("")}
            </div>
          </div>
        `
						: ""
				}
      </div>
    `;
	},


	/**
	 * Setup activity item handlers
	 * @param {HTMLElement} container
	 */
	setupActivityHandlers() {
		const contentEl = document.getElementById("sv-detail-content");
		if (!contentEl || contentEl.dataset.svDelegated === "1") return;
		contentEl.dataset.svDelegated = "1";

		// One delegated listener for the whole detail pane. Previously handlers
		// were attached per item on every render, so a feed of several hundred
		// items re-bound several hundred listeners on each 2s tick and on every
		// expand click - and any node replaced in place silently lost its own.
		contentEl.addEventListener("click", (e) => {
			const copyBtn = e.target.closest(".sv-copy-btn");
			if (copyBtn) {
				e.stopPropagation();
				this.handleCopyClick(copyBtn);
				return;
			}

			const expandBtn = e.target.closest(".sv-expand-btn");
			if (expandBtn) {
				e.stopPropagation();
				this.toggleExpand(expandBtn.dataset.itemId);
				return;
			}

			const toolHeader = e.target.closest(".sv-tool-item-header");
			if (toolHeader) {
				this.toggleExpand(toolHeader.dataset.itemId);
				return;
			}

			const turnHeader = e.target.closest(".sv-turn-header");
			if (turnHeader) {
				this.toggleTurn(turnHeader.dataset.turnKey);
			}
		});
	},


	/**
	 * Copy a stashed payload to the clipboard
	 * @param {HTMLElement} btn
	 */
	handleCopyClick(btn) {
		const text = this._copyPayloads.get(btn.dataset.copyKey);
		if (text === undefined) return;
		navigator.clipboard.writeText(text).then(() => {
			btn.textContent = "Copied!";
			setTimeout(() => (btn.textContent = "Copy"), 1500);
		});
	},


	/**
	 * Toggle item expansion
	 * @param {string} itemId
	 */
	toggleExpand(itemId) {
		if (!itemId) return;

		if (this._expandedItems.has(itemId)) {
			this._expandedItems.delete(itemId);
		} else {
			this._expandedItems.add(itemId);
		}

		// Re-render only the item that changed. This used to call
		// renderTabContent(), rebuilding every item's HTML and re-binding every
		// handler for one click - on a session with hundreds of executions that
		// is the whole feed per toggle.
		if (!this.renderSingleItem(itemId)) {
			this.renderTabContent();
		}
	},


	/**
	 * Replace one rendered item in place.
	 * @param {string} itemId
	 * @returns {boolean} false if the item could not be resolved (caller should
	 *   fall back to a full render)
	 */
	renderSingleItem(itemId) {
		const contentEl = document.getElementById("sv-detail-content");
		if (!contentEl) return false;

		const el = contentEl.querySelector(
			`[data-item-id="${CSS.escape(itemId)}"]`,
		);
		if (!el) return false;

		const session = this.getSelectedSession();
		if (!session) return false;

		const { activeTab } = State.sessionView;

		if (activeTab === "tools") {
			const idx = Number.parseInt(itemId.replace("tools-tab-", ""), 10);
			const tool = (session.toolExecutions || [])[idx];
			if (!tool) return false;
			el.outerHTML = this.renderToolItem(tool, idx);
			return true;
		}

		if (activeTab === "activity") {
			const activities = this.buildActivityFeed(session);
			const idx = activities.findIndex((a) => a.id === itemId);
			if (idx === -1) return false;
			el.outerHTML = this.renderActivityItem(activities[idx], idx);
			return true;
		}

		return false;
	},
};

window.ToolDetailMixin = ToolDetailMixin;
