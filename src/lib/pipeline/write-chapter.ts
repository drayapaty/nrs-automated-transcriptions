/**
 * Step 4 of the BB lecture workflow: write book chapter material.
 *
 * Combines the lecture summary (step 2) and the comparative-analysis unique
 * points (step 3) into flowing prose suitable as draft material for a book
 * chapter on His Holiness Niranjana Swami's Bṛhad-bhāgavatāmṛta teachings.
 *
 * Deliberately does NOT quote Gopīparāṇadhana Dāsa's translation/commentary
 * text — the comparison step already filtered to lecture-original content;
 * this step writes independent prose based on Mahārāja's own words, not a
 * derivative of the copyrighted commentary.
 *
 * UNVERIFIED AGAINST REAL BOOK MATERIAL — no sample chapter pages were
 * available when this was written (unlike summarize.ts, which was built from
 * 4 real Evernote samples). Review the first output against actual book
 * style before relying on this for real production material.
 */

import { anthropic, CLAUDE_MODEL } from "../clients";

const WRITE_CHAPTER_SYSTEM_PROMPT = `You are drafting material for a book chapter based on a lecture by His Holiness Niranjana Swami on Śrīla Sanātana Gosvāmī's Bṛhad-bhāgavatāmṛta.

You will be given:
1. A structured summary of the lecture
2. A list of points from the lecture that go beyond what's covered in the standard published commentary (these deserve special emphasis and full development — they are what make this lecture's material distinctive)

Write flowing narrative prose — full paragraphs, not bullet points or headers-and-bullets — in the voice of a published spiritual commentary book chapter. Present the verse(s) discussed, their meaning, and Mahārāja's explanation as a continuous narrative, the way a reader would encounter it in a finished book, not as lecture notes.

Rules:
- Full prose paragraphs. No bullet lists, no "Core point" / "Speaker's explanation" style subheadings from the source summary — synthesize those into narrative.
- Weave the distinctive points (list #2 above) into the narrative naturally, giving them real development and space — they are the material's main value, not an afterthought.
- Do NOT quote or closely paraphrase any specific translation wording or commentary prose from a third-party published source — write independent prose based on what Mahārāja himself said, in Sanskrit terms and general Vaiṣṇava sense, not by leaning on someone else's copyrighted phrasing.
- IAST diacritics throughout: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc.
- Bold key Sanskrit terms on first use.
- Include quoted verses (Sanskrit + translation) where the lecture material provides them, set off as block quotes.
- A short chapter-opening paragraph may orient the reader (what's being discussed, continuity from before) before moving into the substance.
- Write as continuous chapter prose — no lecture-note artifacts like "the speaker says" or "in this class" — write as a book author presenting the teaching directly, e.g. "Śrīla Sanātana Gosvāmī shows us..." or "Here we find..."

Return ONLY the chapter prose. No preamble, no meta-commentary about the task.`;

export async function writeChapter(
  lectureSummary: string,
  uniqueInsights: string
): Promise<string> {
  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8_000,
    system: WRITE_CHAPTER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `LECTURE SUMMARY:\n${lectureSummary}\n\n---\n\nDISTINCTIVE POINTS (not in the standard published commentary — develop these fully):\n${uniqueInsights}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = (block as { text?: string } | undefined)?.text;
  if (!text) throw new Error("Chapter writing returned no text");
  return text;
}
