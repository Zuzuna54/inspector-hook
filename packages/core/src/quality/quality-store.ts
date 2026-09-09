/**
 * Persisted quality reports and trends (Milestone 7).
 *
 * M7 asks for scans "stored with history, surfaced with trends". A single
 * snapshot answers "is there dead code"; history answers "is it getting worse",
 * which is the question that changes behaviour.
 *
 * ## Why a bounded ring rather than everything
 *
 * A report carries every finding plus the graph's god nodes, so it is a few KB
 * and a project scanned on every commit would grow without limit — the same
 * shape as the log store before retention existed. `MAX_HISTORY` snapshots are
 * kept per project, oldest dropped first.
 *
 * ## Why trends are computed from summaries only
 *
 * A trend point holds counts, not findings. Loading fifty full reports to draw
 * a line would read megabytes to render a sparkline, and the counts are the
 * only thing a trend can honestly show: "the same three files" and "three
 * different files each time" both read as 3, so the view links to the reports
 * rather than pretending the line says more than it does.
 *
 * ## The comparison rule
 *
 * `highDelta` is computed ONLY between points whose `measured` tool sets match.
 * A project where knip was unavailable last week and available today would
 * otherwise show a jump in dead code that is really a jump in coverage —
 * exactly the kind of false trend this project treats as a priority bug.
 */

import type {
	QualityReport,
	QualityTrend,
	QualityTrendPoint,
} from "@inspector-hook/protocol";

import type { PersistenceStore } from "../persistence/store.js";

/** Storage category, alongside `research` and `sessions`. */
export const QUALITY_CATEGORY = "quality";

/** Snapshots retained per project. */
export const MAX_HISTORY = 30;

/** A project's stored history, newest last. */
interface StoredHistory {
	version: 1;
	projectRoot: string;
	reports: QualityReport[];
}

/**
 * A filesystem-safe id for a project path.
 *
 * The path is the natural key and is not usable as a filename. Encoded rather
 * than hashed so a human can still tell whose history a file is by looking at
 * it — a hash would make the store unreadable during exactly the debugging it
 * would be needed for.
 */
export function projectStoreId(root: string): string {
	return root.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

export class QualityStore {
	constructor(private readonly persistence?: PersistenceStore) {}

	/** Append a report, dropping the oldest beyond MAX_HISTORY. */
	async save(report: QualityReport): Promise<void> {
		if (!this.persistence) return;
		const id = projectStoreId(report.projectRoot);
		const history = await this.load(report.projectRoot);
		history.push(report);
		const kept = history.slice(-MAX_HISTORY);
		const doc: StoredHistory = {
			version: 1,
			projectRoot: report.projectRoot,
			reports: kept,
		};
		await this.persistence.saveJSON(QUALITY_CATEGORY, id, doc);
	}

	/** Every stored report for a project, oldest first. */
	async load(root: string): Promise<QualityReport[]> {
		if (!this.persistence) return [];
		try {
			const doc = await this.persistence.loadJSON<StoredHistory>(
				QUALITY_CATEGORY,
				projectStoreId(root),
			);
			return Array.isArray(doc?.reports) ? doc.reports : [];
		} catch {
			// A corrupt history must not stop a new scan being stored.
			return [];
		}
	}

	/** The newest report for a project, or null when never scanned. */
	async latest(root: string): Promise<QualityReport | null> {
		const reports = await this.load(root);
		return reports.length > 0 ? reports[reports.length - 1] : null;
	}

	/**
	 * A project's trend.
	 *
	 * `highDelta` compares only the newest point against the newest EARLIER
	 * point measured by the same tools. When no such pair exists the delta is 0
	 * — not because nothing changed, but because nothing comparable exists, and
	 * inventing a number there would be the false trend this guards against.
	 */
	async trend(root: string): Promise<QualityTrend> {
		const reports = await this.load(root);
		const points: QualityTrendPoint[] = reports.map((r) => ({
			scannedAt: r.scannedAt,
			high: r.summary.high,
			medium: r.summary.medium,
			low: r.summary.low,
			circular: r.summary.circular,
			secrets: r.summary.secrets,
			couplingRatio: r.graph?.coupling.ratio,
			orphanCount: r.graph?.orphanCount,
		}));

		let highDelta = 0;
		if (reports.length >= 2) {
			const newest = reports[reports.length - 1];
			const key = (r: QualityReport) =>
				[...r.summary.measured].sort().join(",");
			const newestKey = key(newest);
			for (let i = reports.length - 2; i >= 0; i--) {
				if (key(reports[i]) !== newestKey) continue;
				highDelta = newest.summary.high - reports[i].summary.high;
				break;
			}
		}

		return { projectRoot: root, points, highDelta };
	}
}
