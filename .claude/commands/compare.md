# Comparative analysis vs. Gopīparāṇadhana Dāsa's commentary

Step 3 of the BB lecture workflow: find points in NRS's lecture that aren't covered in Gopīparāṇadhana Dāsa's published Bṛhad-bhāgavatāmṛta Vol.1 translation+commentary.

## Input

The user provides a path to a lecture summary `.md` file (typically `*_summary.md` from `/summarize`).

Only applies to lectures that read through a sequential BB verse range (filenames like `..._bb_1_2_14_18_...`). Topical/thematic talks (no verse range in the filename) aren't supported by this step — say so and skip if the filename doesn't match.

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Verify the Gopīparāṇadhana Vol.1 source exists at `~/Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md`. If missing, tell the user.

3. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/compare-cli.ts "$INPUT"
   ```
   Use a 3-minute timeout. If the filename doesn't encode a verse range, pass it explicitly: `npx tsx scripts/compare-cli.ts "$INPUT" <part> <chapter> <verseStart> [verseEnd]`.

4. Report the output `*_comparison.md` file path and timing. Do NOT comment on the analysis quality or lecture content.

## Notes

- Only Vol.1 is supported — the library's Vol.2 file is Bhānu Svāmī's translation, not Gopīparāṇadhana's, and is out of scope for this comparison.
- The Gopīparāṇadhana source is BBT copyrighted text living outside the repo — never commit it or copy it into the repo.
