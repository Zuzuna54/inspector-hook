/**
 * Saved bundles: a tray worth keeping.
 *
 * "Build the auth context once, inject it into any session later." The tray is
 * a scratch surface that gets cleared; a bundle is the same composition kept.
 *
 * Sizes are shown per bundle because a saved composition whose cost is
 * invisible until you load it is the same problem the tray's running total
 * exists to solve. They come from the stored items, not from a rendered string
 * — bundles store items so they can be re-rendered through current redaction
 * rules, which is also why a size here is an estimate rather than the exact
 * injected byte count, and it says so.
 */

const TrayBundlesMixin = {
	/**
	 * The bundles pane.
	 * @param {Array} bundles
	 * @param {Object|null} tray the current tray, for the save affordance
	 */
	renderBundles(bundles, tray) {
		const list = bundles || [];
		const canSave = Boolean(tray?.items?.length);

		return `
      <div class="tray-bundles">
        <div class="tray-bundle-save">
          <input type="text" id="tray-bundle-name" class="tray-bundle-input"
                 placeholder="Name this composition…" maxlength="80"
                 aria-label="Bundle name">
          <button class="btn btn-xs btn-success tray-bundle-create" ${canSave ? "" : "disabled"}>
            Save tray
          </button>
        </div>
        ${
					canSave
						? ""
						: `<div class="ctx-hint tray-bundle-hint">
                Compose something first — there is nothing in the tray to save.
              </div>`
				}
        ${
					list.length
						? `<div class="tray-bundle-list">${list.map((b) => this.renderBundle(b)).join("")}</div>`
						: `<div class="empty-state">
                <div class="empty-state-title">No saved bundles</div>
                <div class="empty-state-description">
                  Save a tray here and it can go into any session later.
                </div>
              </div>`
				}
      </div>
    `;
	},

	/** One bundle. */
	renderBundle(bundle) {
		const items = bundle.items || [];
		const bytes = items.reduce((n, i) => n + (i.bytes || 0), 0);
		return `
      <div class="tray-bundle" data-bundle-id="${Utils.escapeHtml(bundle.id)}">
        <div class="tray-bundle-head">
          <span class="tray-bundle-name">${Utils.escapeHtml(bundle.name)}</span>
          <span class="tray-bundle-meta">
            ${items.length} item${items.length === 1 ? "" : "s"} · about ${this.formatBytes(bytes)}
          </span>
        </div>
        ${
					bundle.description
						? `<div class="tray-bundle-desc">${Utils.escapeHtml(bundle.description)}</div>`
						: ""
				}
        <div class="tray-bundle-actions">
          <button class="btn btn-xs tray-bundle-load">Load</button>
          <button class="btn btn-xs tray-bundle-append">Add to tray</button>
          <button class="btn btn-xs btn-danger tray-bundle-delete">Delete</button>
        </div>
      </div>
    `;
	},
};

window.TrayBundlesMixin = TrayBundlesMixin;
