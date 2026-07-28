"""
Add Śikṣāṣṭaka 1-8 as corpus keys — NOT new text, aliases of verses we
already hold.

Mahāprabhu's eight verses are quoted in nearly every lecture but had no
`Śikṣāṣṭaka N` key, so a garble could only match if the speaker happened
to say the CC reference. The text itself is already in the corpus as
CC Antya-līlā 20.12/16/21/29/32/36/39/47 (Prabhupāda's BBT edition).

So this copies that exact text under Śikṣāṣṭaka keys. Nothing is typed
from memory; nothing is overwritten; the CC entries stay untouched.

Per DECISIONS.md 2026-07-28 a corpus write needs explicit permission —
default is --dry-run.

  python3 scripts/add-siksastaka.py --dry-run
  python3 scripts/add-siksastaka.py --write
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

CORPUS = Path(__file__).parent.parent / "corpus.json"
WRITE = "--write" in sys.argv

# verse number -> (source key already in the corpus, expected opening words)
SOURCES = {
    1: ("CC Antya-līlā 20.12", "ceto-darpaṇa-mārjanaṁ"),
    2: ("CC Antya-līlā 20.16", "nāmnām akāri bahudhā"),
    3: ("CC Antya-līlā 20.21", "tṛṇād api su-nīcena"),
    4: ("CC Antya-līlā 20.29", "na dhanaṁ na janaṁ na sundarīṁ"),
    5: ("CC Antya-līlā 20.32", "ayi nanda-tanuja kiṅkaraṁ"),
    6: ("CC Antya-līlā 20.36", "nayanaṁ galad-aśru-dhārayā"),
    7: ("CC Antya-līlā 20.39", "yugāyitaṁ nimeṣeṇa"),
    8: ("CC Antya-līlā 20.47", "āśliṣya vā pāda-ratāṁ"),
}


def fold(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s)


def main():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    planned, problems = {}, []

    for n, (src_key, opening) in SOURCES.items():
        key = f"Śikṣāṣṭaka {n}"
        if src_key not in corpus:
            problems.append(f"{key}: source {src_key!r} missing from corpus")
            continue
        src = corpus[src_key]
        text = src if isinstance(src, str) else (src.get("text") or src.get("verse") or "")
        if not text:
            problems.append(f"{key}: source {src_key} has no text")
            continue
        # guard: the source must really open with this verse
        if not fold(text).startswith(fold(opening)):
            problems.append(f"{key}: {src_key} does not open with {opening!r} — got {text[:40]!r}")
            continue
        if key in corpus:
            problems.append(f"{key}: already present — refusing to overwrite")
            continue
        entry = {"reference": key, "text": text,
                 "source": f"alias of {src_key} (Prabhupāda BBT edition)"}
        tr = src.get("translation") if isinstance(src, dict) else None
        if tr:
            entry["translation"] = tr
        planned[key] = entry

    for p in problems:
        print(f"  PROBLEM  {p}")
    print(f"\n{'WRITING' if WRITE else 'DRY RUN'} — {len(planned)}/8 verses ready")
    for k, v in planned.items():
        print(f"  {k:16} <- {v['source'][9:31]:24} {v['text'][:44].replace(chr(10), ' / ')}")

    if problems:
        sys.exit("\nrefusing to write: resolve problems above first")
    if WRITE:
        corpus.update(planned)
        CORPUS.write_text(json.dumps(corpus, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"\nwritten. corpus now {len([k for k in corpus if not k.startswith('_')])} entries")
    else:
        print("\nno changes made (pass --write, and only with explicit permission)")


if __name__ == "__main__":
    main()
