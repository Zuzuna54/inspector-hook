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
})();
