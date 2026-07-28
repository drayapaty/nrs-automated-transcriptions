"""
What would a LOWER pass mark let through? (2026-07-28)

The scoring is fine — it ranks the right verse first. The gate (0.40) is
too high: correct answers land at 0.24-0.27 and get refused. But lowering
a corpus-wide gate on the strength of 2 negatives would be reckless, so
this harvests EVERY Sanskrit-looking line from every lecture we have and
lists exactly which extra matches each candidate gate admits — for human
review before anything changes.

  python3 scripts/eval-gate.py

Read-only. No API calls. Changes nothing.
"""

import glob
import json
import re
import unicodedata
from pathlib import Path

CORPUS = Path(__file__).parent.parent / "corpus.json"
LECTURES = sorted(glob.glob("/Users/divakar/Downloads/*_raw.md") +
                  glob.glob("/Users/divakar/Downloads/*_cleaned.md"))
GATES = [0.40, 0.35, 0.30, 0.25, 0.20]

IAST = set("āīūṛṝḷḹṭḍṇśṣṁṅñḥṃ")
ENGLISH = re.compile(
    r"\b(the|is|of|and|to|that|this|for|with|not|are|was|but|has|had|his|her|can|our|how|who|we|he|she|it|do|if|so|as|by|at|in|on|or|an|no|they|there|then|which|what|all|be|have|will|would|could|about|because|their|one|also|very|like|just|know|now|said|says)\b",
    re.I)


def sd(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s)


def grams(s, n=3):
    t = sd(s)
    return {t[i:i + n] for i in range(max(0, len(t) - n + 1))}


def is_verse_line(line):
    """Mirrors the production isVerseLine() heuristic."""
    t = line.strip()
    if not t or len(t) < 10:
        return False
    if re.search(r"[Ѐ-ӿ]", t):
        return False
    words = len(t.split())
    if len(ENGLISH.findall(t)) / max(1, words) >= 0.15:
        return False
    ia = sum(c in IAST for c in t)
    return ia >= 3 and ia / max(1, words) >= 0.4


def main():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    index = []
    for k, v in corpus.items():
        if k.startswith("_"):
            continue
        t = v if isinstance(v, str) else (v.get("text") or v.get("verse") or "")
        if len(t) >= 20:
            index.append((k, grams(t), t))

    # collect verse-lines from every lecture (grouped into blocks like production)
    blocks = []
    for path in LECTURES:
        lines = Path(path).read_text(encoding="utf-8", errors="replace").split("\n")
        i = 0
        while i < len(lines):
            if not is_verse_line(lines[i]):
                i += 1
                continue
            buf = []
            while i < len(lines) and is_verse_line(lines[i]):
                buf.append(lines[i].strip())
                i += 1
            blocks.append((Path(path).name, " ".join(buf)))
    print(f"lectures scanned: {len(LECTURES)}   Sanskrit-looking blocks found: {len(blocks)}\n")

    scored = []
    for src, b in blocks:
        q = grams(b)
        best = (0.0, "-", "")
        for k, g, t in index:
            if not g:
                continue
            inter = len(q & g)
            if not inter:
                continue
            s = inter / len(q | g)
            if s > best[0]:
                best = (s, k, t)
        scored.append((best[0], best[1], b, src, best[2]))

    print(f"{'gate':>6} {'accepted':>9} {'newly admitted vs 0.40':>24}")
    prev = None
    for gate in GATES:
        acc = [r for r in scored if r[0] >= gate]
        new = len(acc) - (prev if prev is not None else len(acc))
        print(f"{gate:6.2f} {len(acc):9} {('+' + str(new)) if prev is not None else '(baseline)':>24}")
        prev = len(acc)

    print("\n" + "=" * 78)
    print("EVERY match a 0.20 gate would ADD that 0.40 refuses — review these:")
    print("=" * 78)
    band = sorted([r for r in scored if 0.20 <= r[0] < 0.40], key=lambda r: -r[0])
    for s, k, b, src, t in band:
        print(f"\n  score {s:.2f}   ->  {k}      [{src}]")
        print(f"    heard:  {b[:96]}")
        print(f"    verse:  {t[:96].replace(chr(10), ' / ')}")
    print(f"\n  {len(band)} block(s) in the 0.20-0.40 band.")

    print("\nblocks that stay refused even at 0.20 (score < 0.20):")
    for s, k, b, src, t in sorted([r for r in scored if r[0] < 0.20], key=lambda r: -r[0])[:10]:
        print(f"  {s:.2f}  {b[:80]}")


if __name__ == "__main__":
    main()
