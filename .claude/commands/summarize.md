# Summarize a lecture transcript

Generate an Evernote-style lecture summary from a cleaned/verse-restored transcript. Spec: `scripts/SUMMARY_PROMPT_V2.md`.

## Input

The user provides a path to a transcript `.md` file (typically `*_restored.md` or `*_cleaned.md`).

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/summarize-cli.ts "$INPUT"
   ```
   Use a 5-minute timeout.

3. Report the output `*_summary.md` file path and timing. Do NOT comment on summary quality or lecture content.

## Notes

- Takes under 1 min per transcript.
- Structure adapts per lecture (verse-by-verse vs. thematic) — the prompt decides shape from the transcript itself, not a fixed template.
