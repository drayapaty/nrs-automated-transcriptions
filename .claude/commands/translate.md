# Translate a transcript to Russian

Translate an English transcript to Russian using Claude with Gaudiya Vaishnava conventions.

## Input

The user provides a path to an English transcript `.md` file (typically `*_restored.md` or `*_cleaned.md`).

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/translate-cli.ts "$INPUT" ru
   ```
   Use a 15-minute timeout.

3. Report the output `*_ru.md` file path and timing. Do NOT comment on translation quality or content.

## Notes

- Takes 1-3 min per transcript.
- Russian style rules: Cyrillicize ALL Sanskrit (Кришна not Krishna), devotional register, «мысли с собой» for takeaways.
