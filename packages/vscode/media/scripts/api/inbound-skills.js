/**
 * Inbound message handlers: skills and MCP tools (M8).
 *
 * Registered via API.on rather than merged, so two files cannot silently claim
 * one message type with the last loaded winning.
 */

(() => {
	const API = window.API;

	API.on(["skills-overview"], (payload) => {
		const result = payload || {};
		State.update("skillsView", {
			...(State.skillsView || {}),
			skills: result.skills || [],
			servers: result.servers || [],
			archived: result.archived || [],
			summary: result.summary || null,
			// The source is kept even on failure: "we counted 0 transcripts" and
			// "nothing has ever fired" are different claims and the view says so.
			source: result.source || null,
			loading: false,
			error: result.error || (result.source && result.source.error) || null,
		});
	});

	API.on(["skills-file"], (payload) => {
		const file = payload || {};
		State.update("skillsView", {
			...(State.skillsView || {}),
			file,
			fileLoading: false,
		});
	});

	API.on(["skills-archived"], (payload) => {
		const result = payload || {};
		State.update("skillsView", {
			...(State.skillsView || {}),
			// Cleared unconditionally: a refused archive must stop the spinner and
			// show why, not leave the row pending forever.
			busyId: null,
			actionError: result.ok ? null : result.error || "the archive failed",
		});
	});
})();
