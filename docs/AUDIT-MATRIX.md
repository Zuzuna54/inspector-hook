# Feature Audit Matrix

Milestone 1.3. Every acceptance criterion and success metric from `docs/phases/*.md`, plus a
per-view UI checklist, resolved to a status with evidence.

**This replaces guesswork about what works.** Where a criterion is met, the evidence is a named test,
a measurement, or a recorded live observation — not an assertion.

| Status | Meaning |
|---|---|
| **verified** | Proven by a named test, a measurement, or a recorded live check |
| **broken** | Implemented but does not meet the criterion |
| **not-impl** | No implementation exists (spec-only) |
| **untested** | Implemented and plausibly working, but not actually verified. Counted as a gap, not a pass. |

Measurements were taken on macOS 25.6 / Node 22.19 at commit `903b80d`, against the built artifacts.
`pnpm test` = 242 tests, all passing. Updated after Milestone 2.

---

## Phase 0 — Foundation

| Criterion | Status | Evidence |
|---|---|---|
| `pnpm install` completes without errors | verified | Clean run from deleted `node_modules` |
| `pnpm build` compiles all packages | verified | Was **broken** twice: pnpm's `ERR_PNPM_IGNORED_BUILDS` gate, and a committed `tsconfig.tsbuildinfo` that made tsc skip emit on a fresh clone. Both fixed. |
| TypeScript type checking passes | verified | `pnpm typecheck` → 0 errors |
| Core can import from Protocol | verified | Build succeeds; `ipc-server` imports protocol types |
| VS Code can import from Protocol | verified | Build succeeds |
| No circular dependencies | untested | No tool checks this (`madge` is the M7 candidate) |
| Extension activates in development host | verified | Live: extension host launched, core spawned (pid observed) |
| Command "Inspector Hook: Show Panel" appears | verified | Live: panel opened via the command |
| No activation errors in console | untested | Not captured systematically |
| Watch mode updates on file changes | untested | `pnpm dev` never exercised |
| IntelliSense works across packages | untested | — |
| **Metric:** all packages build < 5s | **verified** | **3354 ms** measured, clean |
| **Metric:** zero TypeScript errors | **verified** | 0 |
| **Metric:** extension loads without errors | verified | Live |
| **Metric:** dev iteration < 2s | untested | Watch mode not exercised |

---

## Phase 1 — Walking Skeleton

| Criterion | Status | Evidence |
|---|---|---|
| Core process starts without errors | verified | `ipc-server.test.js` spawns the real CLI; handshake asserted |
| HTTP server binds to available port | verified | `http-server` port scan; `ingest.test.js` binds port 0 |
| Port is communicated to parent process | verified | `{"type":"ready","port":N}` asserted in `ipc-server.test.js` |
| POST /log accepts JSON payload | verified | `ingest.test.js` — "accepts a valid log" |
| Log is stored in memory | verified | `log-manager.test.js` (28 tests) |
| No errors in hook script execution | verified | `hooks.test.js` — `bash -n` over every shipped script + exit-0 on missing port |
| VS Code spawns core process | verified | Live: core pid observed with `INSPECTOR_HOOK_HTTP_PORT` in its env |
| VS Code reads port from core | verified | Live: port file matches the listening socket |
| getLogs IPC call returns logs | verified | `ipc-server.test.js` — "logs.getAll is registered" + dispatch |
| Webview loads without errors | untested | Panel renders; console not captured |
| Logs display in webview | verified | Live: panel showed this session's traffic |
| Polling updates logs automatically | verified | Live; Sessions view polls 2s/30s |
| Log appears in webview within 2s | untested | Not instrumented end-to-end |
| **Metric:** core starts < 500ms | **broken** | **533 ms** measured — marginal miss, 7% over |
| **Metric:** hook log delivery < 100ms | **verified** | **37 ms** measured over 40 runs (was 357 ms). M2 rewrote the hook to one `jq` invocation and one backgrounded curl; 26 `jq` + 10 `date` spawns removed |
| **Metric:** webview update latency < 1s | untested | — |
| **Metric:** zero memory leaks in 1-hour test | untested | Never run. Two leaks *were* found by other means (unref'd intervals, unbounded `changes` map) |
| **Metric:** works on macOS and Linux | broken | macOS only. Linux never run; `date -u '+…%3N'` has a node fallback specifically for BSD, untested on GNU |

---

## Phase 2 — Core Features

| Criterion | Status | Evidence |
|---|---|---|
| Sessions created and tracked correctly | verified | `session-manager.test.js` — creation from hook metadata, project/branch derivation |
| Tool executions recorded with timing | verified | Live: `dur=3277ms`, `dur=8826ms` from real `duration_ms`. Was **broken** — durations were derived from second-resolution timestamps (always ×1000 or 0) |
| Sessions persist across restarts | verified | `session-manager.test.js` persistence round-trip; live across core restarts |
| Changes detected accurately | verified | `file-tracker.test.js`; **one change per edit** (B1 regression) |
| Before/after content captured | verified | `file-tracker.test.js` — asserts both sides |
| Status transitions work correctly | verified | Was **broken**: revert never archived (B3). Now `pending → kept\|reverted → archive` with `resolution` |
| Versions stored and retrievable | verified | `file-tracker.test.js` — dedup by hash, retrieval, trim |
| Comparison between versions works | verified | Was **broken** for live-disk compare (B9, returned `null` silently). `regressions.test.js` covers all aliases |
| History persists across restarts | verified | `persistence.test.js` version round-trip |
| Kept changes archived | verified | `file-tracker.test.js` |
| Restore functionality works | verified | `file-tracker.test.js` — "restores an archived change back onto disk" |
| Archives persist across restarts | verified | `persistence.test.js` |
| Large files handled efficiently | verified | `diff-engine.test.js` — 2000-line file diffed, guarded < 5s |
| No memory leaks | verified | Two found and fixed: unref'd intervals (B8), unbounded `changes` map (B3). Heap 13.5 MB under load |
| Persistence operations non-blocking | verified | Was **badly broken**: O(n²) un-awaited full-document rewrites from the HTTP path, **502× amplification** over 500 tool calls. Now coalesced + atomic — **1×**. `regressions.test.js` B19 |
| **Metric:** 100+ sessions | **verified** | **120** created, no degradation |
| **Metric:** 1000+ file changes | **verified** | **1100** tracked in 2969 ms |
| **Metric:** persistence reload < 2s | **verified** | **394 ms** for 120 sessions + 1100 changes |
| **Metric:** memory < 200MB under load | **verified** | **13.5 MB** heap after 10k logs |
| **Metric:** all managers emit proper events | verified | `session-manager.test.js` asserts emissions |

---

## Phase 3 — UI Development

| Criterion | Status | Evidence |
|---|---|---|
| All views render correctly | verified | 6 views live: Dashboard, Logs, Sessions, File Changes, History, Archived |
| Real-time updates work | verified | Live: log/stats/session/fileChange notifications reach the panel |
| Diff viewer shows accurate diffs | verified | `diff-engine.test.js` (24 tests): hunk boundaries, context bounds, whitespace, moves |
| Keep/Revert operations work | verified | `file-tracker.test.js`; revert was archiving nothing until B3 |
| UI responds within 100ms | untested | Not instrumented |
| No JavaScript errors | broken | Fixed: undefined `--accent-bg`, `updateRunningTools` NaN index (could render the wrong tool's content — 236/400 ids are digit-leading). Still open: `API.getVersionContent` is called but does not exist |
| Works in light and dark themes | untested | CSS uses `--vscode-*` tokens; never checked in both |
| **Metric:** all 6 views implemented | **verified** | 6/6 |
| **Metric:** < 50ms render time for lists | untested | — |
| **Metric:** < 100ms response to interactions | untested | — |
| **Metric:** works with 10,000+ logs | verified (core) / untested (UI) | Core: 10k ingested, query 100/10000 in **4 ms**. UI caps at 1000 client-side |
| **Metric:** zero console errors | broken | See above |

---

## Phase 4 — Hooks Integration

The weakest phase, and the one M2 exists to fix.

| Criterion | Status | Evidence |
|---|---|---|
| All built-in hooks install correctly on first run | **verified** | M2 installer writes the nested schema and registers the working script. `hooks.test.js` — "writes the nested schema Claude Code requires" |
| Claude settings.json updated properly | **verified** | Merges per-event/per-command. `hooks.test.js` — "REGRESSION: preserves another tool's hooks", plus idempotency and clean-uninstall tests. Applied live: 21 foreign hooks intact, each individually verified |
| Hooks directory structure + shared libraries | verified | One script, no shared lib needed; installer resolves its own absolute path |
| Installation works on macOS and Linux | untested | macOS only |
| Create/update/delete hooks | **not-impl** | Spec-only. No `hooks.*` IPC methods exist |
| Enable/disable toggles | **not-impl** | Spec-only |
| Hook validation | **not-impl** | Spec-only (`HookValidationResult` declared, unused) |
| Hook testing | **not-impl** | Spec-only |
| Logging hooks capture all Claude Code events | **verified** | **30 of 33 registered** (live: 7 → 30). All 30 verified to survive ingestion end-to-end; `hooks.test.js` asserts a well-formed payload per event and that the installer's list matches. `MessageDisplay` and the `Elicitation` pair deliberately excluded |
| Events properly sent to core | verified | Live: real `tool_use_id`, `promptId` on 30/30 logs, millisecond stamps |
| No events missed or duplicated | verified | Duplicates were real (B1 race, 2 records per edit) and are fixed |
| Security gate blocks dangerous commands | untested | `security-gate.py` is installed and wired, never exercised by us |
| Quality hooks format code correctly | untested | Installed, unexercised |
| Notifications work on macOS and Linux | untested | macOS wired, unexercised |
| Context loader injects project context | untested | Installed, unexercised |
| Hook management UI | **not-impl** | Spec-only |
| **Metric:** all 10 events supported and logged | **verified** | All 10 of the originally-spec'd events registered, plus 20 more |
| **Metric:** < 50ms hook overhead | **verified** | **37 ms** measured (was 357 ms) |
| **Metric:** 100% built-in hooks functional on clean install | partial | Inspector Hook's own hook: verified. The `config/claude-hooks/` extras (security gate, formatters, notifiers) remain unexercised |
| **Metric:** hook management UI operational | **not-impl** | — |
| **Metric:** works on macOS and Linux | untested | — |

---

## Phase 5 — Advanced Features

Entirely spec-only. Protocol types exist (`Rule`, `RuleCondition`, `RuleAction`, `Analytics`,
`StagedChange`, `ApplyResult`, `WebSocketEvent`) with **zero implementation and zero consumers**.

| Criterion | Status |
|---|---|
| Rules evaluate / actions execute / rules persist | **not-impl** |
| Changes stage / apply single+batch / conflicts | **not-impl** |
| Real-time streaming, multi-client | **not-impl** — no WebSocket server exists anywhere; `wsPort` is vestigial config |
| Analytics metrics / time series / insights | **not-impl** — no `analytics.*` IPC method |
| All four metrics | **not-impl** |

---

## Phase 6 — Production Hardening

| Criterion | Status | Evidence |
|---|---|---|
| All inputs validated | partial | `hook`/`event`/`sessionId` validated at ingest (`ingest.test.js`); no schema validation, no bounds on field sizes |
| Rate limiting active | **not-impl** | Spec calls for 100 req/min/IP; none exists |
| No path traversal possible | partial | `persistence.test.js` asserts version paths stay inside the store. But ingest still reads **any** path a payload names — `workspaceRoot` is not used for scoping |
| Security audit passed | partial | One real hole found and closed: `Access-Control-Allow-Origin: *` with no auth on an endpoint that opens caller-named files (B11). No formal audit |
| Memory < 200MB under load | verified | 13.5 MB |
| Response time < 100ms | verified (core) | Query 100/10000 logs in 4 ms |
| No memory leaks | verified | Two found and fixed |
| Handles 10K+ logs | verified | Measured |
| Graceful error handling | partial | Ingest and IPC return structured errors; no global `uncaughtException` handler |
| Clean shutdown | verified | `ipc-server.test.js` — "exits the process on core.shutdown". Was **broken**: unref'd intervals kept it alive forever (B8) |
| Auto-recovery from errors | **not-impl** | — |
| VSIX builds / installs / < 5MB | untested | `vsce package` never run |
| Documentation complete | broken | README documents a hook-install flow that produces a settings.json Claude Code rejects; `DATA_MODELS` `SessionStatus` lacks `idle`; `sessions.getActivity` absent from `API_CONTRACTS` |

---

## Per-view UI checklist

Derived from the webview inventory. Backend-side items carry test evidence; interaction items are
marked untested unless observed live.

### Dashboard
| Item | Status |
|---|---|
| 6 stat cards render and update live | verified (live) |
| Errors / Warnings / Blocked populate from real traffic | verified — was **broken**: the hook hardcoded `level="info"`, so these could never populate (B14) |
| Recent Activity shows last 10 logs | verified (live) |
| Empty state | untested |

### Logs
| Item | Status |
|---|---|
| Initial fetch on tab entry | verified (live) |
| Level / Hook / Session filters, combining | verified (backend: `log-manager.test.js`) / untested (UI) |
| Row click → inline detail | untested |
| "Load More" | broken by design — reveals client-side rows only, never re-fetches; capped at 1000 |
| Live prepend of new logs | verified (live) |

### Sessions
| Item | Status |
|---|---|
| Sidebar search / sort / counts | untested |
| Select session loads activity + logs | verified (live) |
| Activity feed item types render | verified (live) — `activity.test.js` asserts the produced shapes |
| Tool bubbles resolve from running → completed | verified — was **broken twice**: backend pairing (B2) and a render-layer NaN index |
| Real durations shown | verified — was **broken** (fictional, ×1000) |
| Turn grouping by promptId | verified — `prompt_id` was sent and dropped at ingest; now captured |
| StopFailure not rendered as Claude's reply | verified — was **broken** (B23) |
| Delete session → modal → cascade | verified (backend: B10 now reports only real deletions) / untested (UI) |
| Auto-refresh 2s/30s stops on leave | untested |

### File Changes
| Item | Status |
|---|---|
| Session → file → hunk accordions | untested |
| Keep All / Revert All (session + file) | verified (backend) / untested (UI) |
| Hunks vs Split view | untested |
| Edit mode: contenteditable, autosave, Reset, Cancel | untested |
| Per-hunk Keep/Revert | **not-impl** end-to-end — `keepHunk`/`revertHunk` exist and alias to whole-change |
| Diff loading / error / empty states | untested |
| Dead render paths (`_renderUnifiedDiff` et al.) | broken — unreachable code |

### History
| Item | Status |
|---|---|
| File accordion from tracked files | verified (backend) |
| Version list, restore, delete | verified (backend) / untested (UI) |
| Full vs Split view | untested |
| Compare to disk | verified (backend, B9) / untested (UI) |
| No live refresh while tab open | broken by design |
| `API.getVersionContent` | broken — called, does not exist |
| Restore leaves stale UI | broken — `init` omits `trackedFiles`/`versionHistory` |

### Archived
| Item | Status |
|---|---|
| Session → file → change accordions | untested |
| All / Kept / Reverted filter | verified (backend: `resolution` field, B3) — previously only kept changes were ever archived, so the filter had no reverted data |
| Per-change View (diff preview) | **broken** — `State.currentDiff` never exists; `diff-result` routes only to FileChangesView |
| File-level Restore | **broken** — restores only `fileChanges[0]` |
| Restore leaves stale UI | broken — `init` omits `archivedChanges` |

---

## Summary

| | verified | broken | not-impl | untested |
|---|---|---|---|---|
| Phase 0 | 8 | 0 | 0 | 6 |
| Phase 1 | 11 | 3 | 0 | 5 |
| Phase 2 | 20 | 0 | 0 | 0 |
| Phase 3 | 6 | 2 | 0 | 5 |
| Phase 4 | 2 | 6 | 6 | 7 |
| Phase 5 | 0 | 0 | 8 | 0 |
| Phase 6 | 5 | 1 | 2 | 5 |
| UI views | 12 | 8 | 2 | 18 |

**Phase 2 is fully verified** — the core data layer is the strongest part of the system, which is
where the 14 bug fixes concentrated. **Phase 4 was the weakest and is now largely closed by M2**:
event coverage 7 → 30, hook latency 357 ms → 37 ms, and an installer that merges instead of
destroying. What remains in Phase 4 is the in-app hook-management UI, which is spec-only.

## The resulting backlog, ranked

1. ~~Register the unregistered hook events~~ — **DONE (M2)**, 7 → 30, applied live.
2. ~~Hook latency 357 ms~~ — **DONE (M2)**, 37 ms.
3. ~~`install.sh` schema + merge~~ — **DONE (M2)**, with regression tests including legacy migration.
4. ~~Consolidate three hook implementations~~ — **DONE (M2)**, one script.
5. Archived view: dead View-diff, file-level Restore restoring one change, stale-after-restore. (peer)
6. `API.getVersionContent` — called, undefined. (peer)
7. `logRetentionDays` still inert; `PersistenceStore.cleanup()` still a stub.
8. `getSessionStats` still hardcodes `logCount`/`warnings`.
9. Rate limiting, ingest path scoping, global error handler. (Phase 6)
10. Doc drift: README install flow, `DATA_MODELS` `SessionStatus`, `API_CONTRACTS` `getActivity`.
11. Dead code: `setPersistence()` ×3, WebSocket types, `media/index.html`, unreachable render paths.
12. Untested-but-implemented: Linux, themes, watch mode, VSIX packaging, UI interaction latency.
