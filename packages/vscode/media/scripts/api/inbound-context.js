/**
 * Inbound message handlers: Native auto memory and staged context.
 *
 * Registered rather than merged. Message types are DATA, and a mixin merge
 * would let two files silently claim one type with the last loaded winning --
 * a class of bug this codebase has already paid for twice. `API.on` throws on
 * a duplicate instead.
 *
 * Each handler is called with `API` as `this`, so `this.send` and the badge
 * helpers work exactly as they did inside the switch.
 */

(() => {
	const API = window.API;

	API.on(["memory-staged"], function (payload) {
 {
		const refused = payload && payload.staged === false;
		State.update("contextView", {
			...State.contextView,
			staged: refused ? null : payload || null,
			stageRefusal: refused ? payload.reason || "Staging was refused." : null,
		});
		return;
	}
	});
	API.on(["memory-digest"], function (payload) {

		State.update("contextView", {
			...State.contextView,
			digest: payload || null,
		});
	});
	API.on(["memory-projects"], function (payload) {

		State.update("contextView", {
			...State.contextView,
			projects: payload?.projects || payload || [],
		});
		return;
	// One shape for every curation result. The backend answers a refusal
	// with a human-readable `reason`, and the view renders it verbatim -
	// paraphrasing would lose the detail that makes it actionable.
	});
	API.on(["memory-result"], function (payload) {
 {
		State.update("contextView", {
			...State.contextView,
			lastResult: payload || null,
		});
		// Re-read rather than patching local state: the index, the file and
		// its orphan status can all have changed together.
		this.memoryGetProjects({ includeEmpty: true });
		return;
	}
	});
})();
