/**
 * Merge an incremental activity batch into what is already held.
 *
 * Extracted verbatim from api.js, which had grown past the 600-line limit this
 * package holds itself to. This function was the obvious first piece to move:
 * it touches no other module, depends on nothing, and already had its own test
 * (test/activity-merge.test.js).
 */

/**
 * Merge an incremental activity batch into what is already held.
 *
 * Keyed by id, resolved by `updatedAt` - NOT by arrival order. An item's
 * updatedAt differs from its timestamp only for a tool call, which keeps its
 * start time while status, result and duration arrive later; taking whichever
 * copy arrived last would let a slow or reordered response overwrite a newer
 * one with a stale one, turning a completed tool call back into a running one.
 *
 * The cursor is inclusive, so every poll deliberately re-sends the items on the
 * boundary instant - 35% of real logs share a timestamp with another, and one
 * instant covered twelve. Re-sending them is what stops an exclusive cursor
 * silently dropping the lot; merging by id is what makes the repeat harmless.
 *
 * Ordering is by timestamp, which is the order the feed reads in, not by
 * updatedAt, which would make a completing tool call jump to the end.
 *
 * @param {Array} existing
 * @param {Array} incoming
 * @returns {Array}
 */
function mergeActivity(existing, incoming) {
	if (!incoming.length) return existing;

	const stamp = (item) => String(item?.updatedAt || item?.timestamp || "");

	const byId = new Map();
	for (const item of existing || []) byId.set(item.id, item);
	for (const item of incoming) {
		const held = byId.get(item.id);
		if (!held || stamp(item) >= stamp(held)) byId.set(item.id, item);
	}

	return [...byId.values()].sort((a, b) =>
		String(a.timestamp || "").localeCompare(String(b.timestamp || "")),
	);
}

window.mergeActivity = mergeActivity;
