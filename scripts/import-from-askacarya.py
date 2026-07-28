"""
OFFICIAL corpus build step — corpus/verses.json is GENERATED, not hand-edited.

Canonical source of truth: askacarya/content/srila-prabhupada/book/ per-verse
files (BBT editions). This script materializes them into verse-restore's
self-contained corpus so the tool stays portable (no runtime dependency on
the askacarya repo). Re-run any time the source improves; existing entries
are never overwritten (hand-curated originals — pranamas, BB set — win).

  python3 import-from-askacarya.py
"""

import json, re, glob
from pathlib import Path

CORPUS = Path(__file__).parent.parent / "corpus.json"
SRC = Path(__file__).parent.parent / "askacarya/content/srila-prabhupada/book"
PREFIXES = ("bg", "sb", "cc", "iso", "noi")   # per-verse structured files only

d = json.load(open(CORPUS))
added = skipped = bad = 0
for pref in PREFIXES:
    for p in glob.glob(str(SRC / f"{pref}-*.txt")):
        t = open(p, encoding="utf-8", errors="replace").read()
        mref = re.match(r"# (.+)", t)
        mv = re.search(r"(?s)## Verse text\n(.*?)\n\n?## ", t)
        mt = re.search(r"(?s)## Translation\n(.*?)(?:\n\n?## |\Z)", t)
        if not (mref and mv and mt):
            bad += 1
            continue
        ref = mref.group(1).strip()
        if ref in d:
            skipped += 1
            continue
        d[ref] = {
            "reference": ref,
            "text": mv.group(1).strip(),
            "translation": mt.group(1).strip()[:400],
            "source": "askacarya corpus — BBT edition (generated import)",
        }
        added += 1

json.dump(d, open(CORPUS, "w"), ensure_ascii=False, indent=1)
print(f"added: {added}  skipped(existing): {skipped}  bad: {bad}  "
      f"total: {sum(1 for k in d if not k.startswith('_'))}")
