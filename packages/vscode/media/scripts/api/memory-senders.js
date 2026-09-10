/**
 * Memory and context senders (M3 — native auto memory).
 *
 * Split out of api.js, which the size guard caught growing past its recorded
 * ceiling for the third time. These are pure `send()` wrappers with no shared
 * state, so they compose onto API after the literal exactly as the view mixins
 * do — the same pattern the Sessions and File Changes views already use.
 *
 * The inbound handlers for these replies stay in api.js for now: the message
 * switch needs a registry before it can be split safely, because two files
 * silently claiming one message type would let the last one loaded win. That
 * is the next step, not this one.
 */

const MemoryApiMixin = {
	// ==========================================================================
	// Memory API (M3 - native auto memory)
	// ==========================================================================

	/** Every project's memory. `includeEmpty` keeps projects with no files. */
	memoryGetProjects(params = {}) {
		this.send("memory-get-projects", params);
	},

	/** Reference an existing file from MEMORY.md without rewriting the file. */
	memoryAddToIndex(params) {
		this.send("memory-add-to-index", params);
	},

	/** Drop a file's index line, leaving the file in place. */
	memoryRemoveFromIndex(params) {
		this.send("memory-remove-from-index", params);
	},

	/**
	 * Create or update a memory entry.
	 *
	 * `userInitiated` is what allows editing a note the tool did not author, and
	 * is set only from an explicit save in the curation UI.
	 */
	memoryWrite(params) {
		this.send("memory-write", params);
	},

	/** Delete a memory entry. `force` is required for anything we did not author. */
	memoryDelete(params) {
		this.send("memory-delete", params);
	},

	/**
	 * Stage context for the next session that starts.
	 *
	 * The backend returns exactly the text the hook will emit, which is what
	 * lets the preview and the delivery be the same artefact rather than two
	 * renderings of one intent.
	 */
	memoryStageContext(params) {
		this.send("memory-stage-context", params);
	},

	/** What is staged right now, if anything. Expiry is applied on read. */
	memoryGetStaged() {
		this.send("memory-get-staged", {});
	},

	/** Discard whatever is staged. */
	memoryClearStaged() {
		this.send("memory-clear-staged", {});
	},

	/**
	 * Preview a session's digest WITHOUT writing it.
	 *
	 * No write flag is sent: v1 previews only, and the surest way to keep that
	 * true is for the client to be unable to ask for a write.
	 */
	memoryBuildDigest(sessionId) {
		this.send("memory-build-digest", { sessionId });
	},

	/**
	 * Build the digest AND write it into Claude Code's own auto memory.
	 *
	 * A separate sender from the preview on purpose: this writes a file that
	 * changes what every future session in that project is told, so it cannot
	 * be something a preview does as a side effect.
	 */
	memoryWriteDigest(sessionId) {
		this.send("memory-build-digest", { sessionId, write: true });
	},

	/**
	 * Preview the digest WITH a generated prose summary (P11).
	 *
	 * Separate from the plain preview because it costs a model call. Two more
	 * gates sit behind it in the core — INSPECTOR_HOOK_NARRATIVE=1 and `claude`
	 * on PATH — and a refusal comes back with the reason rather than silently
	 * producing the same digest.
	 */
	memoryNarrateDigest(sessionId) {
		this.send("memory-build-digest", { sessionId, narrative: true });
	},
};

window.MemoryApiMixin = MemoryApiMixin;
