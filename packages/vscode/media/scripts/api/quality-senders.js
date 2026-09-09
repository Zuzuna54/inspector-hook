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

	/** Scan now. Slow — knip and madge are external processes. */
	qualityScan(root) {
		this.send("quality-scan", { root });
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
