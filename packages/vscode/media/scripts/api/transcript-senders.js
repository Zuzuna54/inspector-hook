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
};

window.TranscriptApiMixin = TranscriptApiMixin;
