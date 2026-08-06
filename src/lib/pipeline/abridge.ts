/**
 * Abridge a Part 1 elaboration (or any first-person book-voice passage) to
 * a shorter length WITHOUT losing Mahārāja's voice. Never hand-edit this
 * text — see DECISIONS.md 2026-08-06 "Hard rule: never abridge/edit
 * book-voice text by hand." Manual cutting strips first-person reflective
 * transitions first (they read as removable filler) — but those
 * transitions ARE the voice. This step exists so shortening always goes
 * back through the model with that rule stated explicitly.
 */

import { anthropic, CLAUDE_MODEL } from "../clients";

const ABRIDGE_SYSTEM_PROMPT = `You are abridging a passage of first-person book prose that Niranjana Swami is writing himself — he is the author, this is his own voice, not a description of him. The source text may have NO section headers (just prose separated by "---" dividers) — your job includes adding them if so.

TASK:
1. Read through the source and identify its natural topical sections — group closely related material, don't force one section per verse/point number.
2. Give each section a short, descriptive, evocative title as a "### " heading — NOT a bare verse/text-number label like "### Text 11". Something like "The Sun Cannot Be Blocked" or "Nārada Changes His Approach" — a title that names the actual teaching or scene, the way a book chapter would. If the source already has "### " headers, keep them verbatim, in the same order — do not drop or replace them with "---" dividers alone.
3. Under each heading, write an ABRIDGED version of that section's content — roughly 50-60% of the original length — that keeps the same narrative flow and doctrinal content.

While abridging, you MUST preserve his voice, not just his facts:
- Keep his personal reflective transitions verbatim or near-verbatim: "I find it worth pausing here," "I am reminded here of," "I hold this analogy very close to heart," "I pray that," "What strikes me," etc. These ARE the voice — cutting them for brevity turns his writing into a third-person digest, which is the opposite of the goal.
- Cut supporting detail, secondary examples, and restatement — NOT the first-person connective tissue.
- Keep "I"/"we" framing throughout; never drift into describing him from outside.
- Keep quoted verses (Sanskrit + translation), at minimum the central ones.
- Keep the closing prayer/aspiration paragraph in full.

Return ONLY the abridged, headed text. No preamble, no meta-commentary about the task.`;

export async function abridge(sourceText: string): Promise<string> {
  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8_000,
    system: ABRIDGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: sourceText }],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = (block as { text?: string } | undefined)?.text;
  if (!text) throw new Error("Abridge step returned no text");
  return text;
}
