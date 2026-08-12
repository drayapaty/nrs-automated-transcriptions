#!/usr/bin/env python3
"""
Thorough audit of all 35 signed-off BB lecture folders: checks every
expected output file exists, is non-empty, and doesn't contain obvious
error/failure markers. Reports per-lecture status and a summary.
"""
import os
import re
import json

BB_DIR = "/Users/divakar/Downloads/bb-book-chapters-2026-08-05"

# The 4 that structurally can't have compare/elaborate (no verse match)
NO_VERSE_MATCH = {
    "2025_10_30_bb_is_sb",
    "2025_12_21_bb_book_dist",
    "2026_03_29_bb_budapest",
    "2026_04_01_radha_kunda_prakat_en_hu",
}

ERROR_MARKERS = [
    "Pipeline failed", "Comparative analysis failed", "Elaborate step failed",
    "TypeError", "ReferenceError", "undefined is not", "Cannot read propert",
    "Error:", "Usage: npx tsx",
]

def check_file(path, min_chars=100):
    if not os.path.exists(path):
        return {"exists": False}
    size = os.path.getsize(path)
    if size == 0:
        return {"exists": True, "empty": True}
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    errors = [m for m in ERROR_MARKERS if m in text]
    return {
        "exists": True,
        "empty": False,
        "chars": len(text),
        "too_short": len(text) < min_chars,
        "error_markers": errors,
    }

def main():
    slugs = sorted(
        d for d in os.listdir(BB_DIR)
        if os.path.isdir(os.path.join(BB_DIR, d)) and d != "2026_08_02_hungary_bb_1_3_1_10"
    )
    print(f"{len(slugs)} lecture folders\n")

    issues = []
    fully_complete = 0
    summary_only_ok = 0

    for slug in slugs:
        d = os.path.join(BB_DIR, slug)
        expect_full = slug not in NO_VERSE_MATCH

        checks = {
            "restored": check_file(os.path.join(d, f"{slug}_restored.md")),
            "cleaned": check_file(os.path.join(d, f"{slug}_cleaned.md")),
            "summary": check_file(os.path.join(d, f"{slug}_summary.md")),
        }
        if expect_full:
            checks["comparison"] = check_file(os.path.join(d, f"{slug}_comparison.md"))
            checks["elaborate"] = check_file(os.path.join(d, f"{slug}_summary_elaborate.md"))
            checks["part1"] = check_file(os.path.join(d, f"{slug}_summary_part-1.md"))
            checks["part2"] = check_file(os.path.join(d, f"{slug}_summary_part-2.md"))
            checks["part3"] = check_file(os.path.join(d, f"{slug}_summary_part-3.md"))
            checks["abridged"] = check_file(os.path.join(d, f"{slug}_summary_abridged_part1.md"))

        slug_issues = []
        for name, c in checks.items():
            if not c.get("exists"):
                slug_issues.append(f"{name} MISSING")
            elif c.get("empty"):
                slug_issues.append(f"{name} EMPTY")
            elif c.get("too_short"):
                slug_issues.append(f"{name} too short ({c['chars']} chars)")
            elif c.get("error_markers"):
                slug_issues.append(f"{name} contains error markers: {c['error_markers']}")

        if slug_issues:
            issues.append((slug, slug_issues))
            print(f"{slug.ljust(45)} -> ISSUES: {'; '.join(slug_issues)}")
        else:
            if expect_full:
                fully_complete += 1
                print(f"{slug.ljust(45)} -> OK (full pipeline)")
            else:
                summary_only_ok += 1
                print(f"{slug.ljust(45)} -> OK (summary-only, expected)")

    print(f"\n{'='*60}")
    print(f"Fully complete (summary+compare+elaborate): {fully_complete}/31 expected")
    print(f"Summary-only, correctly so: {summary_only_ok}/4 expected")
    print(f"Lectures with issues: {len(issues)}")
    if issues:
        print("\nDetail:")
        for slug, iss in issues:
            print(f"  {slug}: {iss}")

if __name__ == "__main__":
    main()
