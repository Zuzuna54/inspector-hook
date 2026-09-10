/**
 * The state slices added by P8, P9 and P10.
 *
 * `agentsView`, `researchView` and `qualityView` each have a "reset() and the
 * literal must not drift" regression, and for a reason worth repeating: a slice
 * is written in THREE places in state.js — the initial literal, the snapshot
 * getter, and again inside `reset()`. Adding a key to one and not the others is
 * silent. The view keeps working until someone clears state, and then a field
 * it depends on is simply gone.
 *
 * `contextFind`, `projectFilter` and `injectionsView` had no such guard. This
 * is it.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { readMedia } from "./harness.js";

const SLICES = ["contextFind", "projectFilter", "injectionsView"];

const source = readMedia("scripts/state.js");

/**
 * The keys a slice declares in one of its three definitions.
 *
 * Read textually rather than by evaluating state.js: `reset()` is a method on
 * the same object, so evaluating it would produce the post-reset shape for both
 * and the comparison would be vacuous by construction.
 */
function keysIn(block) {
	return [...block.matchAll(/^\t{2,3}(\w+):/gm)].map((m) => m[1]).sort();
}

function literalBlock(slice) {
	const re = new RegExp(`\\n\\t${slice}: \\{([\\s\\S]*?)\\n\\t\\},`);
	const m = re.exec(source);
	assert.ok(m, `no initial literal for ${slice}`);
	return m[1];
}

function resetBlock(slice) {
	const re = new RegExp(
		`\\n\\t\\tthis\\.${slice} = \\{([\\s\\S]*?)\\n\\t\\t\\};`,
	);
	const m = re.exec(source);
	assert.ok(m, `${slice} is never restored by reset()`);
	return m[1];
}

describe("state slices are defined consistently", () => {
	for (const slice of SLICES) {
		it(`${slice}: reset() and the literal define the same keys`, () => {
			assert.deepEqual(
				keysIn(resetBlock(slice)),
				keysIn(literalBlock(slice)),
				`reset() and the initial ${slice} literal define different keys`,
			);
		});

		it(`${slice} is included in the state snapshot`, () => {
			// A slice missing here is invisible to anything reading the snapshot,
			// which is how a view ends up subscribing to a key that never changes.
			assert.match(
				source,
				new RegExp(`\\n\\t{3}${slice}: this\\.${slice},`),
				`${slice} is not in the snapshot getter`,
			);
		});

		it(`${slice} declares at least one key`, () => {
			// Guards the guard: a regex that matched an empty block would make
			// both assertions above pass against nothing.
			assert.ok(keysIn(literalBlock(slice)).length > 0, `${slice} looks empty`);
		});
	}
});
