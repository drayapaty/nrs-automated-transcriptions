# Lecture Summary Generation Spec (v3) — pure numbered flow

Supersedes `SUMMARY_PROMPT_V2.md` for actual use. Divakar's explicit
instruction, 2026-08-07: **no deviations from the template** — use one
consistent shape every time, learned from real Evernote AI-generated
summaries (not Mahārāja's hand-edited ones, which V2 was based on).

## Source

Four real Evernote AI Assistant summaries reviewed 2026-08-07, three of
them pasted directly by Divakar (not the possibly-edited files sitting in
`~/Downloads/bb-book-chapters-2026-08-05/`, which turned out to not match):
- BB Vol.1 Ch.1, Text 11 (Budapest, 2025-08-27) — 11 sections
- BB Vol.1 Ch.3, Texts 1–4, Śiva-loka (Hungary, 2026-08-02) — 13 sections,
  the true version (see `scripts/samples/2026-08-02-hungary-TRUE-evernote-summary.md`)
- BB Vol.1 Ch.3, Texts 11–16, same series (Hungary, 2026-08-06) — 13
  sections (see `scripts/samples/2026-08-06-hungary-TRUE-evernote-summary.md`)

All three independently converge on the same shape: **pure numbered flow**,
no fixed section labels anywhere. There is no "Context & aim," no "Recap of
the previous class," no "Reading:," no "Highlights from the commentary," no
"Illustrations used," no "Theme:". An earlier version of this spec was
built off a differently-structured file (with those fixed labels) that
turned out not to be the authentic Evernote shape — corrected once Divakar
pasted the real Aug 2 and Aug 6 summaries directly for comparison.

## Structure — pure numbered flow

- Break the class into as many numbered sections as its actual content
  naturally falls into (typically 8–13 for a full class). Each section gets
  its own short, plain, content-specific title — never "Theme," never a
  fixed label. **Every section title MUST be a markdown "## " heading**:
  - `## 1) Setting and continuity with the previous class`
  - `## 4) Commentary points: intimacy in devotion and ecstasy from "simple" offerings`
  - `## 8) Lord Śiva as the greatest Vaiṣṇava (distinct from Viṣṇu yet deeply devoted)`
  Caught 2026-08-07: the model was writing bare `1) Title` lines with no
  `## `, which a markdown renderer reads as an ordered-list item rather
  than a heading — it then nests underneath whatever bullet came before
  instead of standing as its own section, wrecking the document's
  indentation top to bottom. The `## ` is not optional.
- The opening greeting and previous-class recap belong inside section 1 —
  not split into a separate section.
- The verses read, the commentary Niranjana Swami draws from them, and the
  illustrations/examples he uses are woven together in whichever numbered
  section they actually occur in, in the order the class covers them — not
  separated into different boxes.
- When a numbered section has multiple distinct sub-points (several
  separate illustrations, or several supporting references), break those
  out as lettered sub-headings within that section, one heading level
  below the numbered section — `### A. ...`, `### B. ...`, `### C. ...`
  (same "must be a real heading" rule applies) — each followed by its own
  bullets. Real example (Aug 2, section 4): `### A. Fully realized
  Vaiṣṇavas have intimate relationships...`, `### B. The "simple offering"
  teaching (Bhagavad-gītā reference 9.26)`, `### C. Contrast with
  Satya-loka/Brahma-loka`.
- The final numbered section is the conclusion — how the class ended and
  what's previewed next time, as concretely as the transcript states it.
- Don't omit thin content — a brief beat still gets a short section or
  bullet, never silently dropped.

## Formatting rules

1. IAST diacritics always: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc.
2. Bold key Sanskrit terms and technical categories on first use.
3. English only for verses/citations — no Sanskrit/Devanagari/IAST verse
   blocks. Give the English translation or a close paraphrase of what the
   verse says, in quotation marks if presented as a direct quote. Caught
   2026-08-07: none of the real samples (Budapest, Aug 2, Aug 6) include
   Sanskrit verse text — Text N is always paraphrased/quoted in English
   only, IAST diacritics reserved for names/terms, not full verses.
4. Bullet points for scannability, not prose paragraphs — nested (indented)
   sub-bullets for grouping related points within a section, preserved
   exactly at whatever depth fits (don't flatten multi-level lists). Every
   nested sub-item MUST be its own markdown list line, formatted exactly as
   "  - ◦ text" (two-space indent, dash, space, hollow bullet ◦, space,
   text). Caught 2026-08-07 (round 1): the model was writing nested items
   as an indented line with NO dash, which markdown renders as a
   continuation of the parent bullet's paragraph instead of an actual
   separate line — the dash is required. **PERMANENT, reconfirmed
   2026-08-07 (round 3) after Divakar asked again explicitly**: nested
   items must use the hollow "◦" marker after the dash — "  - ◦ text",
   not plain "  - text". Round 2 had removed the ◦ on the reasoning that
   the renderer draws its own (filled) bullet and ◦ would duplicate it —
   Divakar re-requested it anyway and asked for a permanent note; the ◦
   stays regardless of that rendering tradeoff. Do not remove it again.
5. Direct speech / quoted phrases from the speaker in quotation marks,
   verbatim — don't paraphrase what's actually a quote.
6. Refer to him as "Niranjana Swami" throughout — not "the speaker," not
   "Mahārāja." (2026-08-07: Mahārāja himself confirmed — make it personal.
   Note: the real Evernote samples all say "the speaker" — this is a
   deliberate deviation from the real samples, per Mahārāja's own explicit
   instruction, not an oversight.)
7. No fixed metadata header block (no mandatory "Lecture by/Location/Date"
   box) — none of the real Evernote samples used one.
8. Omit generic boilerplate not specific to this lecture's actual content:
   no bullet noting that Bṛhad-bhāgavatāmṛta references are brief pointers
   to fuller Śrīmad-Bhāgavatam treatments (only include if the class makes
   a specific new point about it), and no bullet just listing the opening
   prayers offered (oṁ namo bhagavate vāsudevāya, guru-vandanā, Prabhupāda
   praṇāma-mantra, etc.) unless something about that moment is actually
   distinctive. Caught 2026-08-07 from a real render — these are ritual
   constants present in nearly every class and add no lecture-specific
   information; none of the real samples include them.

## System prompt for Sonnet

```
You are summarizing a lecture by His Holiness Niranjana Swami on Bṛhad-bhāgavatāmṛta
(or other scripture as applicable), matching the real Evernote AI Assistant
summary format exactly.

Structure: pure numbered flow, following the class's actual chronological
order. There are NO fixed section labels — no "Context & aim," no "Recap
of the previous class," no "Reading:," no "Highlights from the
commentary," no "Illustrations used," no "Theme:". Instead:

- Break the class into as many numbered sections as its actual content
  naturally falls into (typically 8-13 for a full class), each with its
  own short, plain, content-specific title describing what that section
  covers. EVERY numbered section title MUST be a markdown heading —
  "## 1) Setting and continuity with the previous class", "## 4)
  Commentary points: intimacy in devotion and ecstasy from 'simple'
  offerings", "## 8) Lord Śiva as the greatest Vaiṣṇava (distinct from
  Viṣṇu yet deeply devoted)". Never write a bare "1) Title" line with no
  "## " — without a heading marker it gets misread as an ordered-list item
  and nests underneath whatever came before instead of standing as its own
  section, breaking the whole document's indentation.
- The opening class-recap and greeting typically belong inside section 1,
  not a separate section.
- The reading of the verses, the commentary drawn from them, and the
  illustrations/examples used to support a point are NOT separated into
  different boxes — each appears inside whichever numbered section it
  naturally occurs in, in the order the class actually covers it.
- When a numbered section contains multiple distinct sub-points (e.g.
  several separate illustrations, or several supporting scriptural
  references), break those out as lettered sub-headings within that
  section, one heading level below the numbered section: "### A. ...",
  "### B. ...", "### C. ...", each followed by its own bullets. Same rule
  as above — these must be real "### " headings, not bare "A. Title" text
  lines.
- The final numbered section is the conclusion: how the class ended and
  what's previewed for next time, as concretely as the transcript states
  it.
- Do not omit thin content — if a beat is brief, give it a brief bullet or
  a short section, but do not skip it.

Formatting rules:
- Refer to him as "Niranjana Swami" throughout — not "the speaker," not
  "Mahārāja."
- IAST diacritics always: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc.,
  even if the source material uses plain ASCII.
- Bold key Sanskrit terms and technical categories on first use.
- English only for verses/citations — no Sanskrit/Devanagari/IAST verse
  blocks. Give the English translation or a close paraphrase of what the
  verse says, in quotation marks if presented as a direct quote.
- Bullet points for scannability, not prose paragraphs; nested sub-bullets
  within a section where helpful — preserve nesting exactly, don't flatten.
  Every nested sub-item MUST be its own markdown list line, formatted
  exactly as "  - ◦ text" (two-space indent, dash, space, hollow bullet ◦,
  space, text) — never just an indented line with no dash (renders as a
  continuation of the parent paragraph, not a separate line), and never
  drop the ◦ (this is a permanent rule — keep it even though the ◦ can
  visually double up with the renderer's own bullet in some viewers).
- Direct speech and quoted phrases from the speaker go in quotation marks,
  verbatim, exactly as said — don't paraphrase what's actually a quote.
- No fixed metadata header block (no "Lecture by/Location/Date" box).
- Omit generic boilerplate that isn't specific to this lecture's actual
  content: no bullet noting that Bṛhad-bhāgavatāmṛta references are brief
  pointers to fuller Śrīmad-Bhāgavatam treatments (only include this if the
  class makes a specific new point about it), and no bullet just listing
  the opening prayers offered (oṁ namo bhagavate vāsudevāya, guru-vandanā,
  Prabhupāda praṇāma-mantra, etc.) unless something about that moment is
  actually distinctive to this class. These are ritual constants present in
  nearly every class and add no lecture-specific information — none of the
  real samples include them.

The summary should be comprehensive enough that someone who missed the
class can understand all key points discussed.

Return ONLY the summary. No preamble, no "Here is the summary" — start
directly with section 1.
```

## Pipeline

1. Transcribe (Groq Whisper chunked, `transcribe-cli.ts`)
2. Sonnet cleanup (punctuation, IAST, paragraphing)
3. Verse-restore (auto-restore Sanskrit verses from corpus)
4. **Summary generation** (this spec — pure numbered flow)
5. Mahārāja edits the draft (Path 2, standing rule — see `DECISIONS.md`)
6. Russian translation, if needed (`translate-summary.ts`, v3 `RUSSIAN_PROMPT`)
