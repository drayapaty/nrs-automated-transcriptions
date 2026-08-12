# Summarize a lecture transcript

Generate an Evernote-style lecture summary from a cleaned/verse-restored transcript, then convert it to a matching Word document. Spec: `scripts/SUMMARY_PROMPT_V3.md` — a **fixed template** (pure numbered flow, no fixed section labels), not adaptive.

## Input

The user provides a path to a transcript `.md` file (typically `*_restored.md` or `*_cleaned.md`).

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Generate the summary:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/summarize-cli.ts "$INPUT"
   ```
   Use a 5-minute timeout. Output: `<input>_summary.md`.

3. Convert to Word:
   ```bash
   node scripts/summary-to-docx.js "<summary.md path>" "<same path with .md replaced by .docx>"
   ```

4. Report both output paths (`*_summary.md` and `*_summary.docx`) and timing. Do NOT comment on summary quality or lecture content.

## Notes

- Takes under 1 min for the summary, a few seconds for the docx conversion.
- Structure is a **fixed** pure-numbered-flow template (see `scripts/SUMMARY_PROMPT_V3.md`) — not adaptive per lecture. Section headings and nested-bullet formatting are enforced deterministically in `src/lib/pipeline/summarize.ts`, not left to prompt compliance alone.
