/**
 * Inbound handler for the project list.
 *
 * A failure arrives as an empty list plus a reason, never as silence: the
 * picker gates every other view, so an unanswered message would leave the
 * panel filtered by something that never loads.
 */

(() => {
	const API = window.API;

	API.on("projects", function (payload) {
		const projects = Array.isArray(payload?.projects) ? payload.projects : [];
		const current = State.projectFilter || {};
		// A selection that no longer exists is dropped rather than kept. Keeping
		// it would scope every view to a project the core cannot resolve, which
		// renders as an empty store rather than as a stale filter.
		const stillThere = projects.some((p) => p.id === current.selectedId);
		State.update("projectFilter", {
			...current,
			projects,
			selectedId: stillThere ? current.selectedId : null,
			error: payload?.error || null,
		});
	});
})();
