# Graph Extraction Spec — for Kimi, not Claude

Separate from `SUMMARY_PROMPT_V3.md` (the editorial, human-readable summary
used for the website). This is a **second, parallel output** from the same
source transcript — structured data for the knowledge graph, not prose.

**Decision, 2026-08-07**: this step runs on Kimi, not Claude. Extraction is
lower-reasoning-burden than the editorial summary (closer to structured
information extraction than judgment/voice work), and Kimi already builds
the rest of the graph from books/transcripts/askacarya — keeping this on
Kimi avoids adding a second vendor into the graph pipeline. See
`~/.claude/projects/.../memory/nrs-knowledge-graph-plan.md` for the full
reasoning.

## Input

Same source as the editorial summary: the cleaned, verse-restored lecture
transcript (`*_restored.md`).

## Why a separate output at all

The editorial summary's section titles are freeform per lecture — "Lord
Śiva as the greatest Vaiṣṇava" today, "Śiva's position as the supreme
devotee" in another lecture, same underlying topic. A graph that links by
title text or keyword match treats those as different nodes. This
extraction step gives the graph a **canonical join key** instead of relying
on prose titles.

## Output schema

Return JSON only, this shape:

```json
{
  "lecture": {
    "date": "YYYY-MM-DD",
    "location": "string",
    "reference": "BB volume.chapter.text-range, e.g. 1.2.77-80",
    "source_type": "lecture"
  },
  "verses_discussed": [
    { "ref": "BB 1.2.80", "canonical_id": "bb-1-2-80" }
  ],
  "personalities": [
    { "name": "Śiva", "canonical_id": "shiva", "role_in_lecture": "subject of Brahmā's glorification" }
  ],
  "topics": [
    {
      "title_freeform": "the exact plain-language phrasing used in this lecture, for readability",
      "canonical_tag": "shiva-tattva",
      "centrality": "primary | secondary | mentioned",
      "summary_one_line": "one sentence, factual, no interpretation added"
    }
  ],
  "illustrations_pastimes_cited": [
    { "name": "Vṛkāsura pastime", "canonical_id": "vrkasura-pastime", "illustrates_topic": "shiva-tattva" }
  ],
  "cross_references": [
    { "type": "quotes", "target": "SB 10.88.38-39" },
    { "type": "relates_to_previous_lecture_topic", "target_canonical_id": "brahma-humility" }
  ]
}
```

## Canonical tag rules — the part that actually matters

- **`canonical_tag` values must be reused across lectures, not invented
  fresh each time.** Before assigning a new tag, check whether an existing
  tag in the graph already covers this concept (e.g. "Śiva as greatest
  Vaiṣṇava" and "Śiva's supreme devotional position" are the SAME tag:
  `shiva-tattva` or a narrower existing one — do not create
  `shiva-supreme-devotee` as a near-duplicate of an existing tag).
- Use lowercase-hyphenated slugs for every `canonical_id` /
  `canonical_tag` field (`shiva-tattva`, not `Shiva Tattva` or
  `ShivaTattva`) — consistent slugs are what makes graph joins work.
- IAST diacritics in every human-readable field (`title_freeform`,
  `name`, `role_in_lecture`, `summary_one_line`) — Kṛṣṇa not Krishna, Śiva
  not Shiva — but **plain ASCII in every `canonical_*` slug field** (no
  diacritics in IDs — `shiva-tattva`, not `śiva-tattva`). This split
  matters: diacritics in an ID field would fragment the same concept into
  multiple slug variants depending on keyboard/encoding.
- `centrality` is a judgment call — did the lecture spend real time
  developing this topic (`primary`), touch it as supporting context
  (`secondary`), or just name-drop it in passing (`mentioned`)? This is
  what lets a later query weight "lectures where he substantially
  addressed X" over "lectures that merely mentioned X."

## What NOT to do

- Don't write prose commentary, interpretation, or theological explanation
  — that's the editorial summary's job. `summary_one_line` is factual and
  terse, not devotional writing.
- Don't invent a `canonical_tag` per lecture — the whole point of this
  step is consistency across the corpus, not per-lecture accuracy.
- Don't skip a topic because it seems minor — `centrality: "mentioned"`
  exists precisely so thin coverage still gets a graph edge, just a
  lightly-weighted one.

## Pipeline

1. Transcribe (existing pipeline, unchanged)
2. Sonnet cleanup + verse-restore (existing pipeline, unchanged)
3. Editorial summary generation (Claude, `SUMMARY_PROMPT_V3.md`, unchanged)
4. **Graph extraction (this spec, Kimi)** — runs off the same restored
   transcript as step 3, independently, not derived from the editorial
   summary's output
5. Feed the structured JSON into the existing Kimi graph alongside the
   rest of the corpus (books, other transcripts, askacarya)

## Status

Design-stage only as of 2026-08-07. Not yet wired into any script in this
repo — no Kimi API integration exists here yet. This file exists so the
schema and canonical-tag reasoning are captured before implementation,
whenever that happens.
