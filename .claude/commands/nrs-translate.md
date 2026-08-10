# Translate a transcript to Russian

Translate an English transcript to Russian using Claude with Gaudiya Vaishnava conventions.

## Input

The user provides a path to an English transcript or summary file — either
`.md` (typically `*_restored.md`, `*_cleaned.md`, or a V3-format summary)
or `.docx`.

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/translate-cli.ts "$INPUT" ru
   ```
   Use a 15-minute timeout.

3. Report the output file path(s) and timing. Do NOT comment on translation quality or content.
   - `.md` input → `*_ru.md` only.
   - `.docx` input → both `*_ru.md` and `*_ru.docx` (formatting rebuilt to match, see Notes).

## Notes

- Takes 1-3 min per transcript.
- Russian style rules: Cyrillicize ALL Sanskrit (Кришна not Krishna), devotional register, «мысли с собой» for takeaways.
- `.docx` support (added 2026-08-07) is scoped to our own summary format —
  see DECISIONS.md "translate-cli.ts accepts .docx input" for exactly what
  it does and doesn't handle (not a general-purpose docx translator; no
  tables/images/footnotes/tracked-changes, only bold survives as
  formatting). Structure (headings, bullets) is preserved in code via
  `translateStructuredSummary()`, not left to the model — see the same
  DECISIONS.md entry for why that mattered.
