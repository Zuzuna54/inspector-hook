"""
Attack the re-grading, not the code.

Written to embarrass its own author: every check here tries to prove the
re-grade is wrong. A checker that only confirms the grader is worth nothing.
"""
import pathlib, re, sys
from collections import Counter

doc = pathlib.Path("docs/AUDIT-MATRIX.md").read_text()
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

print(f"checked {len(rows)} rows")
if fails:
    print(f"FAILURES ({len(fails)}):")
    for f in fails[:20]: print(f"  - {f}")
    if len(fails) > 20: print(f"  ... {len(fails)-20} more")
    sys.exit(1)
print("no contradictions found")
