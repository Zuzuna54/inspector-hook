/**
 * Inbound message handlers: code quality.
 *
 * Registered via API.on rather than merged, so two files cannot silently claim
 * one message type with the last loaded winning.
 */

(() => {
	const API = window.API;

	API.on(["quality-projects"], (payload) => {
		const result = payload || {};
		State.update("qualityView", {
			...(State.qualityView || {}),
			projects: result.projects || [],
			discovered: result.discovered ?? 0,
			existing: result.existing ?? 0,
			scannedCount: result.scanned ?? 0,
			loading: false,
			error: result.error || null,
		});
	});

	API.on(["quality-report"], (payload) => {
		const report = payload || null;
		State.update("qualityView", {
			...(State.qualityView || {}),
			report,
			// Cleared unconditionally, including on failure: a scan that died
			// must stop the spinner, and this one legitimately runs for tens of
			// seconds so there is no timeout a user could infer from.
			scanning: false,
			error: report && report.error ? report.error : null,
		});
	});

	API.on(["quality-trend"], (payload) => {
		State.update("qualityView", {
			...(State.qualityView || {}),
			trend: payload || null,
		});
	});
})();
