"""
Tier-2 corpus import: verse text from the PREVIOUS ĀCĀRYAS' books.

Prabhupāda's per-verse BBT files (import-from-askacarya.py) cover BG/SB/CC
only. The marker-anchored ācārya books in askacarya/content carry 43,992
labeled verse regions — Caitanya-bhāgavata, Hari-bhakti-vilāsa, Bṛhad-
bhāgavatāmṛta, the sandarbhas, Viśvanātha's ṭīkās — i.e. exactly the books
Mahārāja quotes that Prabhupāda's folder cannot supply.

Region shape (verified 2026-07-24):
    \x0cText 4
    sa jayati viśuddha-vikramaḥ kanakābhaḥ ...
    vara-jānu-vilambi-ṣaḍ-bhujo ...
    <blank>
    All glories to Śrī Gaurasundara, ...      <- English, not wanted

So: after the "Text N" (or TEXTS N-M / Anuccheda N) marker, take the
IAST block up to the first blank line. Keep it only if it looks like
Sanskrit verse (diacritic density + no long English run).

Deterministic. No API calls, no cost. Fill-only: never overwrites an
existing corpus entry (Prabhupāda's BBT text stays canonical).

  python3 import-acarya-books.py --dry-run
  python3 import-acarya-books.py
"""

import glob
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
CORPUS = HERE.parent / "corpus.json"
CONTENT = HERE.parent.parent / "askacarya/content"
DRY = "--dry-run" in sys.argv

MARKER = re.compile(r"(?m)^[ \t\x0c]*(?:TEXTS?|Texts?|Anuccheda|ANUCCHEDA)[ \t]+([\d\-–]+)[ \t]*$")
IAST_CHARS = set("āīūṛṝḷḹṭḍṇśṣṁṅñḥṃĀĪŪṚṬḌṆŚṢṀṄÑḤ")
# English function words: their presence in force means we grabbed a translation
ENGLISH = re.compile(r"\b(the|and|of|who|his|her|is|are|was|were|that|this|with|from|all|glories)\b", re.I)


def looks_like_verse(block: str) -> bool:
    if not (20 <= len(block) <= 900):
        return False
    letters = sum(c.isalpha() for c in block)
    if not letters:
        return False
    dia = sum(c in IAST_CHARS for c in block)
    if dia / letters < 0.04:          # Sanskrit in IAST is diacritic-dense
        return False
    eng = len(ENGLISH.findall(block))
    words = max(1, len(block.split()))
    return eng / words < 0.12          # a translation blows past this


# Key formats the corpus ACTUALLY uses (measured 2026-07-28 — the 11,753-
# duplicate defect came from inventing "SB 1.3.28" instead of these):
#   SB 1 3.28                 canto SPACE chapter.verse   (12,230 entries)
#   CC Madhya-līlā 8.128      līlā NAME, not a number     (11,185)
#   BG 2.13                   chapter.verse               (631)
#   BB 91                     flat                        (373)
# Anything we cannot render in an existing shape is SKIPPED, not guessed —
# a wrong key is worse than a missing verse (it hides the real entry).
LILA = {"adi": "Ādi", "madhya": "Madhya", "antya": "Antya"}


def canonical_ref(r) -> str | None:
    def f(key):
        v = r.get(key)
        v = "" if v is None else str(v).strip()
        return "" if v in ("", "None") else v

    part, sec, ch, v = f("scripture_part"), f("scripture_section"), f("scripture_chapter"), f("scripture_verse")
    if not part or not v:
        return None
    if part == "SB":
        return f"SB {sec} {ch}.{v}" if sec and ch else None
    if part == "CC":
        lila = LILA.get(sec.lower())
        return f"CC {lila}-līlā {ch}.{v}" if lila and ch else None
    if part == "BG":
        return f"BG {ch}.{v}" if ch else None
    if part == "BB":
        return f"BB {ch}.{v}" if ch else f"BB {v}"
    # CB / HBV / sandarbhas: no established key shape in the corpus yet.
    # Deliberately skipped — needs a format decision first (DECISIONS.md).
    return None


def main():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    before = len([k for k in corpus if not k.startswith("_")])

    added, skipped_have, rejected, no_ref = 0, 0, 0, 0
    per_book = Counter()
    per_scripture = Counter()

    for jp in sorted(glob.glob(str(CONTENT / "*/book/*.json"))):
        if "/srila-prabhupada/" in jp or ".bak" in jp:
            continue
        try:
            d = json.loads(Path(jp).read_text(encoding="utf-8"))
        except Exception:
            continue
        regions = (d.get("verse_map") or {}).get("regions") or []
        if not regions:
            continue
        tp = Path(jp).with_suffix(".txt")
        if not tp.exists():
            continue
        txt = tp.read_text(encoding="utf-8", errors="replace")
        book = Path(jp).stem

        for r in regions:
            ref = canonical_ref(r)
            if not ref:
                no_ref += 1
                continue
            if ref in corpus:
                skipped_have += 1
                continue
            try:
                s, e = int(r["start_offset"]), int(r["end_offset"])
            except Exception:
                continue
            seg = txt[s:min(e, s + 4000)]
            m = MARKER.search(seg)
            body = seg[m.end():] if m else seg
            block = body.lstrip("\n").split("\n\n")[0].strip()
            block = "\n".join(ln.strip() for ln in block.splitlines() if ln.strip())
            if not looks_like_verse(block):
                rejected += 1
                continue
            if not DRY:
                corpus[ref] = {"verse": unicodedata.normalize("NFC", block),
                               "source": f"{Path(jp).parts[-3]}/{book}",
                               "tier": 2}
            added += 1
            per_book[book] += 1
            per_scripture[ref.split()[0]] += 1

    if not DRY and added:
        CORPUS.write_text(json.dumps(corpus, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"{'DRY RUN — ' if DRY else ''}corpus {before} -> {before + added} (+{added})")
    print(f"already had: {skipped_have} | rejected (not verse-shaped): {rejected} | unusable ref: {no_ref}")
    print("\nby scripture:")
    for k, n in per_scripture.most_common(12):
        print(f"  {n:6d}  {k}")
    print("\ntop books:")
    for k, n in per_book.most_common(10):
        print(f"  {n:6d}  {k[:60]}")


if __name__ == "__main__":
    main()
