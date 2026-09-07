/**
 * Context tray: the controller.
 *
 * Registered as a ROUTE first, deliberately. The plan calls for the tray to
 * live as a dock beside the sidebar so items can be added from search results
 * and session rows while the running total stays visible — but if this panel is
 * docked to VS Code's narrow sidebar, a 168px nav plus a right rail leaves
 * nothing. Building the route first means the tray works either way, and the
 * dock becomes a second host for the same renderers rather than the only one.
 *
 * Nothing here computes bytes. Every figure comes from the core's preview, so
 * the panel cannot disagree with what would actually be injected.
 */

const TrayView = {
	_unsubscribers: [],
	_delegated: false,

	init() {
		this._unsubscribers.push(
			State.subscribe("contextTray", () => this.render()),
		);
		// The "what would load" pane reads the memory corpus, which lives in a
		// different slice and arrives asynchronously. Without this it would sit
		// on "pick a project" after one had been picked.
		this._unsubscribers.push(
			State.subscribe("contextView", () => {
				if (State.contextTray.activeTab === "load") this.render();
			}),
		);
		this.setupHandlers();
		this.render();
		API.contextGetTray();
		// Candidate sessions, so the target picker is populated before the user
		// reaches for it rather than after.
		API.contextGetTargets();
	},

	cleanup() {
		this._unsubscribers.forEach((unsub) => unsub());
		this._unsubscribers = [];
	},

	render() {
		const el = document.getElementById("tray-body");
		if (!el) return;
		const t = State.contextTray;
		const tabs = `
      <div class="tray-tabs" role="tablist">
        <button class="tray-tab ${t.activeTab === "items" ? "active" : ""}" data-tray-tab="items">
          Compose
        </button>
        <button class="tray-tab ${t.activeTab === "load" ? "active" : ""}" data-tray-tab="load">
          What would load
        </button>
        <button class="tray-tab ${t.activeTab === "bundles" ? "active" : ""}" data-tray-tab="bundles">
          Bundles
        </button>
      </div>
    `;

		// The "what would load" pane is per PROJECT, because memory is. It reads
		// the project selected in the Context view rather than duplicating a
		// picker, and says so when none is selected.
		const body =
			t.activeTab === "bundles"
				? this.renderBundles(t.bundles, t.tray)
				: t.activeTab === "load"
				? this.renderWhatWouldLoad(
						this.selectedMemoryProject(),
						t.preview,
						State.contextView.staged,
					)
				: this.renderTray(
						t.tray, t.preview, t.lastRefusal, t.editing, t.draft,
						t.targets, t.targetSessionId, t.armed,
					);

		el.innerHTML = tabs + body;
	},

	/**
	 * The project the Context view has selected, if any.
	 *
	 * Read rather than duplicated: a second project picker would be a second
	 * source of truth about which project is being looked at.
	 */
	selectedMemoryProject() {
		const { projects, selectedProject } = State.contextView;
		if (!selectedProject) return null;
		return (projects || []).find((p) => p.memoryDir === selectedProject) || null;
	},

	/** The item currently open in the editor, or null. */
	editingItem() {
		const { tray, editing } = State.contextTray;
		if (!tray || !editing) return null;
		return (tray.items || []).find((i) => i.id === editing) || null;
	},

	/**
	 * Delegated, and installed once.
	 *
	 * The container survives view switches, so re-registering on every init
	 * would stack duplicate listeners and fire each action twice.
	 */
	setupHandlers() {
		const root = document.getElementById("view-tray");
		if (!root || this._delegated) return;
		this._delegated = true;

		root.addEventListener("click", (e) => {
			const row = e.target.closest(".tray-item");
			const itemId = row?.dataset.itemId;

			const tab = e.target.closest(".tray-tab");
			if (tab) {
				const activeTab = tab.dataset.trayTab;
				State.update("contextTray", { ...State.contextTray, activeTab });
				// Fetched when the pane is opened rather than at init: a list
				// nobody looked at is a read nobody needed.
				if (activeTab === "bundles") API.contextListBundles();
				return;
			}

			if (e.target.closest(".tray-bundle-create")) {
				const input = document.getElementById("tray-bundle-name");
				const name = (input?.value || "").trim();
				if (name) {
					API.contextSaveBundle({ name });
					if (input) input.value = "";
				}
				return;
			}

			const bundleRow = e.target.closest(".tray-bundle");
			const bundleId = bundleRow?.dataset.bundleId;
			if (bundleId) {
				if (e.target.closest(".tray-bundle-load")) {
					API.contextLoadBundle({ id: bundleId, mode: "replace" });
					// Loading puts items back in the tray, so show them.
					State.update("contextTray", { ...State.contextTray, activeTab: "items" });
					return;
				}
				if (e.target.closest(".tray-bundle-append")) {
					API.contextLoadBundle({ id: bundleId, mode: "append" });
					State.update("contextTray", { ...State.contextTray, activeTab: "items" });
					return;
				}
				if (e.target.closest(".tray-bundle-delete")) {
					API.contextDeleteBundle(bundleId);
					return;
				}
			}
			if (e.target.closest(".tray-clear")) {
				API.contextClearTray();
				return;
			}
			if (e.target.closest(".tray-stage")) {
				this.stage();
				return;
			}
			if (e.target.closest(".tray-arm-now")) {
				this.arm("now");
				return;
			}
			if (e.target.closest(".tray-arm-pinned")) {
				this.arm("pinned");
				return;
			}
			const disarm = e.target.closest(".tray-disarm");
			if (disarm) {
				API.contextDisarm({
					tier: disarm.dataset.tier,
					targetSessionId: State.contextTray.targetSessionId,
				});
				return;
			}
			if (!itemId) return;

			if (e.target.closest(".tray-remove")) {
				API.contextRemoveItem(itemId);
				return;
			}
			if (e.target.closest(".tray-reset")) {
				API.contextResetItem(itemId);
				return;
			}
			if (e.target.closest(".tray-edit")) {
				this.toggleEdit(itemId);
				return;
			}
			if (e.target.closest(".tray-save")) {
				API.contextUpdateItem({ itemId, text: State.contextTray.draft });
				this.toggleEdit(null);
				return;
			}
			if (e.target.closest(".tray-up")) {
				this.move(itemId, -1);
				return;
			}
			if (e.target.closest(".tray-down")) {
				this.move(itemId, 1);
			}
		});

		root.addEventListener("change", (e) => {
			if (e.target.id === "tray-target") {
				const targetSessionId = e.target.value || null;
				State.update("contextTray", { ...State.contextTray, targetSessionId });
				// What is armed is per session, so switching target has to refetch
				// rather than keep showing the previous session's pins.
				if (targetSessionId) API.contextGetArmed(targetSessionId);
				return;
			}
			if (!e.target.classList?.contains("tray-include")) return;
			const itemId = e.target.closest(".tray-item")?.dataset.itemId;
			if (itemId) API.contextUpdateItem({ itemId, include: e.target.checked });
		});

		// Held in state rather than read off the textarea at save time, so the
		// draft survives a re-render. Mutated directly for the same reason the
		// memory editor does: a State.update here would re-render and take the
		// cursor with it.
		root.addEventListener("input", (e) => {
			if (e.target.classList?.contains("tray-editor-body")) {
				State.contextTray.draft = e.target.value;
			}
		});
	},

	/** Open or close the editor for one item. */
	toggleEdit(itemId) {
		const open = State.contextTray.editing === itemId ? null : itemId;
		const item = open
			? (State.contextTray.tray?.items || []).find((i) => i.id === open)
			: null;
		State.update("contextTray", {
			...State.contextTray,
			editing: open,
			draft: item ? (item.editedText ?? item.originalText) : "",
		});
	},

	/** Move one item by a step, and send the whole new order. */
	move(itemId, step) {
		const items = [...(State.contextTray.tray?.items || [])];
		const from = items.findIndex((i) => i.id === itemId);
		const to = from + step;
		if (from === -1 || to < 0 || to >= items.length) return;
		const [moved] = items.splice(from, 1);
		items.splice(to, 0, moved);
		API.contextReorderItems(items.map((i) => i.id));
	},

	/**
	 * Stage the rendered tray for the next session.
	 *
	 * Sends the PREVIEW's text, which the core produced from the tray it holds.
	 * Re-rendering here would put a second templating step between preview and
	 * delivery, which is the one thing this whole path exists to avoid.
	 */
	/**
	 * Arm the tray for a running session.
	 *
	 * The core re-renders from the tray it holds rather than taking text from
	 * here: one renderer, so what is armed cannot differ from what the preview
	 * showed. `now` is one-shot; `pinned` repeats every prompt until unpinned,
	 * and its expiry is mandatory rather than a default the caller may omit.
	 */
	arm(tier) {
		const { targetSessionId, preview } = State.contextTray;
		if (!targetSessionId || !preview?.text) return;
		API.contextArm({ tier, targetSessionId, label: "Context tray" });
	},

	stage() {
		const { preview } = State.contextTray;
		if (!preview || !preview.text) return;
		API.memoryStageContext({ text: preview.text, label: "Context tray" });
	},
};

Object.assign(
	TrayView,
	window.TrayRenderMixin,
	window.TrayPreviewMixin,
	window.TrayBundlesMixin,
);
window.TrayView = TrayView;
Router.register("tray", TrayView);
