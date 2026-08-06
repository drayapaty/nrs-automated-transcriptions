# Write book chapter material

Step 4 (final step) of the BB lecture workflow: turn a lecture summary + comparative-analysis unique points into flowing prose draft material for a book chapter, based on His Holiness Niranjana Swami's teachings.

**UNVERIFIED against real book material** — built without sample book pages to match against (unlike `/nrs-summarize`, which was built from 4 real Evernote samples). Treat first outputs as a rough draft to review against actual book style, not production-ready.

## Input

The user provides a path to a lecture summary `.md` file (typically `*_summary.md` from `/nrs-summarize`). Requires a matching `*_comparison.md` from `/nrs-compare` to already exist alongside it (or its path can be passed explicitly).

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Verify the comparison file exists. If not, tell the user to run `/nrs-compare` first.

3. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/write-chapter-cli.ts "$INPUT"
   ```
   Use a 3-minute timeout.

4. Report the output `*_chapter.md` file path and timing. Do NOT comment on the writing quality or lecture content.

## Notes

- Output is prose, not bullets — meant to read like a finished chapter, not lecture notes.
- Deliberately avoids quoting Gopīparāṇadhana Dāsa's copyrighted translation/commentary text — writes independent prose based on Mahārāja's own words.
