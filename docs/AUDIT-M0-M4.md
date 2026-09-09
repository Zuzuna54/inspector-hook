# Independent Correctness Audit — Milestones 0–4

**Auditor:** a separate Claude Code session (`inspector-hook-bb`), report-only, no code changes.
**Subject:** branch `milestone-0-harden`, audited across pins `eb2073d` → `a66b43f` → `1a5ab2a` →
`8ee6c0c` → `e9fbb94` → `d2ae369` → `01a6ea1`. The branch moved nine times during the audit; every
finding below carries the state it was measured in.
**Scope:** all 268 rows of `docs/AUDIT-MATRIX.md`, re-derived independently, plus **84 new M3/M4
criteria** that no document in this repo had ever written down.
**Outcome:** 10 defects confirmed and reported; **8 fixed while the audit ran**, each re-verified
independently against a running core rather than accepted on the author's word (§0).

---

## Why this audit exists

This project's characteristic defect is not the crash. It is the **fix that cannot run** — code that is
written, tested, marked verified, and unreachable in the live system. B2 was correct and tested while the
installed hook forwarded no execution id. `PostToolUseFailure` was handled in the core and never
registered. Both passed their tests.

The audit was built to find more of that shape, and it did: **twenty-plus instances**, several of them
inside features whose commit messages describe them as complete.

A second pattern turned out to be the engine behind the first, and it is the most transferable thing in
this report:

> **The test builds a precondition production never builds, so the test and the code agree with each
> other and both disagree with the running system.**

Three confirmed instances, found independently:
- `renderDigest({sessionId, worthKeeping, text})` — a payload shape the core has never sent.
- `mkdir(memoryDir)` in two test setups — a directory production never creates.
- `SESSIONS_LOAD_ORDER` — a constant the test harness owns, never compared to the shipped manifest.

A third pattern, narrower but sharper: **a test whose name asserts a property its assertion cannot see.**
`archived-view.test.js:140` is named *"defines the version-content call history.js has always made"*, and
asserts only that the method and the case exist. Nothing makes the call. It passes.

---

## Verdict

| Milestone | Claimed | Audited verdict |
| --- | --- | --- |
| **M0 Harden** | complete | **Complete in substance.** B1–B5 verified, several at L4 against the shipped bundle. Two defects of the same class were found live *during* the audit and fixed; see §1. |
| **M1 Verify** | complete | **Not complete.** The matrix it rests on is self-graded, and re-derivation moved a large number of rows. The suite is green while ~20 features cannot run. |
| **M2 Transport** | "complete except the headline" | **Accurate, and the deferral is honest.** HTTP hooks were never done and the author says so. Event registration is real. One silent regression (§4) and one config contradiction, both since fixed. |
| **M3 Context** | "complete, one clause skipped" | **Was not complete; substantially closed during the audit.** The headline feature had never written a file and *could not have* — `ENOENT` for any project without an existing `memory/` directory. The picker was a permanent no-op. Curation edited a different file than the one opened and reported success. All three are now fixed and verified at L4. Still open: automatic writing remains behind an undocumented env var with no UI affordance, and "cross-project search" is whole-phrase substring matching. |
| **M4 Research** | "built, three deviations" | **Half true, precisely.** Capture and storage are real and durable — 410 live items across 7 kinds, and the durability claim was tested by deleting every log file and restarting. **The entire retrieval surface is unreachable from the UI** — three links missing per method, so this is not a view that was nearly finished. BM25 is honest about being lexical-only. |

**M0–M4 cannot be signed off as a set.** Not because the work is bad — much of it is verified below and
some is excellent — but because the document that would certify it, `AUDIT-MATRIX.md`, does not measure
reachability at all, and reachability is where this project fails.

---

## §0 — What changed while the audit ran

Findings were routed to the owning sessions as they were confirmed rather than held back for a report, so
eight landed as fixes before this was written. **Every one was re-verified independently against a running
core — none is recorded here on the author's word.** The state each defect was broken in is preserved in
the sections that follow, because a fix does not retire the evidence that produced it.

| Commit | What it closed | How it was verified |
| --- | --- | --- |
| `eb2073d` | Reaped tool calls reported `failed`; `ExecutionStatus` gained `unknown` | L4 — 3h-old unpaired call reaped to `unknown` in the shipped bundle |
| `a66b43f` | The `5f6d917` metadata regression, via a new in-core `project-resolver`; and the `tool:failed`→`tool:unknown` emit | L3/L4 — replaying 6,776 real records collapsed one repo's five `projectKey`s into one |
| `1a5ab2a` | The memory-directory `ENOENT`; late-completion reconciliation | L4 — digest written with no directory pre-created; reconciliation confirmed **with its negative case** (a stranger's `tool_use_id` leaves a reaped execution untouched) |
| `8ee6c0c` | Unregistered `MessageDisplay` + the Elicitation pair, restoring the 30-event set the installer's own comment specified | L4 — live `settings.json` back to 30/30 |
| `e9fbb94` | Matrix: three `untested` packaging rows corrected to `broken` | — (documentation) |
| `8209091` | One digest collector, so the retention path stops writing the weakest digest | L3 |
| `d2ae369` | The picker: envelope unwrapped in `panel.ts`, repairing all three readers | L4 — staged text **byte-identical** to the previewed body; barren session now refuses with its reason |
| `01a6ea1` | Curation edits landing on a different file and reporting success | L4 — edit lands in the opened file, no stray file, one index line |

**One fix was caught before it landed.** The first attempt at the picker added `sessionId` to the inner
`SessionDigest` while the webview reads it off the `{digest, written}` envelope — it would have shipped
looking fixed and changed nothing. Flagged pre-commit; the author moved the unwrap to `panel.ts`, which
repairs `sessionId`, `worthKeeping` and `body` in one change instead of one of the three.

**Two findings were declined for scope, and surfaced to the user rather than buried** —
`defaultProjectKey()` returning a stale key, and the unbounded session load. That is the right call and
worth recording as such.

**What this says about the process, not the code:** every one of these was found by reading the live
store or driving a running core, and none by reading source. The suite was green throughout.

---

## §1 — The lead finding: the system reported successful tool calls as failures

Traced to the ground on the live store. `toolu_014Qf2s4T7p7CL877wQV81Gq` — this audit's own `Read` of the
plan file, which **succeeded**:

| Source | Record |
| --- | --- |
| `activity.jsonl` | `PreToolUse` at `20:15:41.534Z` |
| session store | reaped to `status:"failed"`, `endTime 20:31:11.856Z`, *"no completion event was received"* |
| `activity.jsonl` | **`PostToolUse` at `20:33:05.329Z` — the completion event did arrive** |

A ~15.5-minute reaper asserted failure and never reconciled. The defect was never the timeout: measured
across 1,184 paired calls, p50 **0s**, p90 **5s**, p99 **37s** — only 2 calls (0.17%) exceed the window.
The defect was that the code had two words available, `running` and `failed`, and both are false about a
call whose outcome is unknown.

**Three tests pinned the bug while their own names denied it** — all three passed:

| Test name | What it asserted |
| --- | --- |
| `"must be honest, not claim failure"` | `assert.equal(status, "failed")`, two lines below the name |
| `"marks failed with an honest reason"` | comment on the next line: *"not a claim that the call failed"* |
| `"nothing can still be running in a store we just loaded"` | true premise, concluded `"failed"` from it |

### How much of "failure" was not failure

The same 6,776 real records replayed through the pre-fix and post-fix bundles:

| | live core (pre-fix bundle) | replay through fixed bundle |
| --- | --- | --- |
| completed | 2947 | 2329 |
| **failed** | **50** | **21** |
| **unknown** | — (status did not exist) | **29** |

**29 of 50 reported failures — 58% — were the system misreporting.** The 21 that remain are genuine
`PostToolUseFailure` events.

**Fixed during the audit, and verified independently.** `ExecutionStatus` gained `unknown`; a late
completion now reconciles by exact `tool_use_id` and clears the reaper's now-false note. Verified at L4:

| Delivered | `tu_SELF` | `tu_OTHER` |
| --- | --- | --- |
| (after reap) | `unknown` + reaper note | `unknown` + reaper note |
| `tu_SELF`'s own late completion | **`completed`, error cleared** | untouched |
| a stranger's `tool_use_id` | `completed` | **untouched — no cross-pairing** |

The narrowing to exact-id-only is correct: widening the tool-name fallback would have re-introduced the
cross-pairing B2 exists to prevent.

### Two seams that remain open

- **`unknown` renders as neither running nor error.** `activity-items.js:233-234` tests only
  `status === "running"` and `status === "error" || status === "failed"`. The core's honest status is
  invisible in the view that displays it.
- **The whole `tool:*` event family has zero listeners.** Five names — `tool:started`, `tool:completed`,
  `tool:failed`, `tool:blocked`, `tool:unknown` — emitted from **8 call sites** in `session-manager.ts`.
  `grep -rn 'on("tool:' packages/core/src/` returns **nothing**. `core.ts` forwards `log:added`,
  `session:*`, `change:*`, `version:created`; there is no `tool:*` line. The half of the fix that
  corrected the emitted event changed an event nobody receives.

---

## §2 — M3's memory write had never succeeded, and could not have

`~/.inspector-hook/summaries/` empty, `snapshots/` empty, and **zero files carrying
`metadata.source: inspector-hook` across all 18 memory directories on this machine.** The feature had
never written anything. The stated reason was the `INSPECTOR_HOOK_SESSION_MEMORY` gate. That was not the
whole reason.

Two runs, identical except one `mkdir`:

    without <proj>/memory  ->  memory.error: ENOENT … /proj/memory/session-2026-09-04-mem-1.md.64300.tmp
    with    <proj>/memory  ->  memory.written: Wrote session memory to .../session-2026-09-04-mem-2.md

`native-memory.ts` contained **no `mkdir` anywhere**; `writeMemoryFile` opened a temp file in a directory
it never created. **13 of 31 project directories on this machine have no `memory/`** — and Claude Code
creates it lazily on its own first write, so the failing case was the *first write for a project*, which
is the entire feature.

**Why 152 memory tests missed it:** `memory-ipc.test.js:67` and `native-memory.test.js:47` both
`await mkdir(memoryDir, { recursive: true })` in setup.

So M3 item 1 was **inert *and* broken** — flipping the gate would not have delivered it. Fixed during the
audit (`1a5ab2a`) and re-verified independently at the new HEAD: with no directory pre-created,
`memory.written`.

**Method note, recorded because it nearly produced a false finding.** My first probe blamed a missing
transcript path — retention had collapsed the session before `SessionEnd` arrived. Only a clean re-run
without retention pressure found the real cause. Had I reported the first result, the fix would have
targeted transcript resolution and shipped the actual bug intact.

---

## §3 — M3's picker was a permanent no-op, and the first fix would not have closed it

    ipc-server.ts     return { digest, written: false }     <- envelope
    core-bridge.ts:519  passes the envelope through verbatim
    panel.ts:385        _sendMessage({ payload: digest })   <- `digest` here IS the envelope
    api.js:655          State.contextView.digest = payload  <- = {digest:{…}, written:false}
    context.js:398      if (digest?.sessionId) …            <- reads the ENVELOPE. undefined. always.
    memory-render.js:538/546  digest.worthKeeping / digest.text  <- same envelope. undefined.

Observable behaviour: click Preview → an empty grey box → click "Stage this" → nothing, forever. Live:
`pending-context.json` has never existed. The commit that shipped it says **"THE PICKER IS WIRED END TO
END."**

A fix adding `sessionId` to `SessionDigest` was in flight while this was being written. **It would have put
the field at `payload.digest.sessionId` while the webview reads `payload.sessionId`**, and touched no
`packages/vscode` file — the button would have stayed inert and the preview empty, while looking fixed.
Flagged to the author before it landed.

**Now fixed (`c9c520b`) and verified end to end at L4.** The unwrap was placed in `panel.ts`, which repairs
all three readers at once. Driven through a real core over JSON-RPC/stdio:

| | happy path | barren session |
| --- | --- | --- |
| `payload.sessionId` | `"pick-1"` | `"barren"` |
| `worthKeeping === false` | `false` (correctly) | **`true`** — the skip notice now renders |
| `body` | 476 chars | 0 chars, with `skipReason` present |
| stage result | `{staged:true}` | `{staged:false, reason:"no file changes and no tool executions"}` |
| `pending-context.json` | written | **not** written |

**The staged text is byte-identical to the previewed digest body.** `core-bridge.ts:487-491` claims "the
preview and the delivery cannot diverge" — that claim is now true and tested, where before it was
*vacuously* true because both halves were dead.

---

## §4 — A silent regression nobody noticed for the length of a branch

`5f6d917` ("one hook script, 9x faster") removed the `git -C` and `package.json` reads. The optimisation
was right — they were most of the per-event cost. **The fields went with them.** Measured on the live
corpus: **1,610 entries carry git metadata, all before `2026-09-03T13:59:01Z`; the 4,841 since carry
none.** Corroborated a second way: git-bearing entries have second-resolution timestamps from the old
`date` calls, everything after has milliseconds — the same cutover instant.

Blast radius, traced: `projectKey` is `gitRemote ?? cwd`, so **one repository fragmented into five keys**
in the live research index. Cross-project search and the per-project rollup both key on that field, so
M3's "where did I solve this before" was quietly answering the wrong question. Every digest lost its
branch line. Session-start chips never rendered. One session was named `giorgobg`, because
`extractProjectName` takes the last path segment and the session started in `$HOME`.

**Fixed during the audit** (`a66b43f`), and better than a revert: derived in-core from the `cwd` every
event already carries, cached per directory. Verified by replaying the real corpus — the five fragments
collapse to one key, `Zuzuna54/inspector-hook`.

**Two residuals.** It has **never processed a live event** (the running core predates it and
`dist/managers/project-resolver.js` does not exist) — L3, not L4. And `log-manager.ts:162-167` copies the
three fields but not `project.root`, while `projectKeyFor` is still `gitRemote ?? cwd`, so **a repo with
no origin remote still fragments per subdirectory**.

---

## §5 — The extension cannot be packaged, by construction

Three independent blockers:

1. `packages/vscode/package.json` declares `"name": "@inspector-hook/vscode"`. **Scoped names are illegal
   in a VS Code manifest** — `vsce ls` fails with `Invalid extension name`. No VSIX can be built at all.
2. `scripts.package` is `vsce package --no-dependencies`, `bundledDependencies` is empty, and there is
   **no `.vscodeignore`** — no `node_modules` ships.
3. `core-bridge.ts:167-181` `findCorePath()` returns
   `<extensionPath>/node_modules/@inspector-hook/core/dist/cli.js` whenever `extensionPath` is set, which
   is always in a real install. The workspace path is a dev-only fallback.

And `dependencies` are `workspace:*`, which cannot resolve outside the monorepo — so dropping
`--no-dependencies` would not fix it either. A packaged extension can never find its core. The matrix had
these rows as `untested`; they are `broken`.

---

## §6 — Documentation describes a different system than the one that exists

`docs/design/API_CONTRACTS.md` documents **59 IPC methods**. The core registers **55**. The sets overlap
by 39.

- **20 documented methods do not exist:** `analytics.get`, `core.initialize`, 14 `hooks.*`, 4 `rules.*` —
  with full request/response schemas, formatted identically to working methods.
- **16 registered methods are undocumented:** all 11 `memory.*`, all 3 `research.*`,
  `sessions.getSummaries`, `fileChanges.updateContent`. **The entire M3 and M4 IPC surface.**

The aggravating detail: the file *is* capable of marking things unbuilt. `API_CONTRACTS.md:2579` reads
**"Not implemented — and no longer planned in this form."** for WebSockets. The 20 carry no such banner,
so a reader cannot tell the real methods from the fictional ones.

Also confirmed: `packages/hooks/README.md` documents a bash library (`claude/lib/http-logger.sh`) and four
functions that exist nowhere in the repo, two hook scripts that were deleted, Python functions the file
does not define, an environment-variable table in which three of five variables are read by nothing, and
a manual-install JSON in the legacy flat schema that `install.sh:12-16` says "would simply never fire".

And `config/README.md:26-30` instructs the user to `cp config/claude-settings.json ~/.claude/settings.json`
— **the destructive full replace that `install.sh` was rewritten to prevent.** Following the repo's own
config README deletes the user's 19 foreign hook registrations.

---

## §6a — Archived diffs have never worked, for the entire live population

`file-tracker.ts:613-614`, inside `archiveResolvedChange`:

    this.archived.set(archived.id, archived);
    this.changes.delete(change.id);

Same id, **different map**. But the shipped path asks the wrong one — `fileChanges.getDiff` →
`file-tracker.ts:533` reads `this.changes`, so it returns `null` for an archived change by definition.

**It fails silently rather than erroring**, which is why it survived. `panel.ts:182` does
`payload: { ...diff, changeId }` — spreading `null` yields `{changeId}`, which is truthy, so the
diff-error branch never runs. `archived.js:525` accepts it, and `_renderDiffPreview` reads
`diff.additions || 0`, `diff.deletions || 0`, `(diff.hunks || [])`. **The user sees a well-formed
"+0 / −0" diff with no hunks and no error.**

Live proof, the entire population rather than a sample:

    archives: 155    changes: 28    ids in both: 0

**The correct method exists on both sides and is unreachable.** `archive.getDiff` →
`getArchivedDiff` reads `this.archived` and is correct; `CoreBridge.getArchivedDiff` exists. But
`grep -rn getArchivedDiff` returns exactly one line — the definition. **No `panel.ts` case dispatches to
it.** The working path was built and never connected.

The test passes because `archived-view.test.js:53-57` calls the handler directly with a populated diff,
bypassing the `getDiff` that returns null. Its header claims to regression-test that "the diff preview
could not appear by either route" — it fixed the *routing*; the *lookup* is still broken, one layer down.

---

## §6b — The Logs view's "virtual scrolling" is `slice(0, 100)`

`logs.js:273-275`:

    // Virtual scrolling: limit visible rows for performance
    const VISIBLE_ROWS = this._visibleRowCount;
    const visibleLogs = filteredLogs.slice(0, VISIBLE_ROWS);

Head truncation. Only the comment says virtualization. Every "Load More" rebuilds the entire table's
`innerHTML` and re-attaches a listener per row — the DOM grows monotonically, the opposite of
virtualization.

**Real virtualization exists — for a different view.** `history/virtual-scroll.js` (121 lines) is genuine
windowing with 19 honest tests. It loads via `HISTORY_LOAD_ORDER`. **The Logs view never loads it.** So
the matrix credits a Logs criterion with a suite that exercises History's module.

**And the affordance is unreachable anyway.** `api.js:68-71` hardcodes `pagination: { limit: 100 }`, so a
fetch yields exactly 100 and `hasMore = 100 > 100` is **false** — the Load More button does not render at
all on a fresh load.

**The visible consequence is two different numbers for one quantity on adjacent tabs.** `logs.getAll`
returns `{ logs, total }`; `total` is **never read anywhere in the webview**. The Logs toolbar shows the
*loaded* count, capped at 100. The Dashboard shows `stats.totalLogs`. Live: **the Logs tab reads
"100 logs" while the Dashboard reads 7,773**, and the smaller number is presented without qualification.

---

## §6c — Memory curation edits the wrong file and reports success

The Context view's Edit→Save. `curation.js:141` sends `name: file.name` — the frontmatter `name` — and
`native-memory.ts:447` derives the target path from `memoryFileName(name)` rather than from the file that
was opened.

Executed against a real memory file on this machine:

| | |
| --- | --- |
| Opened | `feedback_no_shortcuts.md` |
| Written | **`no-shortcuts-or-corner-cutting.md`** |
| Original | **unchanged** |
| `MEMORY.md` | now carries **two** index lines |
| Returned | **`written: true`** |

**A false success claim, in the module whose own header says it exists to prevent exactly that** —
`core.ts:434`: *"This is the part of the system most able to make a false claim ('saved to memory' when
nothing was written), so it reports what actually happened."* It reports what happened to a file the user
did not open. **6 of the 33 memory files on this machine have a `name` that does not match their
filename**, so this is not an edge case. Claude Code's own writer sets a descriptive `name:` independent
of the filename, which is why the mismatch is normal rather than rare.

**Fixed (`01a6ea1`) and verified at L4.** Reconstructed the exact real-corpus case — a file named
`feedback_no_shortcuts.md` whose frontmatter `name` is `no-shortcuts-or-corner-cutting` — and saved an
edit through `memory.write`:

    opened file contains the edit : YES
    opened file still original    : no
    files in the directory        : MEMORY.md, feedback_no_shortcuts.md   (no stray second file)
    MEMORY.md index lines         : 1                                     (was 2)

---

## §6d — `defaultProjectKey()` returns the stale key on real data, permanently

The field whose entire purpose is telling a UI which project to scope to. On a fresh store it resolves
correctly to `Zuzuna54/inspector-hook`. Evaluated against the **actual** live index, it returns
**`inspector-hook`** — the pre-M2 bare-name key — because it returns the first item in insertion order
whose `projectName` suffix-matches the workspace, and the 91 legacy items load first.

That key spans `2026-09-03T11:49` → `13:58` only. **A project-scoped search on it silently excludes all
319 newer items** — and an empty or short result looks exactly like "nothing matched", which
`research-index.ts` itself names as the failure mode hardest to notice.

**It will not self-correct.** 410 items against a 5,000 cap, with `trim()` the only eviction path, so the
legacy items never age out. And `a66b43f` does not reunify the existing index — the new `owner/repo` key
does not match the legacy bare name, so **one repository goes from five keys to six on the first restart**.

---

## §6e — The connection indicator is hardcoded

`webview-html.ts:154-155` ships `<span class="status-indicator connected">` and the literal text
**"Connected"**. Nothing in `media/` or `src/` ever reads either element id, and
`.status-indicator.disconnected` exists in two stylesheets with **no code path that adds the class**.
**The panel reads "Connected" even when the core is dead.**


---

## §7 — The inert register

Features that exist, are often tested, and cannot run. This is the real backlog: **the matrix has no
column for it, which is why none of these appear as defects there.** Rows marked **[closed]** were fixed
during the audit and re-verified; they are kept in the register because the register's purpose is to show
how much of a green suite can sit over unreachable code.

| # | Feature | Why it cannot run | Tests passing over it |
| --- | --- | --- | --- |
| 1 | **All M4 retrieval** — `research.search/get/getStats` | Zero callers; `grep -ri research packages/vscode/` returns nothing; no research view exists. The core indexes and flushes on every log, so the data accumulates unreachable | **`research.test.js` — 41 tests** |
| 2 | **M3 auto-digest** | **[partly closed]** The `ENOENT` beneath the gate is fixed, so the code now works when reached. Still gated by `INSPECTOR_HOOK_SESSION_MEMORY`, which nothing in the extension sets and no setting exposes — reachable only by exporting the var before launching VS Code, undocumented | 152 memory tests |
| 3 | ~~**"Stage this" + digest preview**~~ | **[closed]** `d2ae369` — envelope unwrapped in `panel.ts`; verified L4, staged text byte-identical to the preview | `context-view.test.js:471/:477/:486`, now regenerated from the real builders |
| 4 | **The entire `tool:*` event family** | 5 names, 8 emit sites, **zero listeners**. `tool:unknown` was born inert | — |
| 5 | **History's lazy version-content stack** | `requestVersionContent`, `isVersionContentLoaded`, `isVersionContentLoading`, `_getUniqueFiles` each defined once, called nowhere. `API.getVersionContent`'s only call site is *inside* `requestVersionContent` | **8 tests**, incl. `archived-view.test.js:140` |
| 6 | **`renderIndex` / `renderIndexBudget`** | Transitively dead — `renderIndexBudget`'s only caller is inside `renderIndex`, which has no caller. `MEMORY.md` is never displayed | **5 tests** |
| 7 | **Memory-file provenance line** | Reads `originSessionId` / `rawFrontmatter`; **neither exists outside the webview** — core and protocol produce neither | **3 tests**, fixture invents the field |
| 8 | **~25 hook scripts under `config/claude-hooks/`** | security-gate, quality (biome/ruff/type-check/rust/ai-review/commit-gate/test-guard), notification, state-backup, subagent-coordinator — all written and committed; `install.sh` installs **none**. Matrix called these `not-impl`; they are `inert` | — |
| 9 | **`packages/protocol/src/hooks.ts`** | 412 lines, 30 types, zero consumers — and stale, declaring 10 events where 30 are registered | — |
| 10 | **`packages/hooks/claude/lib/http_logger.py`** | Zero callers by every route. The apparent importers resolve a *different* file: md5 `3b9e4f91…` (packaged) vs `f307459c…` (the one actually loaded) | — |
| 11 | **`sessions.getStats`** (carries the `logCount`/`warnings` fix) | No `CoreBridge` caller, no `panel.ts` case | — |
| 12 | **`sessions.getSummaries`** — the read half of retention tiering | No caller | — |
| 13 | **`inspectorHook.logRetentionDays`** | Declared in `package.json`, never read by `extension.ts`, never passed. **This is B5 exactly**, and `config-plumbing.test.js` — written to prevent it — checks only `httpPort` | — |
| 14 | **`CoreBridgeOptions.storagePath`** | Computed at `extension.ts:27`, never read, absent from the spawn env | — |
| 15 | **`keepHunk` / `revertHunk`** | Present in `api.js` and `panel.ts`; no core implementation, and `panel.ts` discards `hunkIndex`. The plan claims per-hunk keep/revert end to end | — |
| 16 | **Digest "What was asked"** | `prompts` never supplied by any of the four call sites | — |
| 17 | **Zero-consumer protocol exports** | `automation.ts` (14 types incl. an undocumented `AnalyticsSummary`), `INDEX_LOAD_LINES`/`BYTES`, `RESEARCH_KINDS`, `MemoryProject.workspacePath`, + 9 more | — |
| 18 | **`project-resolver`** | Correct and unit-tested, but the running core predates it and `dist/managers/project-resolver.js` does not exist — it has never processed a real event | 10 tests |

Two more, added by later units and not in the original count: **`media/styles/main.css`** — 548 lines, the
largest stylesheet in the project, absent from the asset manifest, no `@import`, zero references, and it
reads like the entry point while redefining the same theme variables `variables.css` sets; and the
**archived-diff path** (§6a), where the working method exists on both sides and no `panel.ts` case reaches
it.

Plus **17 further core IPC methods with no extension caller** (`archive.*`, `fileChanges.*`, `history.*`,
`memory.getFile`, `memory.getProject`, `sessions.terminate`, `core.getStatus`, …). Of 55 registered
methods, **17 are dispatch-tested**; 38 are not.

---

## §8 — What the test suite can and cannot falsify

**777 tests measured** (499 core + 278 webview) — the matrix cites 483 + 278, measured seven commits
back. Every count in that document should carry a commit stamp; the suite currently moves ~6 tests per
commit.

**The suite is stronger in the middle than expected and weaker at three seams.** The webview harness
`eval`s the real shipped scripts, so most webview tests do execute production code. Genuinely strong:
core tests run against `dist/`; `ipc-server`, `port-claim` and `hooks` tests **spawn real processes**;
`ingest` and `regressions` bind **real HTTP ports**; `persistence.test.js:281` was verified by
**counterfactual** — reverting the path-traversal fix in a scratch build made the test fail *and* let a
file escape to `/var/folders/.../evil`. That is what "verified" should mean.

**94 tests are L1 source-text assertions** — 86 of 278 webview (31% of that suite) plus 8 core. They pass
or fail on a regex over a file's contents and cannot prove a feature runs.

**Tier-1 rewrite-or-delete — each currently cited as evidence for something untrue:**

1. `archived-view.test.js:140` — name asserts a call no code makes.
2. `context-view.test.js:471/:477/:486` — certify a preview that renders empty and a button that does nothing.
3. `history-view.test.js:111/:118/:124/:131/:138` — cover an unreachable stack.
4. `stylesheets.test.js` (all 35) — **the shipped asset manifest is validated by nothing.** These 35 tests validate a hand-maintained copy of it *inside the test file*. A five-line `existsSync` loop over the real manifest would have caught both dangling entries; 35 tests checking a copy caught neither.
5. `module-split.test.js:115` — asserts `SESSIONS_LOAD_ORDER`, a constant `harness.js` owns, never compared to `webview-html.ts`. Cannot fail whatever production does. And `existing()` (`harness.js:63`) silently drops absent entries, turning a deleted module into a quiet skip.
6. `hardening.test.js:65` — named "removes expired entries from disk, not just memory", but `load()` re-runs `enforceRetention()` in memory, so the assertion holds whether or not anything was pruned from disk.

**Coverage holes:** `packages/protocol` has **no test script at all**. `packages/vscode`'s `test` does not
build first (core's does). **`pnpm lint` is a no-op** — no package defines `lint`, no Biome config exists,
despite `// biome-ignore` comments. **There is no CI** — `.github/workflows` does not exist, so nothing
has ever run on Linux and "kept green in CI" is not a true framing anywhere.

**Never loaded by any test:** `main.js` (552 lines), `router.js`, `state.js`, `views/logs.js` (517),
`views/dashboard.js`, `src/commands.ts`. And `panel.ts`, `core-bridge.ts`, `extension.ts` are only
regex-matched as text. **The push path that delivers every live log to the UI has zero coverage** —
`grep -rl sendNotification packages/*/test` returns nothing.

---


## §9 — The 268 rows, re-derived

Every row independently re-derived under R1/R2. The five buckets sum to 268 in both columns.

| Phase | rows | verified | broken | inert | not-impl | untested | changed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 Foundation | 37 | 33 | 1 | 1 | 0 | 2 | 3 |
| 1 Walking Skeleton | 39 | 29 | 1 | 0 | 1 | 8 | 6 |
| 2 Core Features | 40 | 32 | 1 | 1 | 2 | 4 | 6 |
| 3 UI Development | 38 | **11** | 4 | 1 | 1 | **21** | ~24 |
| 4 Hooks Integration | 33 | 11 | 2 | 6 | 12 | 2 | 8 |
| 5 Advanced Features | 34 | 0 | 3 | 0 | 31 | 0 | 0 |
| 6 Production | 47 | **11** | **20** | 0 | 8 | 8 | 21 |
| **Total** | **268** | **127** | **32** | **9** | **55** | **45** | **~68** |

Against the matrix's own totals:

| | matrix | re-audited | delta |
| --- | ---: | ---: | ---: |
| verified | 168 | **127** | **−41** |
| broken | 17 | **32** | **+15** |
| inert | — (no such column) | **9** | +9 |
| not-impl | 55 | 55 | 0 |
| untested | 28 | **45** | **+17** |

**Roughly a quarter of the `verified` rows did not survive re-derivation.** `not-impl` is unchanged at 55,
which is worth saying plainly: the matrix was accurate about what had not been built. It was inaccurate
about what worked.

Two phases carry most of it. **Phase 3 fell from 31 verified to 11** — because no test executes
`panel.ts`, `main.js`, `router.js`, `state.js`, `logs.js` or `dashboard.js` (1,665 lines, and `logs.js`
and `dashboard.js` are the Logs view and the default landing view), so most UI rows rested on a code read.
**Phase 6 went from 9 broken to 20** — packaging, performance and the security rows below.

### The matrix's evidence, and how it fails differently per phase

**Phases 0–1: 9 of 76 rows (11.8%)** carry evidence that does not correspond to the criterion. Four are
**pasted from a different row** — "Create media directory structure" cites "`packages` exists"; two rows
cite a `node_modules/@inspector-hook/protocol` path **that does not exist**; a process-lifecycle row cites
the B5 env test, which contains nothing about lifecycle. Five cite a real artifact that does not establish
the claim — "Handle POST /log" cites tests in which `grep -c '/api/log'` is **0**, and `/api/log` is the
route the shipped e2e script posts to.

**Phase 6: 8 rows / 9 instances, and a different failure mode entirely** — no pasted evidence, no
non-existent paths, but **numbers and artifacts asserted without a run behind them**:

- `Implement rate limiting` cites "429 + **`Retry-After`**". **`Retry-After` exists nowhere in the repo**,
  and no test asserts a 429 over HTTP.
- `Add path sanitization` cites "SECURITY tests" plural — **one is a false guard.**
  `persistence.test.js:298-306` passes against *reverted* code, because it asserts on
  `join(basePath, "..", "evil")` while the real traversal escapes **two** levels. (The other cited test is
  genuine — it was proved by counterfactual.)
- `Optimize hot paths` / `Profile and fix bottlenecks` cite "502× write amplification removed; hook
  337 ms → 37 ms". **No benchmark script, test, or recorded run exists anywhere in the repo.**
- Two rows cite "533 ms" for core start. It appears **only as prose**, four times, with nothing behind it.
- `All tests passing` cites 483 core (measured 499); `Full regression test` cites 757 assertions
  (measured 777).
- `Implement memory management` cites the caps — and omits that `session-manager.ts:121-127` **loads every
  session unbounded**, which is what puts the live process at ~900 MB.

The two failure modes are worth distinguishing, because they need different remedies: Phases 0–1 were
filled in without checking *what the evidence was evidence for*; Phase 6 was filled in with **measurements
nobody re-ran**.

### The 533 ms figure, measured twice

Two units measured independently, spawning the shipped `dist/cli.js` and timing to the `{"type":"ready"}`
line, against a scratch copy of the store:

| store | unit A median | unit B median |
| --- | ---: | ---: |
| empty | 133 ms | 120.3 ms |
| copy of the real ~66 MB store | 1586 ms | 1523.0 ms |

Both ranges overlap; the differences are host noise on a cold `node` spawn. **The recorded 533 ms is
roughly 3× low**, and the shape matters more than the miss: ~120 ms empty against ~1,520 ms loaded means
the cost is store loading, not process startup. **It degrades as the user accumulates history**, and it
shares a root cause with the memory figure.


---

## §9a — The M3/M4 matrix that did not exist

`AUDIT-MATRIX.md` has 268 rows for Phases 0–6 and **zero for M3 or M4** — its five "memory" lines are
Phase rows about the in-memory log buffer. So the two milestones where the damage is concentrated had no
resolvable criteria at all. **84 were written and audited for this report.**

| | verified | broken | inert | not-impl |
| --- | ---: | ---: | ---: | ---: |
| **M3 — session context** | 24 | 8 | 5 | 3 |
| **M4 — research + RAG** | 20 | 7 | 5 | 4 |

Nothing is `verified` on L0/L1 alone.

**M3's shape:** the machinery is built and the last mile is broken in three independent places. Driven by
hand, every layer works — the digest builder produces accurate branch-bearing text, the reader/writer
honours authorship and upserts `MEMORY.md` non-destructively, and the picker's stage → hook →
one-shot-delete round trip runs end to end against the real registered `SessionStart` script. What fails
is everything a user would touch: the automatic write has never run once, curation's Edit/Save writes to
the wrong file, and the "cross-project search" is whole-phrase substring matching — `"quick fox"` returns
1 hit and `"fox quick"` returns **0**, with no score field anywhere.

**M4's shape:** capture and storage are real and durable; retrieval is a library with no reader. The
milestone's central durability claim was tested rather than assumed — every log file was deleted and the
core restarted, and search still returned 5 of 5 items with displayable titles. But reaching a single
result out of 410 indexed items and 6,239 terms requires hand-writing a JSON-RPC frame into the core's
stdin. The gap is **three links wide** in each case — no `CoreBridge` method, no `panel.ts` case, no
`api.js` method — so this is not a view that was nearly finished.

---

## §9b — Claims that exceed what the code delivers

Collected verbatim, because in this project the comments are unusually good and that makes the false ones
unusually costly:

| Location | The claim | Reality |
| --- | --- | --- |
| `core.ts:150-152` | *"record what happened into Claude Code's own memory, so the next session loads it with no injection hook of ours involved"* | Never happened once; and at the pin the first write for any project `ENOENT`'d |
| `curation.js:132-135` | *"`userInitiated` is what allows editing a note the tool did not author"* | It authorises the write; the write lands on a path derived from frontmatter, not the file being edited |
| `memory-render.js:526-529` | *"Preview is the whole feature: what is staged is the text shown here, so nothing can be injected that was not read first"* | Literally true only because both halves are dead — nothing is shown and nothing can be staged |
| `ipc-server.ts:663-666` | *"The corpus is far too large to preload into a session, so it lives behind a query"* | There is no caller of that query |
| `protocol/src/hooks.ts:14-16` | *"All Claude Code hook event types"* | Lists **10**; 30 are registered. And `HOOK_EVENT_DESCRIPTIONS` is `Record<HookEvent, string>`, so the stale type is load-bearing against its own repair |
| `logs.js:273` | *"Virtual scrolling: limit visible rows for performance"* | `slice(0, 100)` |
| `README.md:477` | *"If port 52376 is in use, the core will fail to start"* | It scans upward for a free port |
| `ARCHITECTURE.md:507` | *"Version history — 100 per file"* | Default is 50 |
| `ARCHITECTURE.md:82-83` | Lists "Rules Engine" and "Staging Manager" as core components | Neither class, file, nor IPC surface exists |
| `README.md:485` | *"Verify hooks are installed: `ls ~/.claude/*.sh`"* | The installer copies nothing there; it writes absolute repo paths into `settings.json` |

The counter-example worth crediting: `bm25.ts:6-15` states plainly that the semantic half is deliberately
staged rather than omitted, and `protocol/src/research.ts:50-54` was corrected mid-audit to describe the
new inference mechanism accurately. The same false sentence still stands two doors down at
`extract.ts:49-51`, directly above the function that consumes it.

---

## §9c — Dead code, ranked by whether it misleads

The useful distinction is not dead vs. alive but **whether a reader who trusts it forms a false belief**:

- **Actively misleading:** `protocol/src/hooks.ts` (see above — and `packages/protocol` has no `test`
  script, so nothing would ever catch it; a second wrapper importing it would switch exhaustively on
  `HookEvent` and silently drop 20 of 30 event types, with TypeScript calling the switch exhaustive).
  `packages/hooks/claude/lib/http_logger.py` — two matrix rows are marked `verified` on the evidence
  "140 lines", and the apparent importers resolve a *different* file (md5 `3b9e4f91…` vs `f307459c…`).
  And **`media/styles/main.css`, 548 lines, loaded by nothing** — not in the manifest, no `@import`, zero
  references; it is the largest CSS file in the project, reads like the entry point, and redefines the
  same theme variables `variables.css` sets. Anyone editing theme colours will edit it, see nothing
  happen, and get no error.
- **Dead but honestly labelled:** `protocol/src/automation.ts` — equally unconsumed, but the matrix says
  so in as many words. Same deadness, opposite honesty. That contrast is the finding.

So the shipped asset manifest is wrong **in both directions**: two entries name files that were never
committed, and one shipped stylesheet is omitted from it. Three of 64, and nothing validates it.


---

## §10 — Verified good

An audit that only finds fault is not measuring. Confirmed, several at L4:

- **B1–B4 are correctly fixed *in the shipped bundle*, not just in `src`.** Exactly one call site each for
  `captureBeforeContent`/`trackFromLog` in `dist/cli.js`; **185 of 185** PostToolUse entries carry native
  `toolu_` ids, with interleaved parallel Bash calls pairing correctly; 155 of 155 archives carry
  `resolution`; only `SessionEnd` ends a session.
- **`install.sh` is genuinely additive.** Verified live: four foreign hooks survive alongside ours in
  `PreToolUse`. `uninstall.sh` filters by exact command, with a comment explaining why `contains` would
  delete another tool's hook. Refuses to touch a non-JSON settings file (verified by spawning it).
- **Security holds under live probing.** CORS: 403 with `Origin`, 200 without. **Redaction runs on the
  ingest path** — a planted fake `sk-ant-api03-…` key and `ghp_…` token produced **0 occurrences** in the
  store, written as `[redacted]`. Path traversal contained: `../../../../tmp/ESCAPED` landed inside the
  store as `________________tmp__ESCAPED.json`.
- **Retention collapse-before-prune works** — forced it with a 1-day retention and a 5-day-old log:
  `summaries/<id>.json` written with the digest embedded *before* the delete. **This path had never
  executed in production**; the live store is younger than its 7-day window.
- **Sessions do close without `SessionEnd`** — active→idle at 30 min, idle→completed at 2 h, swept every
  60 s. Two ticks required. Verified live.
- **M4 ingest is real** — all seven capture paths reachable and running, 346+ items across 7 kinds.
- **BM25 is correct and honest.** Hand-rolled Okapi with proper idf, `K1=1.2`, `B=0.75`, stable tie-break,
  and comments that state plainly the embedding half is deliberately not shipped. **Nothing claims to be
  semantic that is not** — the one place code and documentation agree exactly.
- **Hook delivery is fast** — 36.8 ms median script execution, 57.1 ms end-to-end. Under the 100 ms target
  on both readings.
- **Persistence reload: 268 ms** for 187 documents / 31 MB, against a 2 s target.
- **Phase 5 is honestly reported** — 0 verified / 3 broken / 31 not-impl, and nothing is over-claimed. The
  three `broken` rows have literally zero consumers, confirmed.

---

## §11 — Performance, measured

| Target | Measured | Verdict |
| --- | --- | --- |
| Core start < 500 ms | **1523–1586 ms** against the real store; 120–133 ms empty (two units, independently) | **miss, ~3x** — recorded 533 ms is ~3x low and has no run behind it |
| Hook delivery < 100 ms | 36.8 ms script / 57.1 ms end-to-end | **meet** |
| Memory < 200 MB | **939 MB RSS**; post-GC floor rose 623 → ~931 MB over 10 min, peaks to 1.22 GB. Root cause identified: `session-manager.ts:121-127` loads **every session unbounded** | **miss, ~4.7x** |
| Build < 5 s | 2.08 s slowest package | **meet** |
| Webview update < 1 s | not measurable without the rendered UI | unknown |
| Zero leaks over 1 h | floor +308 MB over 10 min, then plateau | unknown, not encouraging |

The start-time miss and the memory figure very likely share a root cause — both scale with how much of the
store is held in memory — which means **the start-time miss degrades as the user accumulates history.**

---

## §12 — Method

Three rules, each earned by a specific failure.

**R1 — the evidence ladder.** Every row carries a status *and* an evidence class. **No row may be
`verified` on L0 or L1 alone.**

| | Class | Proves |
| --- | --- | --- |
| L0 | code read | nothing |
| L1 | source-text regex assertion | nothing |
| L2 | unit test over real behaviour | the unit |
| L3 | spawned-process / real-HTTP test | the integration |
| L4 | observed in the live store, live API, or rendered UI | the feature |

**One rubric correction, argued by an audit unit and adopted.** For a criterion whose entire content is a
static artifact — "Create the `packages/protocol` directory" — filesystem observation *is* complete proof,
and is classed **L4, not L0**. Mechanically downgrading those would be false reporting in the other
direction, which is precisely the failure this audit exists to catch. The strict rule applies only to
criteria making a behavioural claim.

**R2 — reachability is a separate column, and it gates `verified`.** `inert` is a status distinct from
`broken`: the code exists, may be tested, and cannot execute. §7 is what that column found.

**R3 — two independent derivations for any finding that changes a status.** Different mechanism, not a
second look.

**Live-store-first.** Given a choice between more source reading and more live-store reading, take the
live store. Every finding in §1–§5 came from a running system.

### The fixture

An isolated core (`INSPECTOR_HOOK_STORAGE` + `INSPECTOR_HOOK_PORT_FILE` + `HTTP_PORT=0`) replaying the
**real captured corpus** — 6,776 records from `~/.inspector-hook/logs/` — rather than
`scripts/seed-data.sh`, because **`seed-data.sh:19` drives `config/claude-hooks/logging/hook-inspector.sh`,
the legacy hook, not the one the installer registers.** Seeded data has never exercised the production
payload shape.

**Determinism verified:** two fresh cores, the same frozen 2,000-record slice (`sha1 2f86ea3f…`),
independently produced identical `totalLogs 2019 / errors 5 / sessions 6 / execs 928`.

**Limitation, stated plainly:** replay cannot reproduce file-change tracking — `captureBeforeContent`
reads live disk, so replayed edit events yield `changes: 0`. The fixture proves session, log, execution
and research behaviour; not the file-tracking path.

The live core and the user's real store were never written to.

---

## §13 — Corrections to this audit's own claims

Recorded because the audit's subject is untrue reporting, and it would be incoherent to hide its own.

**Retracted:** "three sessions are falsely `active`" — two had `lastActivityTime` inside three minutes and
were live peer sessions. I read `startTime` and inferred.

**Corrected:** "`warn`/`blocked` may be dead UI" — probing directly gives `{"warnings":1,"blocked":1}`.
The core counts them correctly. The accurate finding is narrower and better: *the counters work, the hook
logic works, and the join between them is a field-name mismatch with the real payload* —
`details.toolError` is non-null in 0 of 6,463 entries; 2,442 of 2,442 object-shaped `tool_result`s have no
`.error` key; all 72 live Notifications carry `notification_type`, never `level`. Twenty-six of them are
`permission_prompt`, the semantically intended source, classified `info` because the rule reads a field
that isn't there. **Dead wiring, not dead code.**

**My briefs to the audit units contained four errors**, all caught and corrected by the units:
- "~31 source-text tests" — the real figure is **94**.
- "all 12 in `stylesheets.test.js`" — **35**, and the discrepancy was between my brief and reality, *not*
  between the matrix and reality. The matrix cites only suite totals and never per-file counts; the audit
  must not accuse it of an error it did not make.
- "`context-view.test.js:281/:288/:293` assert against the test's own stub" — **wrong**. `sent` is a spy
  the *production* method fills; if `addToIndex` dispatched nothing the assertion would fail. Only `:301`
  is weak. My brief would have discredited a real test.
- "the `config/claude-hooks` family is dead by port" — partly wrong. `hook-inspector.sh` targets the
  *correct* port file and is dead by **registration**. And `tool-logger.sh` is not a no-op: it has written
  `~/.claude/logs/tools.jsonl`, **33.6 MB / 353,716 lines that nothing reads**, twice per tool call.

**Miscounted:** I reported the `tool:*` family as "six names from 17 emit sites". A unit recounted: **five
names from eight call sites** — 17 was lines *mentioning* `tool:`, including the five interface
declarations, two comments, and the three ternary branches of a single `emit()`. The finding stands; my
arithmetic did not.

**A stale open-items list, asserted as fresh.** I sent both owning sessions a "complete inventory,
re-derived against HEAD so nothing is stale". For the code items that was true — I spot-checked each. For
the **documentation** items it was not: I carried them from a unit's report written five commits earlier
and did not re-check them. **Five were already fixed**, including one I counted by `grep`ing for the
string `Rules Engine` without reading the line, which now reads `~~Rules Engine~~ | **Not implemented.**`
— the correction I was asking for, already made. The peer caught it. This is the report's own subject
matter committed by its author: a claim about current state, sounding authoritative, not re-derived.

**And a rule that follows from it, which the peer articulated better than I would have.** Fixing one of my
findings, they wrote "No such cap exists" where the real value was 200 — a false correction inside a
correction, caught in thirty seconds by their own justifying grep. Both the original claim and the fix
were unverified assertions about the same line. The rule is therefore not *check before you claim* but
**check before you correct**, because a correction reads as authoritative in a way the original did not.

**Four measurement artifacts of my own**, each caught by re-deriving: a `grep` that matched its own
command text in the log; a `jq` path that silently returned `none` for 198 records; a `pgrep` reporting
zero processes when four were alive; and a determinism check whose two replays read a corpus that grew
between them, making the comparison invalid by construction.

That is the case for R3 in a sentence: **eleven of this report's inputs were wrong on first derivation** —
and one audit unit corrected its own tally from 15 broken to 20 by recounting rather than trusting its
first pass. Every one was caught by a second derivation, none by review.

---

## §14 — What this audit could not determine

- **Whether the 11 never-fired events are handled correctly.** Their test fixtures are authored guesses at
  the payload *key names*, not just the values — a test built on a guessed key name passes whatever Claude
  Code actually sends. Unfalsifiable from this corpus. `untested` is the honest status.
- **Anything requiring the rendered UI.** No test executes `panel.ts`, `main.js`, `router.js`, `state.js`,
  `logs.js` or `dashboard.js`, and an extension host cannot be driven from `node --test`. Those rows are
  L4-manual and must be recorded as manual results with a date, not silently upgraded.
- **Webview update latency**, and **zero-leaks-over-one-hour** — only a 10-minute window was sampled.
- **Fresh-`$HOME` install behaviour** — the installer was verified against an existing settings file.
- **Total per-tool-call hook cost.** Our hook's 36.8–40.7 ms is measured; the other registered
  PostToolUse hooks were deliberately not executed, since they write outside the project.
- **Linux.** macOS 25.6 only, and there is no CI.

---

## §15 — The three things worth carrying forward

1. **Reachability is not a nice-to-have column.** Every serious finding in this report is a reachability
   failure, and the 268-row matrix — internally consistent, honestly totalled, and written in good faith —
   could not see a single one of them, because it has no such column. A green suite plus a consistent
   matrix produced a system where ~20 features cannot run.

2. **Ask of every test: does the setup manufacture a precondition production never manufactures?** Three
   instances today. The payload variant is the least visible, because a fixture matching the *inner* type
   still typechecks. A companion question catches the same class from the other side: **is there a
   first-run case, and does any test exercise it?** Both the `mkdir` bug and the reconciliation bug were
   specifically the *first* time through — the first write for a project, the first completion after a
   reap. Steady-state fixtures never reach either.

3. **A test can assert the opposite of what its own name says, and nothing will notice.** Three did.
   Reading the live store found in one pass what 777 green tests did not.

---

*Report-only. No source file was modified by this audit. Findings were routed to the sessions owning each
lane as they were confirmed; several were fixed mid-audit and are recorded above as verified at their new
state, with the state they were broken in preserved.*


---
---

# Current Audit — Milestones 3, 4 and 5

**Pins:** `7aa9f10` → `952eddb` → `e125cf1`. The branch moved three times during this pass; every finding
names the state it was measured in. **Scope:** M3, M4, M5 only — M0–M2 were excluded as working.
Three units, all findings derived twice, everything below either measured live or executed.

## Verdict

| | Status |
| --- | --- |
| **M3 Context** | **Substantially working.** Three of four prior defects genuinely closed and verified by execution. One real defect remains: the retention-collapse digest. |
| **M4 Research** | **Reachable at last, and now shipping embeddings that work — with three untrue claims attached and one serious regression.** Capture, the tool's one non-negotiable job, is broken by the new feature. |
| **M5 Agents** | **Capture is built and live; rendering is not.** The agent's output is captured on 390 of 390 events and discarded, because the code reads a key that has never existed. |

## M3 — fixed, and verified against my own original failing cases

`801ceed` closed two defects and I re-ran the exact cases that failed before:

    truncateToBytes, 1000-byte input        was      now
      maxBytes = 0                          1000  ->    0
      maxBytes = 5                          1005  ->    5
      maxBytes = -1                          999  ->    0

The tray now renders **exactly 262,144 bytes** across every shape tested — 12×60 KB, 500×60 KB,
1×300 KB — where it previously rendered **682,232**. And the test that pinned the bug is genuinely
inverted: `context-tray.test.js:300,330` now assert `preview.bytes <= CAP` across three shapes, where the
old test asserted only `.some(truncated)`.

The **`MEMORY.md` index-prose rewrite** is fixed and, importantly, *not over-corrected*: verified across
three variants including a line with no prose at all, while an explicit title still updates and an
unindexed file still gets a line. One small divergence survives — `native-memory.ts:641` names a new index
line from the fileName stem while `indexMemoryFile:703` uses `parsed.name`, so the same file gets a
different title depending which path created it.

### The one M3 defect that remains

**The retention-collapse digest is still the weakest of the three, and it is not being worked on.** I
checked whether the `log-manager.ts` edit in the working tree was a fix — it was an unrelated `projectRoot`
change. The ordering stands: `:364` filters `this.logs`, `:374` calls `cleanup({collapseSession})`, and
`getLogs` reads only `this.logs`. Reproduced with the real managers:

| | preview | collapsed summary |
| --- | --- | --- |
| size | 640 B | 411 B |
| "What was asked" | present | **absent** |
| "What was concluded" | present | **absent** |
| `Log entries` / `Errors logged` / `Warnings logged` | 7 / 1 / 1 | **omitted entirely** |

The fact lines are **omitted rather than reported as zero**, so nothing in the surviving record indicates
it was built from an emptied log. A digest silent about its own incompleteness is the priority bug class.
`retention-tiering.test.js:56-172` cannot catch it — it drives `store.cleanup` with a **stub**
`collapseSession` and never inspects digest content. The test bypasses the bug.

### The composer (P5/P6) — the best-built thing in M3, with one serious defect

**Preview matches delivery, proven byte-for-byte** — the first time this project's central tray claim has
been demonstrated rather than asserted. `context.preview` and `context.arm` both call the single
`renderTray`, and the UI sends no text, so the core re-renders from the tray it holds:
`preview.text === JSON.parse(armed).text`, **17,056 B on both sides**, and 262,144 B on both sides in the
cap cases. Redaction runs inside that same renderer, so a composed item containing an AWS key and a
`ghp_…` token previewed as `[redacted]` ×2 and **the armed file on disk contained neither**.

**The caps compose correctly, with honest arithmetic.** 8 KB per entry cuts visibly (`_(truncated)_`)
rather than dropping; the 64 KB per-item refusal reads *"That item is 96 KB, over the 64 KB per-item
limit. Trim it, or add the part you need."* — a real number and an action.

**`compose.test.js` is the good pattern** — real JSONL on disk, the real reader and composer, ten tests
over ordering, de-duplication, unresolved indexes, the clip and the empty-entry marker. Worth naming as
the standard against the fixture-driven tests elsewhere in the repo.

**Four defects, the first of which outranks the retention digest:**

1. **It composes the wrong session's turns, silently.** `session-detail.js:143-152` rebuilds
   `transcriptView` on a session switch with `sessionId`, `entries`, `total`, `hasMore`, `stats` and
   `reason` — **`selected` is not in the list**, so it survives the spread. Tick turns 3 and 7 in session
   A, switch to B: the bar still reads "2 turns selected", B's rows render pre-ticked, and Add sends
   `{sessionId: "B", indexes: [3,7]}`. This is not a display bug — the composed item is armed and injected
   into a model as context the framing line asserts was *"chosen explicitly by the user for this
   session."* Untrue reporting with a downstream consumer that cannot check it. It is precisely the class
   `compose.ts:9-16` claims to defend against.
2. **Partial failure looks like success.** `ipc-server.ts:1387` deliberately returns
   `reason: "1 of 2 selected turns are no longer in the transcript."` on `ok:true`, with a comment saying
   a partly-failed selection "should not look like one that succeeded". `inbound-tray.js:16` branches on
   `ok === false`, so the reason is dropped and nothing else carries it. Worse: a compaction that leaves
   the index *in range* returns different content with **no signal at all** — index 0 returned a
   completely different conversation. `TranscriptEntry` carries a `uuid`; the composer discards it.
3. **Titles.** `composeTitle` — which handles the plural and uses the first prompt — is imported at
   `ipc-server.ts:41` and **called zero times**; `:1431` uses an inline string instead. Every composed
   item is titled "**1 turns from a session**". The documented behaviour reaches no user, and three tests
   cover the function nothing calls.

### The injection subsystem — still open, with three corrections to earlier findings

**The one-shot is not one-shot, and it is worse than first measured.** Eight concurrent invocations of the
real hook: **6–8 deliveries on every trial, 10 of 10**. `cat` then `rm` (`:85-86`) is not atomic; `mv` to a
unique name is the fix. And a **failed `rm` replays forever** — directory `chmod 555`, five sequential
prompts, delivered **5 of 5** with the file present after each, because `rm -f … || true` swallows the
failure. Bounded only by the 1 h TTL.

**Arming still renders `""`.** Three different shapes arrive on one `context-armed` message — arm returns
`{armed,entry,path}`, getArmed returns `{now,pinned}`, disarm returns `{cleared}` — and `renderArmed`
(`tray-render.js:227`) reads `.now`/`.pinned`, so the real arm result renders empty. `tray-host.js:235`
never refetches.

**Three corrections to what this audit previously reported:**

| Earlier claim | Corrected |
| --- | --- |
| Payloads >~512 KB vanish silently | The cliff is **~1.00 MB** (`ARG_MAX`), and it is **unreachable through the tray** — the 256 KB cap delivers fine. Latent, not live. |
| The core charges bytes for zero deliveries (`armed-store.ts:257`) | **The core is correct** — it reports `deliveries:0, estimatedRepeatBytes:0`. The lie is `tray-render.js:238`'s `\|\| armed.pinned.bytes`, which overrides the honest 0 into "59 B × 0 prompts = 59 B so far". A **renderer** bug. `armed-store.ts:257`'s `Math.max(deliveries,1)` is dead in production — and `armed-context.test.js:183` pins it. |
| Items flagged `truncated` while intact | **Fixed** at `render.ts:108`. |

That last row is the audit correcting itself twice over: a finding that was real, is now fixed, and would
have been carried forward as open had the unit not re-checked it.

**Still true:** the framing line is forgeable in-band — no delimiter, no nonce — and that matters more now
the composer pulls tool results **verbatim from files the user did not write**. And there is still no
audit trail: zero `addLog` calls in the arming path, and the hooks never post back.

**Clean, and worth recording:** pin expiry is mandatory and clamped; a missing or unparseable `expiresAt`
is treated as **expired rather than forever**; and session ids are validated before a path is built, in
both the store and the shell hook.

## M4 — the embeddings are real; three claims about them are not

**Not a rejected experiment renamed.** Different mechanism from the rejected `semantic.ts` (which remains
off by default, untouched), no shared code: a genuine 384-dim MiniLM via onnxruntime. Hybrid is hybrid at
query time — neither side short-circuits — and fusion is RRF on rank, which is the right choice.

**But "measured, not assumed" has no reproducible artifact.** No benchmark file exists in the repo or
anywhere in its history; the relevance judgments were never committed; the corpus has moved 693→797. The
454-line test drives a **fake** embedder — plumbing is tested, retrieval quality has **no test at all**,
and nothing in CI would notice a regression to zero.

So the unit measured it independently, relevance fixed before looking at any ranking:

| | BM25 | embeddings | hybrid |
| --- | ---: | ---: | ---: |
| 8 natural-language paraphrases | 0.669 | 0.578 | **0.854** |
| 15 literal keyword queries | **0.933** | 0.758 | 0.824 |

**Hybrid wins decisively on natural language and loses on keywords** — worse than the better single signal
on 4 of 15 keyword queries, better on 0. Combined it still wins (0.861 vs 0.780), so shipping it is
defensible. Two claims are not:

- **"never worse than either alone"** — stated in `embeddings.ts:22`, `research-index.ts:303` and the
  commit message. **False**, by the project's own preferred metric.
- **"embeddings alone 0.614 vs BM25 0.440"** — does not reproduce; embeddings alone lost to BM25 on both
  sets. The claimed ordering is query-set dependent, not a property of the corpus.
- **"offline"** (`embeddings.ts:12`) — first run downloads **22.6 MB from HuggingFace**, 3,610 ms. No API
  key is true; offline is false, and nothing in the UI discloses a third-party fetch triggered by a click.

### The serious one: the feature breaks capture

**`embedPending` blocks the event loop and drops hook events.** It is a single `await embedder.embed(...)`
over the whole batch — no yielding between items — so CPU-bound inference stalls the HTTP server. One
batch of 200, exactly the size the UI loop uses, blocked for **7,374 ms**. Of 29 hook POSTs issued in that
window: **27 ok, 2 failed with ECONNRESET**, latencies forming a clean descending ramp 7124→119 ms against
a 3–5 ms baseline. The code comment claims batching means "a 23-second embed never becomes one blocking
call" — it becomes four ~7 s blocking calls, each dropping events. **Capture is this tool's one
non-negotiable job**, and a convenience feature now interrupts it.

### M4 fixed, confirmed by differential build

- **`defaultProjectKey` coverage** — was 128 of 603 (21%). At `952eddb`: **793 of 797 (99.5%)** under one
  key. Proven by mechanism, not inference: a store fragmented by a `7aa9f10` core, then opened by a
  `952eddb` core → `migratedKeys: 3`, snapshot v1→v2, scoped search 1/4 → 4/4.
- **Remote-less repo fragmentation and the stats/filter disagreement** — reproduced at `7aa9f10`
  (`byProject` reporting 1 project/4 items while the filter returned 1 of 4), **fixed at `952eddb`**.
- **`Router.register`** — fixed, with a `view-registry.test.js` guard. But **the guard does not cover
  subscription**: none of its five tests would fail if a registered view forgot `State.subscribe`, which
  is the defect `10e9ad2` had just fixed.
- **graphify** is reachable and genuinely good — 4,095 nodes / 4,922 edges live, no Python or MCP server
  needed, and absence returns `{available:false}` rather than hanging. One inert piece: `buildGraph` is
  defined and exported and **called from nowhere** at the pin.

**Never closed:** collapsed-session resurrection (confirmed end to end — the session returns in *both*
`getAll` and `getSummaries`); `sessions.getSummaries` still has no client; and `logRetentionDays` still
declares "retain logs 7 days" in the settings UI while being read nowhere and never passed, with the core
hardcoding 0.

## M5 — built since the first audit, and built on the right field

**Superseded.** The prior grading — "capture built, rendering not; no agent view, no MCP server" — was
accurate at its pin and is now wrong. Four commits landed since: `agent-tracker.ts` (496 lines),
`mcp/mcp-server.ts` (387), `protocol/agent.ts` (102) and an Agents view (275), with three test files.

### The design decision that matters, and it is correct

My open finding was that `subagent_complete` reads `log.details?.result`, a key present on **0 of 390**
live `SubagentStop` events. The new tracker does not use that path at all. It reads
**`details.tool_result` from the `Agent` tool call** (`agent-tracker.ts:212`). Measured on the live store:

    Agent/Task PostToolUse events              32
      ...with details.tool_result populated    32   (100%)
      ...containing "teammate_spawned"         24

So the tracker reads the one channel that actually carries the payload, and the **`spawn-ack` distinction
is grounded in real data**: 24 of 32 spawns here are background teammates whose findings genuinely never
return through that channel, and the view labels them **"never reported"** rather than counting them as
successes. That is the honest handling of a case this project would previously have rendered as a silent
success.

**The legacy path is still wrong**, separately: `ipc-server.ts:473` still builds the `subagent_complete`
activity item from `details.result`, so the *feed* still shows no returned text even though the *Agents
view* now does. One bug, two consumers, only one fixed.

### The classification the whole view rests on is wrong on 25% of agents

`classifyResult` (`agent-tracker.ts:81`) matches **only** `teammate_spawned`. Measured against every
spawn result in the live store:

    total Agent/Task spawn results                     32
      "teammate_spawned"                               24
      {"isAsync":true,"status":"async_launched",...}    8   <- ALSO an acknowledgement
      genuine reports                                   0

**All 32 are acknowledgements**, in two spellings. The 8 `async_launched` ones are classified as
**`report`**, so the Agents view shows a green "reported" badge and the detail heading `Returned` without
the "(acknowledgement only)" qualifier, and `mcp-server.ts:214-216` tells a querying agent
`returned: reported` — for agents that returned nothing. The feature built specifically to distinguish
"acknowledged but never reported" from "actually reported" gets it wrong a quarter of the time.

**The code asserts the falsehood in its own comment.** `agent-tracker.ts:26` reads *"All 32 captured spawn
calls returned `{"status": "teammate_spawned", ...}`"* — 8 of them did not. The comment was written from a
partial sample and then used as the justification for a single-spelling regex.

**This audit made the same error one step earlier.** I measured 24 of 32 matching `teammate_spawned` and
reported that "the remaining 8 would be real reports" — an inference, not a measurement, and wrong. Both
the code and the audit looked at the same 32 records and both stopped at the first pattern they found.

Two related defects from the same unit: **spawn-call duration is trusted as runtime** for those 8 —
`ac11e4584f916134a` has **106 tool calls and renders "0.0s"** with the tooltip "Reported by the platform";
and **`typeFromAgentId` recovers 0 of 206** blank types, because every named id already has a type and
every blank one is hex-only. It never fires on live data.

**Correctly handled, and worth stating:** one agent yields **one row despite 27 separate stops**
(`am3-injection`: 27 stops → 1 row, 80 calls, 1,120 s). The per-turn capture defect is deduped properly.

### Measured self-correction, recorded in the code

`agent-tracker.ts` documents an ordering bug caught by measurement rather than reasoning: the same 13,593
events produced **199 agents and 24 spawn-acks in order, versus 182 and ZERO reversed** — described in its
own comment as *"a plausible-looking tree that was wrong in every column."* Feeding a newest-first query
straight into the tracker would have made stops precede starts and every duration negative. That is the
failure mode this audit exists to find, caught by the author before shipping.

### The headline number under-reports by 42%

`core.ts:326` asks for `limit: 100_000` when backfilling agents. `log-manager.ts:215` trims to
`maxLogsInMemory`, which `cli.ts:26` defaults to **10,000**. So the backfill silently sees 10,000 of the
store's 13,966 events. Measured with two spawned cores:

    default (10k cap)        173 agents · 14 "never reported" · 1,874 tool calls
    INSPECTOR_HOOK_MAX_LOGS  204 agents · 24 "never reported" · 1,908 tool calls

**The default hides 31 agents and 10 of 24 "never reported" — 42% of the milestone's headline number.**
The live figures I observed while running the app (174 agents, 152 unlinked) are the capped read.

### It is not a tree

`agent-tracker.ts:439` is `.map((agent) => ({ ...agent, children: [] }))` — a **literal empty array, never
populated**. There are **0 `parent*` fields across 13,966 events**. The code comment at `:428` is honest
about why ("inventing a hierarchy would be a guess"), but the view is presented as a tree and the commit
that shipped it is titled "the tree, and what never came back".

### Two tests that cannot see the bugs they cover

- **The order-independence test** (`agent-tracker.test.js:397`) asserts "order must not change the tree"
  using **4 synthetic events with distinct timestamps**. Real data has **1,611 events at second
  granularity, 1,108 sharing a timestamp**; V8's stable sort then preserves tie order, so replaying
  reversed flips two agents' `resultKind` and moves one duration from **7 ms to 512,531 ms**.
- **The 380-line view suite** (`agents-view.test.js`) calls `view.init(); view.render();` by hand — the
  Router only calls `init()`. At `6a6fd2e` `init()` never called `render()`, so the panel read
  "Loading agents…" forever while every test passed. **Fixed at current HEAD**, but the suite still cannot
  detect a recurrence.

### Where the returned text actually is

`agent-tracker.ts` reads **no result text at all** — `lastAssistantMessage`, present on 399 of 399 stops,
appears nowhere in the file. But the text is **not lost**: `research/extract.ts:186-197` indexes it as a
`subagent_report`, and the MCP `search_history` returns real ones. So the agent's findings live in M4's
surface, not M5's. The legacy `subagent_complete.result` path is still wrong (0 of 399) but **bounded** —
`activity-items.js:133-151` renders `message` and never reads `.result`.

### Open at this pin

- The **legacy `subagent_complete` item** above.
- **Capture defects the tracker may inherit:** `SubagentStop` fires per turn, not per agent (27 stops for
  one agent id); `TeammateIdle` fired 23 times with **0** carrying an `agentId`; `agentType` is missing on
  192 of 345 stops and was measured **0% recoverable**.
- **The MCP server is hand-rolled** — `grep -rl modelcontextprotocol` over `packages/` returns nothing. Its
  transport, registration and whether any client can reach it today are unverified at the time of writing.
- **Parentage:** zero `parent*` fields across 12,678 events, inferable for 12 of 183 agents. Whether the
  "tree" is a genuine tree or a flat list rendered as one is unverified.

## The through-line

Unchanged, and now visible in a fourth place. Every serious finding is the same shape: **the work is real,
one connecting detail is wrong, and a green suite says nothing.** A key name that has never existed. A
claim of "never worse" that is worse on 4 of 15. A guard that covers registration but not subscription. A
digest that omits the counts that would reveal it is incomplete.

And it reached the audit itself: a `SubagentStop` hook emitted `additionalContext` on every stop, that
context re-entered the model as input, the reply ended the turn, and the hook fired again — a
self-sustaining loop, 36 events against 3 starts, each iteration a billable request. **Nothing in the tool
built to observe hooks recorded any of it.** Fixed at the hook during this audit, verified by executing it
before and after.
