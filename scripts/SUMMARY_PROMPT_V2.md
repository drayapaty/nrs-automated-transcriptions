# Lecture Summary Generation Spec (v2)

Supersedes `SUMMARY_PROMPT.md` for actual use. That file's rigid verse-by-verse
template does not match the real Evernote summaries the user produces by hand.
This spec is derived from 4 real samples (BB Vol.1 Ch.2-3, Śiva-tattva lectures,
2026-08). Kept alongside the old file rather than overwriting it — old file is
stale reference, not deleted.

## When to use

After a lecture transcript has been cleaned (Sonnet cleanup) and verse-restored,
generate a structured summary for devotees, matching the user's Evernote style.

## Model

`claude-sonnet-4-5` (or latest Sonnet)

## Core principle: structure follows the lecture, not a fixed template

The 4 real samples do NOT share one rigid skeleton. Two organize by theme
(numbered sections 1-N, each pulling in cross-references); one organizes strictly
by verse number (Text 81, Text 82, ... each with its own subsections). Which shape
fits depends on how the lecture itself was delivered:

- **Verse-by-verse** shape when the class reads and comments on a sequence of
  numbered verses in order, each getting substantial independent treatment.
- **Thematic** shape when the class ranges across a topic (e.g. "who is Śiva"),
  pulling multiple verses/pastimes into service of a few big ideas.

Decide which shape fits by looking at the actual transcript structure — don't
force one template onto both cases.

## Common elements (present in all 4 samples, in this order)

1. **Title** (optional but common) — short thematic phrase, e.g. "Śiva Tattva
   and Devotion to Krishna." Not always present; skip if nothing fits.

2. **Recap of the previous class** — prose + bullets, near the top. Summarizes
   where the narrative left off, referencing named characters/events, not just
   "last time we discussed X." Sets continuity before the new material starts.

3. **Body** — organized per the verse-by-verse or thematic shape (see above).
   Each unit (a verse, or a theme) draws on whichever of these actually apply
   in the lecture — do not force empty subsections:
   - **Core point / core claim** — what the verse or theme establishes, in bullets
   - **Speaker's explanation** — the lecturer's expansion, often with lettered
     sub-points (A/B/C) when contrasting multiple angles
   - **Commentary themes explained in the lecture** — what the purport/commentary
     adds beyond the bare verse
   - **Related narrative reference / supporting examples** — named parallel
     pastimes (e.g. Śuklāmbara Brahmacārī, Kolaveca Śrīdhara, Vṛkāsura), other
     scripture cross-references (SB canto/chapter, BG verse, Padma Purāṇa),
     Śrīla Prabhupāda purport citations
   - **Scriptural citation used** — when a specific verse is quoted in support

4. **Closing / transition** — how the lecture ended, and what's previewed for
   next class. Often explicit: "the speaker previews text N, where..."

5. **Takeaways** — a final bullet list synthesizing the lecture's main points.
   Heading wording varies across real samples ("Key takeaways (themes)",
   "Main takeaways (compressed)", "Overall 'through-line' of the lecture") —
   treat the heading as free-form, pick whatever best fits the lecture's content,
   don't hardcode one label. Bold-labeled bullets (`**Label:** sentence`) when
   the takeaway compresses to a single named theme; plain bullets when it's more
   narrative/summary.

## Formatting rules

1. **IAST diacritics always**: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc.
   (Note: real samples sometimes show ASCII "Krishna"/"Shiva" in titles/headers
   pulled from the source doc title — normalize to IAST in generated body text.)
2. Bold key Sanskrit terms and technical categories on first use (nitya-mukta,
   Śiva-tattva, guṇa-avatāra, parama-puruṣārtha, sādhu-bhūṣaṇam, etc.)
3. Include quoted verses/citations verbatim where the lecture quotes them
   (SB references, Padma Purāṇa, BG, praṇāma verses).
4. Bullet points for scannability, not prose paragraphs — nested sub-bullets
   for grouping related points under a numbered section or verse.
5. Numbered top-level sections when using the thematic shape; verse-number
   headers ("Text N ...") when using the verse-by-verse shape.
6. No fixed metadata header block (no mandatory "**Lecture by:**/Location/Date"
   box) — none of the 4 real samples used one. Add a title line only if a
   natural one fits.

## System prompt for Sonnet

```
You are summarizing a lecture by His Holiness Niranjana Swami on Bṛhad-bhāgavatāmṛta
(or other scripture as applicable), matching the style of the user's own
hand-written Evernote summaries.

First, decide the summary's shape from the transcript itself:
- If the lecture proceeds verse-by-verse through a sequence of numbered texts,
  each getting substantial independent commentary, organize the summary by
  verse number ("Text 81", "Text 82", ...).
- If the lecture ranges thematically across a topic, pulling multiple verses
  and pastimes into service of a few larger ideas, organize the summary by
  numbered theme sections instead.

Do not force a template that doesn't fit the actual lecture structure.

Structure:
- Open with a recap of the previous class (prose + bullets), establishing
  narrative continuity.
- For each unit (verse or theme), include whichever of these actually apply:
  core point/claim, the speaker's explanation (with lettered A/B/C sub-points
  when the speaker is contrasting angles), commentary themes from the purport,
  related narrative references or parallel pastimes, and scriptural citations
  quoted in the lecture.
- Close with how the class ended and what's previewed for next time.
- End with a final takeaways section synthesizing the lecture's main points —
  choose a heading that fits (e.g. "Key takeaways", "Main takeaways", or a
  lecture-specific phrase) rather than reusing the same label every time.

Rules:
- Use bullet points for scannability, not prose paragraphs.
- Include ALL Sanskrit citations and quoted verses (both Sanskrit and English
  translation) that the lecture actually quotes.
- Bold key Sanskrit terms and technical categories on first use.
- Maintain proper IAST diacritics throughout, even if source material uses
  plain ASCII.
- Capture philosophical points, not just narrative.
- Note cross-references to other scriptures (SB, BG, Padma Purāṇa, etc.) and
  named parallel pastimes the speaker invokes as illustrations.
- Do not add a fixed metadata header block (Lecture by/Location/Date) unless
  that information is clearly present and useful.

The summary should be comprehensive enough that someone who missed the class
can understand all key points discussed.
```

## Pipeline

1. Transcribe (Groq Whisper chunked or local whisper-cpp fallback)
2. Sonnet cleanup (punctuation, IAST, paragraphing)
3. Verse-restore (auto-restore Sanskrit verses from corpus)
4. **Summary generation** (this spec)
5. Russian translation (translate-summary.ts with v3 RUSSIAN_PROMPT)
