/**
 * The global project filter (P9).
 *
 * ## Three-valued, and that is the whole point
 *
 * `in` / `out` / **`unknown`**. A boolean forces "cannot tell" to become "no",
 * and "no" hides data. Measured on the real store: 0 of 17 memory files and
 * 0 of 238 file changes carried any project key, so a boolean filter hid
 * almost everything and reported it as an empty result.
 *
 * Unknowns are therefore KEPT and labelled. A view shows them in their own
 * group so the reader can see the filter could not decide, rather than being
 * shown a confidently short list.
 *
 * ## Matching is exact set membership, never re-derived here
 *
 * The core resolves a path to its repository root through the filesystem — it
 * walks up looking for `.git` — and ships every concrete path it resolved on
 * `identity.paths`. This module only asks whether a record's key is in that
 * set.
 *
 * It deliberately does NOT do prefix matching. A prefix rule looks equivalent
 * and is not: a session run from the home directory has `/Users/<me>` as its
 * root, which is a prefix of every project on the machine, and that rule
 * collapsed the entire repo into one "giorgobg" project when the core tried
 * it. One matcher, in the core; this is a lookup.
 */

const ProjectFilter = {
	/** "in" | "out" | "unknown" */
	match(identity, record) {
		if (!identity) return "in";

		const paths = identity.paths || [];
		const candidates = [];
		if (record?.path) candidates.push(["path", record.path]);
		if (record?.projectKey) candidates.push(["key", record.projectKey]);
		if (record?.slug) candidates.push(["slug", record.slug]);

		if (candidates.length === 0) return "unknown";

		for (const [kind, value] of candidates) {
			if (kind === "path" && paths.includes(value)) return "in";
			if (kind === "key") {
				if (identity.gitRemote && value === identity.gitRemote) return "in";
				if (paths.includes(value)) return "in";
			}
			if (kind === "slug" && identity.slug && value === identity.slug) return "in";
		}
		return "out";
	},

	/**
	 * Split a list into what belongs, and what could not be decided.
	 *
	 * Returns both rather than a filtered array, because a caller that only
	 * received the matches would have no way to tell the reader that some
	 * records were simply unattributable — which is the difference between
	 * "this project has 4 sessions" and "4 sessions, and 6 we cannot place".
	 */
	split(identity, records, keyOf) {
		const included = [];
		const unknown = [];
		for (const record of records || []) {
			const verdict = this.match(identity, keyOf ? keyOf(record) : record);
			if (verdict === "in") included.push(record);
			else if (verdict === "unknown") unknown.push(record);
		}
		return { included, unknown };
	},

	/** The identity currently selected, or null for every project. */
	selected() {
		const filter = (typeof State !== "undefined" && State.projectFilter) || {};
		if (!filter.selectedId) return null;
		return (filter.projects || []).find((p) => p.id === filter.selectedId) || null;
	},
};

if (typeof window !== "undefined") window.ProjectFilter = ProjectFilter;
