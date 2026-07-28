# Lecture Summary Generation Spec

## When to use
After a lecture transcript has been cleaned (Sonnet cleanup) and verse-restored, generate a structured summary for devotees.

## Model
`claude-sonnet-4-5` (or latest Sonnet)

## Structure (hybrid: Evernote verse-by-verse + deep citation)

```
# Lecture Summary: [Scripture], [Volume/Chapter], Texts [N-M]

**Lecture by:** His Holiness Niranjana Swami
**Location:** [location]
**Date:** [date]

## What This Summary Covers
[1-2 sentence overview of lecture scope, key themes, key terms bolded on first use]

---

## Review of Previous Class and Administrative Announcements
- Bullet points recapping what was discussed last time
- Any practical announcements (summaries on website, etc.)

---

## Text N: [Descriptive Title]

### Verse Translation
*[Sanskrit if available]*
"[English translation]"

### Core Point
- Key bullet points of what the verse establishes

### Speaker's Explanation
- Sub-bullets with **bold labels** for sub-topics
- Include Sanskrit terms with IAST diacritics, bolded on first use

### Commentary Themes Explained in the Lecture
- What the commentary adds beyond the verse

### Related Narrative Reference (if applicable)
- Cross-references to other texts (Gopa-kumāra journey, etc.)

[Repeat for each verse...]

---

## Ending of the Lecture
- Philosophical conclusion
- Announcements for next class
- Congregational chanting noted

---

## Key Takeaways (Themes)
**1. [Bold theme label]:** 1-2 sentence summary with Sanskrit terms
**2. [Bold theme label]:** ...
[Typically 5-6 takeaways]
```

## Formatting rules

1. **IAST diacritics always**: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc.
2. **Bold key Sanskrit terms on first use**: nitya-mukta, Śiva-tattva, guṇa-avatāra, parama-puruṣārtha, sādhu-bhūṣaṇam, yukta-vairāgya, etc.
3. **Include all quoted verses**: SB references, Padma Purāṇa, BG, praṇāma verses — both Sanskrit and English
4. **Bullet points** for scannability, not prose paragraphs
5. **Sub-bullets with bold labels** for grouping related points under a verse
6. **Horizontal rules** (---) between major sections
7. Key Takeaways section at end — each with bold numbered label and 1-2 sentence synthesis

## System prompt for Sonnet

```
You are summarizing a lecture by His Holiness Niranjana Swami on Bṛhad-bhāgavatāmṛta (or other scripture as applicable).

Create a detailed, structured summary following the template provided. Rules:
- Organize by verse number (Text 81, Text 82, etc.) with sub-sections: "Core point", "Speaker's explanation", "Commentary themes"
- Use bullet points for scannability
- Include ALL Sanskrit citations and quoted verses (both Sanskrit and English translation)
- Bold key Sanskrit terms on first use
- Maintain proper IAST diacritics throughout
- Capture philosophical points, not just narrative
- Note practical takeaways and connections to devotional life
- End with "Key Takeaways (themes)" section: 5-6 bold-labeled bullet points synthesizing the main themes
- Include verse translations verbatim from the transcript
- Note cross-references to other scriptures (SB, BG, Padma Purāṇa, etc.)

The summary should be comprehensive enough that someone who missed the class can understand all key points discussed.
```

## Pipeline

1. Transcribe (Groq Whisper chunked or local whisper-cpp fallback)
2. Sonnet cleanup (punctuation, IAST, paragraphing)
3. Verse-restore (auto-restore Sanskrit verses from corpus)
4. **Summary generation** (this spec)
5. Russian translation (translate-summary.ts with v3 RUSSIAN_PROMPT)
