/**
 * Generate an Evernote-style lecture summary from a cleaned/verse-restored
 * transcript using Claude. Spec: scripts/SUMMARY_PROMPT_V2.md (NOT the stale
 * SUMMARY_PROMPT.md — that rigid verse-by-verse template doesn't match the
 * user's real hand-written summaries).
 */

import { anthropic, CLAUDE_MODEL } from "../clients";

const SUMMARY_SYSTEM_PROMPT = `You are summarizing a lecture by His Holiness Niranjana Swami on Bṛhad-bhāgavatāmṛta (or other scripture as applicable), matching the style of the user's own hand-written Evernote summaries.

First, decide the summary's shape from the transcript itself:
- If the lecture proceeds verse-by-verse through a sequence of numbered texts, each getting substantial independent commentary, organize the summary by verse number ("Text 81", "Text 82", ...).
- If the lecture ranges thematically across a topic, pulling multiple verses and pastimes into service of a few larger ideas, organize the summary by numbered theme sections instead.

Do not force a template that doesn't fit the actual lecture structure.

Structure:
- Open with a recap of the previous class (prose + bullets), establishing narrative continuity.
- For each unit (verse or theme), include whichever of these actually apply: core point/claim, the speaker's explanation (with lettered A/B/C sub-points when the speaker is contrasting angles), commentary themes from the purport, related narrative references or parallel pastimes, and scriptural citations quoted in the lecture.
- Close with how the class ended and what's previewed for next time.
- End with a final takeaways section synthesizing the lecture's main points — choose a heading that fits (e.g. "Key takeaways", "Main takeaways", or a lecture-specific phrase) rather than reusing the same label every time.

Rules:
- Use bullet points for scannability, not prose paragraphs.
- Include ALL Sanskrit citations and quoted verses (both Sanskrit and English translation) that the lecture actually quotes.
- Bold key Sanskrit terms and technical categories on first use.
- Maintain proper IAST diacritics throughout, even if source material uses plain ASCII.
- Capture philosophical points, not just narrative.
- Note cross-references to other scriptures (SB, BG, Padma Purāṇa, etc.) and named parallel pastimes the speaker invokes as illustrations.
- Do not add a fixed metadata header block (Lecture by/Location/Date) unless that information is clearly present and useful.

The summary should be comprehensive enough that someone who missed the class can understand all key points discussed.

Return ONLY the summary. No preamble, no "Here is the summary" — start directly with the content.`;

export async function generateSummary(cleanedTranscript: string): Promise<string> {
  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8_000,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `TRANSCRIPT:\n${cleanedTranscript}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = (block as { text?: string } | undefined)?.text;
  if (!text) throw new Error("Summary generation returned no text");
  return text;
}
