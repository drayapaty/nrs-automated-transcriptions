"""
A/B the corpus against real garbled Whisper blocks — old vs new corpus.

The risk of growing the corpus is NOT "fewer matches", it is WRONG matches:
more entries = more chances a garble lands on the wrong verse above the
Jaccard threshold. So this replicates the pipeline's content-match RAG
(sub-pass 3) in pure Python and diffs the two corpora's answers.

  python3 test-corpus-ab.py <old-corpus.json> <new-corpus.json> <transcript.md>

Zero API calls. Reports: newly recovered / unchanged / CHANGED (needs eyes).
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

THRESHOLD = 0.35


def strip_dia(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", strip_dia(s)).split() and re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", strip_dia(s))).strip() or ""


def grams(s: str, n=3):
    t = norm(s).replace(" ", "")
    return {t[i:i + n] for i in range(max(0, len(t) - n + 1))}


def entry_text(v) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return v.get("verse") or v.get("text") or ""
    return ""


def build(corpus_path):
    d = json.loads(Path(corpus_path).read_text(encoding="utf-8"))
    out = []
    for k, v in d.items():
        if k.startswith("_"):
            continue
        t = entry_text(v)
        if len(t) >= 20:
            out.append((k, t, grams(t)))
    return out


def best(block_g, index):
    bk, bs = None, 0.0
    for k, t, g in index:
        if not g:
            continue
        inter = len(block_g & g)
        if not inter:
            continue
        score = inter / len(block_g | g)
        if score > bs:
            bk, bs = k, score
    return (bk, bs) if bs >= THRESHOLD else (None, bs)


# ---- extract candidate Sanskrit blocks from a transcript --------------------
IAST = set("āīūṛṝḷḹṭḍṇśṣṁṅñḥṃ")
ENGLISH = re.compile(r"\b(the|and|of|that|this|is|are|we|you|to|in|it)\b", re.I)


def sanskrit_blocks(md: str):
    for para in re.split(r"\n\s*\n", md):
        p = " ".join(para.split())
        p = re.sub(r"^[>*_#\s]+", "", p)
        if not (25 <= len(p) <= 500):
            continue
        letters = sum(c.isalpha() for c in p)
        if not letters:
            continue
        dia = sum(c in IAST for c in strip_dia(p) or "") + sum(c in IAST for c in p)
        eng = len(ENGLISH.findall(p)) / max(1, len(p.split()))
        if dia / letters >= 0.03 and eng < 0.10:
            yield p


def main():
    old_p, new_p, tr_p = sys.argv[1], sys.argv[2], sys.argv[3]
    md = Path(tr_p).read_text(encoding="utf-8", errors="replace")
    blocks = list(dict.fromkeys(sanskrit_blocks(md)))
    print(f"Sanskrit-looking blocks in transcript: {len(blocks)}")

    old_ix, new_ix = build(old_p), build(new_p)
    print(f"corpus old={len(old_ix)} new={len(new_ix)}\n")

    gained = changed = same = missed = 0
    for b in blocks:
        g = grams(b)
        ok, os_ = best(g, old_ix)
        nk, ns = best(g, new_ix)
        if ok == nk:
            if ok:
                same += 1
            else:
                missed += 1
            continue
        if ok is None and nk:
            gained += 1
            print(f"GAINED  {nk}  (score {ns:.2f})\n  garble: {b[:90]}")
        elif ok and nk is None:
            changed += 1
            print(f"LOST!!  had {ok} ({os_:.2f}) now none\n  garble: {b[:90]}")
        else:
            changed += 1
            print(f"CHANGED {ok} ({os_:.2f}) -> {nk} ({ns:.2f})  ** verify **\n  garble: {b[:90]}")

    print(f"\nunchanged-match: {same} | still-unmatched: {missed} | "
          f"NEWLY RECOVERED: {gained} | changed/lost: {changed}")
    print("verdict:", "REGRESSION — investigate" if changed else
          ("improvement" if gained else "no measurable change"))


if __name__ == "__main__":
    main()
