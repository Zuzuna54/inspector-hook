/**
 * Four-corpus search senders.
 *
 * `refresh` is exposed separately from `find` because the index reads its
 * sources on a staleness window rather than being pushed to. A user who has
 * just written a memory file and wants it findable NOW needs a way to say so;
 * making every search rebuild would re-read every memory file on the machine
 * per keystroke.
 */

const FindApiMixin = {
	/**
	 * @param {{query: string, projectId?: string, limit?: number, refresh?: boolean}} params
	 */
	contextFind(params) {
		this.send("context-find", params || {});
	},

	/** Corpus sizes, and what the store costs on disk. */
	contextFindStats() {
		this.send("context-find-stats", {});
	},

	/** Force a rebuild, then return the new sizes. */
	contextFindRefresh() {
		this.send("context-find-refresh", {});
	},

	/**
	 * Add a search hit to the tray by ID.
	 *
	 * The id, never the snippet the search returned. The core resolves it back
	 * to the source: a 600-character snippet added as if it were the whole
	 * memory file would be injected as a truncated file with nothing saying so.
	 * The reply is the ordinary `context-tray` message, so the tray updates
	 * through the path it already has.
	 */
	contextAddFromFind(params) {
		this.send("context-add-from-find", params || {});
	},
};

window.FindApiMixin = FindApiMixin;
