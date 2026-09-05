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
		this.setupHandlers();
		this.render();
		API.contextGetTray();
	},

	cleanup() {
		this._unsubscribers.forEach((unsub) => unsub());
		this._unsubscribers = [];
	},

	render() {
		const el = document.getElementById("tray-body");
		if (!el) return;
		const { tray, preview, lastRefusal, editing, draft } = State.contextTray;
		el.innerHTML = this.renderTray(tray, preview, lastRefusal, editing, draft);
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

			if (e.target.closest(".tray-clear")) {
				API.contextClearTray();
				return;
			}
			if (e.target.closest(".tray-stage")) {
				this.stage();
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
	stage() {
		const { preview } = State.contextTray;
		if (!preview || !preview.text) return;
		API.memoryStageContext({ text: preview.text, label: "Context tray" });
	},
};

Object.assign(TrayView, window.TrayRenderMixin);
window.TrayView = TrayView;
Router.register("tray", TrayView);
