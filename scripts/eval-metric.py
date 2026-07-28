"""
Compare candidate match METRICS on real lecture garbles (2026-07-28).

Why: Jaccard on trigram sets punishes length mismatch, so a partial quote
scores low even when the correct verse ranks first. Measured: SB 6.17.28
scored 0.27 and BB 91 scored 0.25 — both CORRECT top-1, both refused by
the 0.40 gate. Śikṣāṣṭaka 1 scored 0.24 on half the verse, 0.84 on the
whole thing.

Metrics compared, all deterministic:
  jaccard      |A∩B| / |A∪B|              (current)
  containment  |A∩B| / |A|                (how much of the GARBLE is in the verse)
  dice         2|A∩B| / (|A|+|B|)
  lcs_ratio    longest-common-subsequence / len(garble)   (order-aware)

Reported per metric: whether the CORRECT verse is top-1, and its score —
so we can pick a metric + gate that accepts the known-good cases without
promoting the known-bad ones.

  python3 scripts/eval-metric.py

Read-only, no API calls.
"""

import json
import re
import unicodedata
from pathlib import Path

CORPUS = Path(__file__).parent.parent / "corpus.json"

# Real Whisper garbles with the verse they SHOULD match (ground truth from
# reading the lecture transcripts). "None" = must match nothing.
CASES = [
    ("nārāya nākparākṣave nākputas cañyabhībiti sva-gapāvāgandhārakṣa-tuttulāpitāśana", "SB 6 17.28"),
    ("par yeva d hale j hi tvayatne tatt param ca sm munai", "BB 91"),
    ("Gurum Pranam Yatam Gantum Kailāsaṃgīraṃ gud-sukha Alakṣyota Punasteṇa Svā-putra-putravatsale", "BB 92"),
    ("cheto darpana marjanam bhava maha davagni nirvapanam", "Śikṣāṣṭaka 1"),   # HALF the verse
    ("tṛṇādapi sunīcena tarur iva sahiṣṇunam amānina mānadeya kīrtanīyaṁ sadā hariḥ", "Śikṣāṣṭaka 3"),
    ("jñāna-timarāṇḍasya vinajana-salaḥkaya cakṣo unmerita", "Jñāna-cakṣur-praṇāma"),
    ("Mathe Bhaktivedanta Svāmī Nithināmane Namaste Sarasv", "Prabhupāda-praṇāma"),
    # negatives: ordinary English prose must not match anything
    ("And so the devotees were very much pleased to hear this wonderful pastime", None),
    ("He explained that one should not try to imitate great personalities", None),
]


def sd(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s)


def grams(s, n=3):
    t = sd(s)
    return {t[i:i + n] for i in range(max(0, len(t) - n + 1))}


def lcs_len(a, b):
    """O(len(a)*len(b)) LCS length, rolling row."""
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    for ca in a:
        cur = [0]
        for j, cb in enumerate(b):
            cur.append(prev[j] + 1 if ca == cb else max(cur[j], prev[j + 1]))
        prev = cur
    return prev[-1]


METRICS = {
    "jaccard":     lambda A, B, a, b: len(A & B) / len(A | B) if A and B else 0,
    "containment": lambda A, B, a, b: len(A & B) / len(A) if A else 0,
    "dice":        lambda A, B, a, b: 2 * len(A & B) / (len(A) + len(B)) if A and B else 0,
    "lcs_ratio":   lambda A, B, a, b: lcs_len(a[:400], b[:400]) / max(1, min(len(a), 400)),
}


def main():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    index = []
    for k, v in corpus.items():
        if k.startswith("_"):
            continue
        t = v if isinstance(v, str) else (v.get("text") or v.get("verse") or "")
        if len(t) >= 20:
            index.append((k, sd(t), grams(t)))
    print(f"corpus entries indexed: {len(index)}\n")

    for name, fn in METRICS.items():
        print(f"===== {name}")
        rows = []
        for garble, want in CASES:
            A, a = grams(garble), sd(garble)
            scored = []
            for k, b, B in index:
                s = fn(A, B, a, b)
                if s > 0:
                    scored.append((s, k))
            scored.sort(reverse=True)
            top = scored[0] if scored else (0.0, "-")
            runner = scored[1][0] if len(scored) > 1 else 0.0
            if want is None:
                verdict = "OK (nothing close)" if top[0] < 0.30 else f"RISK top={top[1]}"
            else:
                verdict = "top-1 CORRECT" if top[1] == want else f"top-1 WRONG ({top[1]})"
            rows.append((top[0], top[0] - runner, verdict, want or "(negative)", garble[:34]))
        for score, margin, verdict, want, g in rows:
            print(f"  {score:5.2f} margin{margin:+5.2f}  {verdict:24} {want:22} {g}")
        print()


if __name__ == "__main__":
    main()
