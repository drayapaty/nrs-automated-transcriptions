#!/usr/bin/env python3
"""
Fix auto-fixable review findings across restored BB transcript files.

Fixes applied:
1. "Śīla " → "Śrīla " (missing 'r' in honorific)
2. "dhānyā" → "dāinyā" (grain→humility in dainya lectures)
3. Duplicate greeting: "Prabhupāda.Glory to Śrīla Prabhupāda" → "Prabhupāda."
4. "cowherd boyfriend" → "cowherd-boy friend"
5. Missing space after period before next sentence
6. CC Antya-līlā 5.10 → SB 1.2.8 (wrong verse ref)
7. "covered boys" → "cowherd boys"
8. SB ref spacing: "(SB 1 2.17)" → "(SB 1.2.17)"
9. "Nara Nārāyaṇī" → "Nārada Muni"
10. "Gopī-pāraṇīdhara" → "Gopīparāṇadhana"

Usage:
  python3 scripts/fix-review-findings.py <directory>
"""
import os
import re
import sys


def fix_file(path):
    with open(path, "r") as f:
        text = f.read()
    original = text
    fixes = []

    # 1. Śīla → Śrīla (only when followed by space or consonant, not mid-word)
    count = len(re.findall(r'Śīla\b', text))
    if count:
        text = re.sub(r'Śīla\b', 'Śrīla', text)
        fixes.append(f"Śīla→Śrīla ×{count}")

    # 2. dhānyā → dāinyā (in dainya-related files)
    if 'dainya' in path.lower() or 'dāinyā' in text or 'dhānyā' in text:
        count = text.count('dhānyā')
        if count:
            text = text.replace('dhānyā', 'dāinyā')
            fixes.append(f"dhānyā→dāinyā ×{count}")

    # 3. Duplicate greeting patterns
    # "Prabhupāda.Glory to Śrīla Prabhupāda" → "Prabhupāda."
    pat = r'Prabhupāda\.Glory to Śrīla Prabhupāda\.?'
    count = len(re.findall(pat, text))
    if count:
        text = re.sub(pat, 'Prabhupāda.', text)
        fixes.append(f"removed duplicate 'Glory to Śrīla Prabhupāda' ×{count}")

    # "Prabhupāda.Glories to Śrīla Prabhupāda" variant
    pat2 = r'Prabhupāda\.Glories to Śrīla Prabhupāda\.?'
    count = len(re.findall(pat2, text))
    if count:
        text = re.sub(pat2, 'Prabhupāda.', text)
        fixes.append(f"removed duplicate 'Glories to Śrīla Prabhupāda' ×{count}")

    # 4. cowherd boyfriend → cowherd-boy friend
    count = text.count('cowherd boyfriend')
    if count:
        text = text.replace('cowherd boyfriend', 'cowherd-boy friend')
        fixes.append(f"cowherd boyfriend→cowherd-boy friend ×{count}")

    # 5. Missing space: "Prabhupāda.So" etc (but not before "Glory"/"Glories" which was handled above)
    pat3 = r'Prabhupāda\.([A-Z])'
    matches = re.findall(pat3, text)
    if matches:
        text = re.sub(pat3, r'Prabhupāda. \1', text)
        fixes.append(f"added missing space after 'Prabhupāda.' ×{len(matches)}")

    # 6. Wrong verse reference
    if 'CC Antya-līlā 5.10' in text:
        text = text.replace('CC Antya-līlā 5.10', 'SB 1.2.8')
        fixes.append("CC Antya-līlā 5.10→SB 1.2.8")
    if '(CC Antya-lila 5.10)' in text:
        text = text.replace('(CC Antya-lila 5.10)', '(SB 1.2.8)')
        fixes.append("(CC Antya-lila 5.10)→(SB 1.2.8)")

    # 7. covered boys → cowherd boys
    count = text.count('covered boys')
    if count:
        text = text.replace('covered boys', 'cowherd boys')
        fixes.append(f"covered boys→cowherd boys ×{count}")

    # 8. SB ref spacing: "(SB 1 2.17)" → "(SB 1.2.17)"
    pat4 = r'\(SB (\d+) (\d+\.\d+)\)'
    matches = re.findall(pat4, text)
    if matches:
        text = re.sub(pat4, r'(SB \1.\2)', text)
        fixes.append(f"fixed SB ref spacing ×{len(matches)}")

    # 9. Wrong names
    if 'Nara Nārāyaṇī' in text:
        count = text.count('Nara Nārāyaṇī')
        text = text.replace('Nara Nārāyaṇī', 'Nārada Muni')
        fixes.append(f"Nara Nārāyaṇī→Nārada Muni ×{count}")

    if 'Gopī-pāraṇīdhara' in text:
        text = text.replace('Gopī-pāraṇīdhara', 'Gopīparāṇadhana')
        fixes.append("Gopī-pāraṇīdhara→Gopīparāṇadhana")

    # 10. "dīnya" → "dainya" (wrong vowel)
    if 'dīnya' in text:
        count = text.count('dīnya')
        text = text.replace('dīnya', 'dainya')
        fixes.append(f"dīnya→dainya ×{count}")

    if text != original:
        with open(path, "w") as f:
            f.write(text)

    return fixes


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    directory = sys.argv[1]
    restored_dir = os.path.join(directory, "restored")

    if os.path.isdir(restored_dir):
        scan_dir = restored_dir
    else:
        scan_dir = directory

    files = sorted(f for f in os.listdir(scan_dir) if f.endswith("_restored.md"))
    print(f"Scanning {len(files)} restored files in {scan_dir}\n")

    total_fixes = 0
    files_fixed = 0
    for fname in files:
        path = os.path.join(scan_dir, fname)
        fixes = fix_file(path)
        if fixes:
            files_fixed += 1
            total_fixes += len(fixes)
            print(f"  {fname}:")
            for fix in fixes:
                print(f"    - {fix}")
        else:
            print(f"  {fname}: no auto-fixes")

    # Also fix cleaned files
    cleaned_files = sorted(f for f in os.listdir(scan_dir if scan_dir == directory else directory)
                          if f.endswith("_cleaned.md"))
    clean_dir = directory if scan_dir != directory else scan_dir
    if cleaned_files:
        print(f"\nAlso fixing {len(cleaned_files)} cleaned files...")
        for fname in cleaned_files:
            path = os.path.join(clean_dir, fname)
            if os.path.exists(path):
                fixes = fix_file(path)
                if fixes:
                    total_fixes += len(fixes)
                    print(f"  {fname}: {len(fixes)} fixes")

    print(f"\nDone: {total_fixes} fixes across {files_fixed} restored files")


if __name__ == "__main__":
    main()
