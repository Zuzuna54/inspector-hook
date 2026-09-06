/**
 * Transcript senders (P5).
 *
 * Two calls, deliberately separate. `stats` answers the cheap question — how
 * full did this session's context get — without carrying a page of content back
 * across the wire, and it is the one the Sessions view asks on every selection.
 */

const TranscriptApiMixin = {
	/** @param {{sessionId?: string, offset?: number, limit?: number, includeAll?: boolean}} params */
	transcriptGet(params) {
		this.send("transcript-get", params);
	},

	/** @param {string} sessionId */
	transcriptStats(sessionId) {
		this.send("transcript-stats", { sessionId });
	},

	/**
	 * Compose selected turns into a tray item.
	 *
	 * Sends INDEXES, never text. The core re-reads the transcript and builds the
	 * item from what the file says now — composing here would mean the text
	 * reaching a future session came from whatever this view last rendered.
	 *
	 * @param {{sessionId: string, indexes: number[], title?: string}} params
	 */
	contextAddFromTranscript(params) {
		this.send("context-add-from-transcript", params);
	},
};

window.TranscriptApiMixin = TranscriptApiMixin;
