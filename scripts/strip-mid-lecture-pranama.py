#!/usr/bin/env python3
"""
Strip mid-lecture praṇāma blocks from cleaned/restored transcript files.
These are hallucinated by the cleanup LLM at chunk boundaries.

Usage:
  python3 scripts/strip-mid-lecture-pranama.py <directory> [file-base ...]
  python3 scripts/strip-mid-lecture-pranama.py ~/Downloads/bb-retranscribe 2023_03_09_bb_taiwan_p1

If no file bases given, scans all *_cleaned.md files in the directory.
"""
import re
import os
import sys

PRANAMA_PATTERNS = [
    "oṁ ajñāna-timirāndhasya",
    "cakṣur unmīlitaṁ yena",
    "nama oṁ viṣṇu-pādāya",
    "śrīmate bhaktivedānta",
    "namas te sārasvate deve",
    "nirviśeṣa-śūnyavādi",
    "mūkaṁ karoti vācālaṁ",
    "mukhaṁ karoti vācālaṁ",
    "mukāṁ karoti vācālaṁ",
    "yat-kṛpā tam ahaṁ vande",
]


def is_pranama_line(line):
    return any(p in line for p in PRANAMA_PATTERNS)


def find_first_english_line(lines):
    """Find first line that's clearly English prose (not prayer, not blank)."""
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if is_pranama_line(line):
            continue
        if any(x in stripped for x in [
            "Hare Kṛṣṇa", "śrī-kṛṣṇa-caitanya",
            "śrī-advaita gadādhara",
        ]):
            continue
        words = stripped.split()
        if len(words) >= 5 and any(c.isascii() and c.isalpha() for c in stripped[:20]):
            return i
    return 0


def strip_file(path):
    with open(path, "r") as f:
        lines = f.readlines()

    first_english = find_first_english_line(lines)

    new_lines = []
    removed = 0
    for i, line in enumerate(lines):
        if i > first_english and is_pranama_line(line.strip()):
            removed += 1
        else:
            new_lines.append(line)

    if removed > 0:
        text = "".join(new_lines)
        text = re.sub(r"\n{3,}", "\n\n", text)
        with open(path, "w") as f:
            f.write(text)
        print(f"  {os.path.basename(path)}: removed {removed} praṇāma lines (after line {first_english})")
    else:
        print(f"  {os.path.basename(path)}: clean")
    return removed


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    directory = sys.argv[1]
    bases = sys.argv[2:] if len(sys.argv) > 2 else None

    if bases is None:
        bases = sorted(set(
            f.replace("_cleaned.md", "")
            for f in os.listdir(directory)
            if f.endswith("_cleaned.md")
        ))

    total_removed = 0
    files_fixed = 0
    for base in bases:
        print(f"{base}:")
        for suffix in ["_cleaned.md", "_restored.md"]:
            path = os.path.join(directory, base + suffix)
            if os.path.exists(path):
                r = strip_file(path)
                if r > 0:
                    total_removed += r
                    files_fixed += 1

    print(f"\nDone: {total_removed} praṇāma lines removed from {files_fixed} files")


if __name__ == "__main__":
    main()
