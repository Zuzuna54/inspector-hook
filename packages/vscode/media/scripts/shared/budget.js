/**
 * Claude's index load budget, in one place.
 *
 * Mirrored from packages/protocol/src/memory.ts. The webview cannot import from
 * the protocol package — these are classic scripts with no module system — so
 * the numbers are restated, and a test asserts they still match the protocol's.
 *
 * ONE copy, deliberately. They started in memory-render.js, and the moment a
 * second surface needed them the choice was a cross-file global or a third
 * hand-written copy. Two copies of a constant is how a budget indicator starts
 * disagreeing with itself, and this one is already restated across a package
 * boundary — a third would be pushing it.
 *
 * Reporting only: nothing truncates the user's file. `native-memory.ts` is
 * explicit about that. Past this point Claude stops reading the tail, so the
 * number describes where attention ends, not a limit anything enforces.
 */

const INDEX_LOAD_LINES = 200;
const INDEX_LOAD_BYTES = 25 * 1024;

// Published on globalThis as well as window.
//
// In the webview these are the same object, so this is a no-op there. Under the
// test harness they are not: window is a plain stub, and a bare
// `INDEX_LOAD_LINES` in another file resolves against globalThis. Writing both
// means the module works under any loader rather than only the one it happens
// to ship in — which is the same reason the other shared modules publish
// explicitly instead of relying on cross-script const bindings.
window.INDEX_LOAD_LINES = INDEX_LOAD_LINES;
window.INDEX_LOAD_BYTES = INDEX_LOAD_BYTES;
globalThis.INDEX_LOAD_LINES = INDEX_LOAD_LINES;
globalThis.INDEX_LOAD_BYTES = INDEX_LOAD_BYTES;
