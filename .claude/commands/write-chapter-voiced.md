# Write book chapter material (Mahārāja's own voice)

Step 4 variant of the BB lecture workflow: same as `/write-chapter`, but written in first person as His Holiness Niranjana Swami's own authorial voice (he is writing the book himself), calibrated against the tone/delivery profile built from his *Collected Letters*.

`/write-chapter` (plain third-person book-author prose) is kept as a separate reference version — this is an alternative, not a replacement.

**UNVERIFIED against real book material** — no sample book pages were available to match against.

## Input

The user provides a path to a lecture summary `.md` file (typically `*_summary.md` from `/summarize`). Requires a matching `*_comparison.md` from `/compare` to already exist alongside it (or its path can be passed explicitly).

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Verify the comparison file exists. If not, tell the user to run `/compare` first.

3. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/write-chapter-voiced-cli.ts "$INPUT"
   ```
   Use a 3-minute timeout.

4. Report the output `*_chapter_voiced.md` file path and timing. Do NOT comment on the writing quality or lecture content.

## Notes

- First person mandatory — this is Mahārāja writing the book, not a description of his teaching from outside.
- Voice reference: `ask-niranjana-swami/content/ebooks/Niranjana-Swami-Letters-Tone-and-Delivery-Notes.md` (sibling repo) — that profile is letters-voice; this prompt adapts its signatures (humility, Prabhupāda-anchored authority, gentle qualifiers, reasoned patience) to chapter-writing register, not letter conventions.
- Deliberately avoids quoting Gopīparāṇadhana Dāsa's copyrighted translation/commentary text.
