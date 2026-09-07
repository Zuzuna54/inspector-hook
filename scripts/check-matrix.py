"""
Attack the re-grading, not the code.

Written to embarrass its own author: every check here tries to prove the
re-grade is wrong. A checker that only confirms the grader is worth nothing.
"""
import pathlib, re, sys
from collections import Counter

full = pathlib.Path("docs/AUDIT-MATRIX.md").read_text()

# The document has TWO independently-tallied halves: the 268 phase-doc rows,
# and the M3/M4 rows added afterwards (those milestones have no phase doc).
# Scoping matters -- when the second tally table was added, the whole-document
# regex below found it instead and reported the phase counts as wrong.
MS_HEADING = "## Milestones 3-4"
if MS_HEADING not in full:
    MS_HEADING = "## Milestones 3\u20134"
split = full.index(MS_HEADING) if MS_HEADING in full else len(full)
doc = full[:split]
ms_doc = full[split:]
lines = doc.split("\n")
fails = []

def row_cells(l):
    if not l.startswith("|"): return None
    c = [x.strip() for x in l.strip().strip("|").split("|")]
    return c if len(c) == 3 else None

rows = []
for l in lines:
    c = row_cells(l)
    if not c: continue
    st = c[1].strip("*")
    if st in ("verified","broken","not-impl","untested","inert") and not c[2].endswith("%"):
        rows.append({"crit": c[0], "status": st, "ev": c[2]})

# 1. Row count must still equal the phase-doc checkbox count.
cb = sum(len(re.findall(r'^\s*- \[ \]', f.read_text(), flags=re.M))
         for f in sorted(pathlib.Path("docs/phases").glob("*.md")))
if len(rows) != cb:
    fails.append(f"row count {len(rows)} != {cb} checkboxes in docs/phases")

# 2. Header table must equal the actual row tallies.
actual = Counter(r["status"] for r in rows)
header = {m[0]: int(m[1]) for m in re.findall(r'\| \*\*(verified|broken|not-impl|untested|inert)\*\* \| (\d+) \| \d+% \|', doc)}
for k in set(actual) | set(header):
    if actual.get(k, 0) != header.get(k, 0):
        fails.append(f"header says {k}={header.get(k,0)}, rows say {actual.get(k,0)}")

# 3. THE RULE: no verified row may rest on a code read.
#    Every verified row must carry an evidence class, and it must not be `read`.
for r in rows:
    if r["status"] != "verified": continue
    m = re.search(r'_(test|live|artifact|read)_', r["ev"])
    if not m:
        fails.append(f"verified row has no evidence class: {r['crit'][:48]}")
    elif m.group(1) == "read":
        fails.append(f"verified row rests on a READ: {r['crit'][:48]}")

# 4. No row may claim a file that does not exist.
for r in rows:
    for path in re.findall(r'`(packages/[^`]+?\.(?:ts|js|sh|json|md))`', r["ev"]):
        if not pathlib.Path(path).exists():
            fails.append(f"cites a nonexistent path {path}: {r['crit'][:40]}")

# 5. No row may cite a test file that does not exist.
for r in rows:
    for t in re.findall(r'`([a-z0-9-]+\.test\.js)`', r["ev"]):
        if not list(pathlib.Path("packages").rglob(t)):
            fails.append(f"cites a nonexistent test {t}: {r['crit'][:40]}")

# 6. Percentages must be consistent with the counts.
for st, n, pct in re.findall(r'\| \*\*(verified|broken|not-impl|untested|inert)\*\* \| (\d+) \| (\d+)% \|', doc):
    if int(pct) != int(n) * 100 // cb:
        fails.append(f"{st}: {n}/{cb} is {int(n)*100//cb}%, document says {pct}%")


# 7. The M3/M4 section is held to the same standards as the 268.
#    Its rows are four-column (they carry an id), so the parser above skips
#    them entirely -- without this they would be graded by nobody.
ms_rows = []
for l in ms_doc.split("\n"):
    if not l.startswith("| M"):
        continue
    c = [x.strip() for x in l.strip().strip("|").split("|")]
    if len(c) != 4:
        continue
    ms_rows.append({"id": c[0], "crit": c[1], "status": c[2].strip("*"), "ev": c[3]})

VALID = ("verified", "broken", "not-impl", "untested", "inert")
for r in ms_rows:
    if r["status"] not in VALID:
        fails.append(f"{r['id']}: status '{r['status']}' is not one of the five defined")
    # Same rule as the 268: a behavioural claim may not rest on a code read.
    if r["status"] == "verified" and r["ev"].split("\u00b7")[0].strip() == "read":
        fails.append(f"{r['id']}: verified row rests on a READ")

ms_actual = Counter(r["status"] for r in ms_rows)
ms_header = {m[0]: int(m[1]) for m in
             re.findall(r'\| \*\*(verified|broken|not-impl|untested|inert)\*\* \| (\d+) \| \d+% \|', ms_doc)}
for k in set(ms_actual) | set(ms_header):
    if ms_actual.get(k, 0) != ms_header.get(k, 0):
        fails.append(f"M3/M4 header says {k}={ms_header.get(k,0)}, rows say {ms_actual.get(k,0)}")

# The intro must not understate its own scope, which is what it did before.
claimed = re.search(r'plus (\d+) rows for Milestones 3 and 4', full)
if not claimed:
    fails.append("the intro no longer states how many M3/M4 rows exist")
elif int(claimed.group(1)) != len(ms_rows):
    fails.append(f"intro claims {claimed.group(1)} M3/M4 rows, found {len(ms_rows)}")

print(f"checked {len(ms_rows)} M3/M4 rows")
print(f"checked {len(rows)} rows")
if fails:
    print(f"FAILURES ({len(fails)}):")
    for f in fails[:20]: print(f"  - {f}")
    if len(fails) > 20: print(f"  ... {len(fails)-20} more")
    sys.exit(1)
print("no contradictions found")
