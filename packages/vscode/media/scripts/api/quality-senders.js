/**
 * Code quality senders (M7).
 *
 * `qualityScan` runs external tools and takes tens of seconds. It is a separate
 * call from `qualityReport` on purpose: a view that scanned on open would show
 * nothing for twelve seconds.
 */

const QualityApiMixin = {
	/** Every project that could be scanned, with its last result. */
	qualityProjects() {
		this.send("quality-projects", {});
	},

	/**
	 * Scan now. Slow — knip and madge are external processes.
	 *
	 * `buildGraph` additionally runs `graphify update`, which walks the whole
	 * repository and WRITES a graphify-out/ directory into it. That is the only
	 * thing a scan does to a project rather than to our own store, so it is
	 * never implied — a caller has to ask.
	 */
	qualityScan(root, buildGraph = false) {
		this.send("quality-scan", { root, buildGraph });
	},

	/** The stored report, without rescanning. */
	qualityReport(root) {
		this.send("quality-report", { root });
	},

	qualityTrend(root) {
		this.send("quality-trend", { root });
	},
};

if (typeof window !== "undefined" && window.API) {
	Object.assign(window.API, QualityApiMixin);
}
