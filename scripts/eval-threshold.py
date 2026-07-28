"""
Threshold sweep for the content-match RAG, on REAL lecture data.

Ground truth without hand-labelling: for each raw transcript we take the
matcher's top-1 corpus hit for every garbled Sanskrit run, then ask
whether that verse's canonical text actually appears in the *restored*
transcript (the output a human accepted). Verse present in the restored
file => the match is right. Not present => the match is a false positive.

That lets us plot precision/recall against the accept-threshold and see
whether 0.35 is leaving recoverable verses on the table (SB 6.17.28
scored 0.27 on the Hungary lecture — correct, and refused).

  python3 eval-threshold.py            # uses all raw/restored pairs found

Zero API calls.
"""

import glob
import json
import re
import unicodedata
from pathlib import Path

CORPUS = Path(__file__).parent.parent / "corpus.json"
DL = Path("/Users/divakar/Downloads")
STEPS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45]
COMMON_EN = re.compile(r"\b(the|and|of|that|this|is|are|was|were|we|you|to|in|it|he|she|his|her|so|but|for|with|as|on|at|by|from|they|there|then|which|who|what|all|not|be|have|has|had|will|would|can|could|about|when|because|our|their|one|also|very|like|just|know|now|said|says|says)\b", re.I)
IAST = set("āīūṛṝḷḹṭḍṇśṣṁṅñḥṃ")


def sd(s):
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def grams(s, n=3):
    t = re.sub(r"[^a-z0-9]", "", sd(s))
    return {t[i:i + n] for i in range(max(0, len(t) - n + 1))}


def entry_text(v):
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return v.get("verse") or v.get("text") or ""
    return ""


def build_index():
    d = json.loads(CORPUS.read_text(encoding="utf-8"))
    return [(k, entry_text(v), grams(entry_text(v)))
            for k, v in d.items()
            if not k.startswith("_") and len(entry_text(v)) >= 20]


def garble_runs(md: str):
    """Sequences of >=5 consecutive non-English-looking words inside prose."""
    for para in re.split(r"\n\s*\n", md):
        words = para.split()
        run = []
        for w in words:
            clean = re.sub(r"[^\w\-']", "", w)
            if not clean:
                continue
            english = COMMON_EN.fullmatch(clean) is not None
            exotic = any(c in IAST for c in clean) or "-" in clean or len(clean) > 11
            if english or (not exotic and clean.isalpha() and len(clean) <= 4):
                if len(run) >= 5:
                    yield " ".join(run)
                run = []
            else:
                run.append(clean)
        if len(run) >= 5:
            yield " ".join(run)


def top1(block, index):
    g = grams(block)
    if not g:
        return None, 0.0
    bk, bs = None, 0.0
    for k, t, gg in index:
        i = len(g & gg)
        if not i:
            continue
        s = i / len(g | gg)
        if s > bs:
            bk, bs = k, s
    return bk, bs


def main():
    index = build_index()
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    pairs = []
    for raw in sorted(glob.glob(str(DL / "*_raw.md"))):
        stem = Path(raw).name.replace("_raw.md", "")
        for cand in (DL / f"{stem}_restored.md", DL / f"{stem}_restored_v2.md"):
            if cand.exists():
                pairs.append((Path(raw), cand))
                break
    print(f"lecture pairs: {len(pairs)}  |  corpus entries: {len(index)}\n")

    rows = []   # (score, correct?)
    for raw_p, res_p in pairs:
        raw = raw_p.read_text(encoding="utf-8", errors="replace")
        res_norm = re.sub(r"[^a-z0-9]", "", sd(res_p.read_text(encoding="utf-8", errors="replace")))
        blocks = list(dict.fromkeys(garble_runs(raw)))
        hits = 0
        for b in blocks:
            k, s = top1(b, index)
            if not k or s < min(STEPS):
                continue
            vt = entry_text(corpus[k])
            probe = re.sub(r"[^a-z0-9]", "", sd(vt))[:40]
            correct = bool(probe) and probe in res_norm
            rows.append((s, correct, k, b[:60], raw_p.name))
            hits += 1
        print(f"  {raw_p.name:38} blocks={len(blocks):4} scored={hits}")

    print(f"\ncandidate matches scored: {len(rows)}\n")
    print(f"{'thresh':>7} {'accepted':>9} {'correct':>8} {'wrong':>6} {'precision':>10}")
    for t in STEPS:
        acc = [r for r in rows if r[0] >= t]
        ok = sum(1 for r in acc if r[1])
        wrong = len(acc) - ok
        prec = ok / len(acc) if acc else 0
        print(f"{t:7.2f} {len(acc):9} {ok:8} {wrong:6} {prec:10.0%}")

    print("\n-- matches in the 0.20-0.35 band (what 0.35 currently refuses) --")
    band = sorted([r for r in rows if 0.20 <= r[0] < 0.35], key=lambda r: -r[0])
    for s, correct, k, b, src in band[:15]:
        print(f"  {s:.2f} {'OK ' if correct else 'BAD'} {k:16} {b[:52]}  [{src[:22]}]")
    print(f"  band totals: {sum(1 for r in band if r[1])} correct / {len(band)} total")


if __name__ == "__main__":
    main()
