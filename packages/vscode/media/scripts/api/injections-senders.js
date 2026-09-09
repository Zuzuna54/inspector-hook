/**
 * What was injected INTO a session (P10).
 *
 * Read from the append-only log the HOOKS write. Never derived from
 * `StagedContext.sourceSessionId`, which records where text came FROM — a
 * different session, and reading it as a delivery record answers the question
 * backwards.
 */

const InjectionsApiMixin = {
	/** Deliveries for one session, newest first. */
	getInjections(sessionId, limit) {
		this.send("context-get-injections", { sessionId, limit });
	},

	/** One summary per session, for marking rows without a scan each. */
	getInjectionCounts() {
		this.send("context-injection-counts", {});
	},
};

window.InjectionsApiMixin = InjectionsApiMixin;
