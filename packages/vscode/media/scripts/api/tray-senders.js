/**
 * Context tray senders.
 *
 * Every mutation returns the whole tray AND the preview in one reply, so the
 * view never recomputes the byte cost itself. Two places computing "what would
 * be injected" is how a preview starts disagreeing with the delivery, which is
 * the exact failure the tray is built to avoid.
 */

const TrayApiMixin = {
	/** Fetch the tray and its rendered preview. */
	contextGetTray() {
		this.send("context-get-tray", {});
	},

	/**
	 * @param {{kind: string, title: string, text: string, source?: Object}} item
	 */
	contextAddItem(item) {
		this.send("context-add-item", item);
	},

	/**
	 * @param {{itemId: string, text?: string, title?: string, include?: boolean}} patch
	 */
	contextUpdateItem(patch) {
		this.send("context-update-item", patch);
	},

	/** Drop an edit, restoring what the source produced. */
	contextResetItem(itemId) {
		this.send("context-reset-item", { itemId });
	},

	contextRemoveItem(itemId) {
		this.send("context-remove-item", { itemId });
	},

	/** Order is the injection order, so this is a real operation. */
	contextReorderItems(itemIds) {
		this.send("context-reorder-items", { itemIds });
	},

	contextClearTray() {
		this.send("context-clear-tray", {});
	},

	// ==========================================================================
	// Tiers that reach a RUNNING session (P4)
	//
	// `nextSession` is not here: it stays on memory-stage-context, whose hook is
	// already installed. These two go through the UserPromptSubmit injector.
	// ==========================================================================

	/**
	 * @param {{tier: "now"|"pinned", targetSessionId: string, ttlMs?: number}} params
	 */
	contextArm(params) {
		this.send("context-arm", params);
	},

	contextGetArmed(sessionId) {
		this.send("context-get-armed", sessionId ? { sessionId } : {});
	},

	contextDisarm(params) {
		this.send("context-disarm", params);
	},

	/** Sessions that could receive context. The user picks; nothing guesses. */
	contextGetTargets() {
		this.send("context-get-targets", {});
	},
};

window.TrayApiMixin = TrayApiMixin;
