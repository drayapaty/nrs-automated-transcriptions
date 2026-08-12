# Write book chapter material (Mahārāja's own voice)

Step 4 (final step) of the BB lecture workflow: written in first person as His Holiness Niranjana Swami's own authorial voice (he is writing the book himself), calibrated against the tone/delivery profile built from his *Collected Letters*.

**The only chapter-writing variant** — per Divakar's explicit standing call (2026-08-12): first-person voiced only, no third-person option kept even for reference. The earlier plain third-person variant (`/nrs-write-chapter`) has been removed entirely, not just deprioritized.

**UNVERIFIED against real book material** — no sample book pages were available to match against.

## Input

The user provides a path to a lecture summary `.md` file (typically `*_summary.md` from `/nrs-summarize`). A matching `*_comparison.md` from `/nrs-compare` is used if it exists alongside it (or its path can be passed explicitly) — but as of 2026-08-12 it's **optional**, not required: for topical/thematic talks with no BB verse anchor, this writes the chapter straight from the summary alone.

## Steps

1. Verify `.env.local` exists with `ANTHROPIC_API_KEY`.

2. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/write-chapter-voiced-cli.ts "$INPUT"
   ```
   Use a 3-minute timeout.

3. Report the output `*_chapter_voiced.md` file path and timing. Do NOT comment on the writing quality or lecture content.

## Notes

- First person mandatory — this is Mahārāja writing the book, not a description of his teaching from outside.
- Voice reference: `ask-niranjana-swami/content/ebooks/Niranjana-Swami-Letters-Tone-and-Delivery-Notes.md` (sibling repo) — that profile is letters-voice; this prompt adapts its signatures (humility, Prabhupāda-anchored authority, gentle qualifiers, reasoned patience) to chapter-writing register, not letter conventions.
- Deliberately avoids quoting Gopīparāṇadhana Dāsa's copyrighted translation/commentary text.
