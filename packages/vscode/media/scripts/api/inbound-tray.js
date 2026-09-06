/**
 * Inbound handler for the context tray.
 *
 * One reply type carries the tray, the preview and any refusal, because they
 * always arrive together — the core computes the preview from the tray it just
 * wrote, so splitting them would let the two disagree in flight.
 */

(() => {
	const API = window.API;

	API.on("context-tray", function (payload) {
		// A refusal comes back as `{ok:false, reason}` with no tray. Storing it
		// as a tray is exactly the bug the staging path had: a failure rendering
		// as a success with an empty body. Branch on the flag.
		const refused = payload && payload.ok === false;
		State.update("contextTray", {
			...State.contextTray,
			tray: refused ? State.contextTray.tray : payload?.tray || null,
			preview: refused ? State.contextTray.preview : payload?.preview || null,
			lastRefusal: refused ? payload.reason || "The tray refused that." : null,
		});
	});

	// What is armed for a session, and what a pin has cost. A refusal comes back
	// with `armed:false` and a reason; branching on the flag rather than on
	// truthiness is the lesson from the staging path, where a refusal rendered
	// as a success with an empty body.
	API.on("context-armed", function (payload) {
		const refused = payload && payload.armed === false;
		State.update("contextTray", {
			...State.contextTray,
			armed: refused ? State.contextTray.armed : payload || null,
			lastRefusal: refused ? payload.reason || "Arming was refused." : null,
		});
	});

	// Candidate sessions. Reported with raw ages rather than a live/dead flag:
	// there is no heartbeat, so a boolean would be an assertion nothing here can
	// support.
	API.on("context-targets", function (payload) {
		State.update("contextTray", {
			...State.contextTray,
			targets: payload?.targets || [],
		});
	});
})();
