"""
Pre-write test battery for import-acarya-books.py (2026-07-28).

Corpus writes need explicit per-run permission (DECISIONS.md). This
simulates the write in memory and asserts:

  T1 zero duplicate key-groups (the defect that forced the revert)
  T2 every new key parses in an EXISTING corpus key shape
  T3 SB/BG refs land inside real scripture bounds (canto 1-12 etc.)
  T4 no new entry overwrites an existing one (fill-only holds)
  T5 extracted text is verse-shaped: IAST-dense, not English prose
  T6 no entry duplicates the TEXT of a different existing key
     (same verse under two names = the matcher sees two candidates)

  python3 scripts/test-acarya-import.py

Read-only. Exit 1 on any failure.
"""

import importlib.util
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("imp", HERE / "import-acarya-books.py")
imp = importlib.util.module_from_spec(spec)
sys.argv = ["x", "--dry-run"]
spec.loader.exec_module(imp)

corpus = json.loads(imp.CORPUS.read_text(encoding="utf-8"))
existing = {k: v for k, v in corpus.items() if not k.startswith("_")}

# ---- replay the import in memory ------------------------------------------
import glob
proposed = {}
for jp in sorted(glob.glob(str(imp.CONTENT / "*/book/*.json"))):
    if "/srila-prabhupada/" in jp or ".bak" in jp:
        continue
    try:
        d = json.loads(Path(jp).read_text(encoding="utf-8"))
    except Exception:
        continue
    regions = (d.get("verse_map") or {}).get("regions") or []
    tp = Path(jp).with_suffix(".txt")
    if not regions or not tp.exists():
        continue
    txt = tp.read_text(encoding="utf-8", errors="replace")
    for r in regions:
        ref = imp.canonical_ref(r)
        if not ref or ref in existing or ref in proposed:
            continue
        try:
            s, e = int(r["start_offset"]), int(r["end_offset"])
        except Exception:
            continue
        seg = txt[s:min(e, s + 4000)]
        m = imp.MARKER.search(seg)
        body = seg[m.end():] if m else seg
        block = "\n".join(ln.strip() for ln in body.lstrip("\n").split("\n\n")[0].strip().splitlines() if ln.strip())
        if not imp.looks_like_verse(block):
            continue
        proposed[ref] = {"verse": unicodedata.normalize("NFC", block),
                         "source": f"{Path(jp).parts[-3]}/{Path(jp).stem}", "tier": 2}

print(f"existing: {len(existing)}  proposed new: {len(proposed)}\n")
fails = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}")
    if not ok:
        fails.append(name)


# T1 — duplicate key-groups across the merged corpus
def keysig(k):
    m = re.match(r"([A-Za-z][A-Za-z\-]*(?:\s+[ĀA][a-zā-ž]*-līlā)?)\s+(.+)$", k)
    if not m:
        return None
    return (m.group(1).strip().lower(), tuple(re.split(r"[.\s]+", m.group(2).strip())))


groups = defaultdict(list)
for k in list(existing) + list(proposed):
    s = keysig(k)
    if s:
        groups[s].append(k)
dupes = {s: ks for s, ks in groups.items() if len(ks) > 1}
check("T1 zero duplicate key-groups", not dupes,
      f"{len(dupes)} groups, e.g. {list(dupes.values())[:2]}" if dupes else "")

# T2 — new keys use an existing shape
shapes_existing = {re.sub(r"\d+", "N", k) for k in existing}
bad_shape = [k for k in proposed if re.sub(r"\d+", "N", k) not in shapes_existing]
check("T2 new keys use existing shapes", not bad_shape, f"{len(bad_shape)}, e.g. {bad_shape[:3]}")

# T3 — refs inside scripture bounds
out_of_bounds = []
for k in proposed:
    m = re.match(r"SB (\d+) (\d+)\.(\d+)", k)
    if m and not (1 <= int(m.group(1)) <= 12):
        out_of_bounds.append(k)
    m = re.match(r"BG (\d+)\.(\d+)", k)
    if m and not (1 <= int(m.group(1)) <= 18):
        out_of_bounds.append(k)
check("T3 refs within scripture bounds", not out_of_bounds, f"{len(out_of_bounds)}, e.g. {out_of_bounds[:3]}")

# T4 — fill-only
clobber = [k for k in proposed if k in existing]
check("T4 fill-only (no overwrites)", not clobber, f"{len(clobber)}")

# T5 — verse-shaped text
bad_text = []
for k, v in proposed.items():
    t = v["verse"]
    letters = sum(c.isalpha() for c in t) or 1
    dia = sum(c in imp.IAST_CHARS for c in t) / letters
    eng = len(imp.ENGLISH.findall(t)) / max(1, len(t.split()))
    if dia < 0.04 or eng >= 0.12 or not (20 <= len(t) <= 900):
        bad_text.append(k)
check("T5 all proposed text is verse-shaped", not bad_text, f"{len(bad_text)}, e.g. {bad_text[:3]}")


# T6 — no text duplicated from a different existing key
def norm(t):
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", t)


ex_text = {}
for k, v in existing.items():
    t = v if isinstance(v, str) else (v.get("text") or v.get("verse") or "")
    if len(t) >= 20:
        ex_text.setdefault(norm(t)[:80], k)
text_dupes = [(k, ex_text[norm(v["verse"])[:80]]) for k, v in proposed.items()
              if norm(v["verse"])[:80] in ex_text]
check("T6 no text duplicated under a new key", not text_dupes,
      f"{len(text_dupes)} pairs, e.g. {text_dupes[:2]}")

print(f"\nby scripture: {dict(Counter(k.split()[0] for k in proposed).most_common())}")
print("\nsamples:")
for k in list(proposed)[:6]:
    print(f"  {k:26} {proposed[k]['verse'][:64].replace(chr(10), ' / ')}")

print(f"\n{'ALL TESTS PASSED' if not fails else 'FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
