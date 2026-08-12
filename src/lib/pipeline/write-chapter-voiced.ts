/**
 * Step 4 (final step) of the BB lecture workflow: write book chapter
 * material in His Holiness Niranjana Swami's own voice, per the tone/delivery
 * profile built from his 5-volume Collected Letters To My Disciples.
 *
 * Reference: ask-niranjana-swami/content/ebooks/Niranjana-Swami-Letters-Tone-and-Delivery-Notes.md
 * (sibling repo — that profile is letters-voice, not lecture-book voice;
 * this prompt adapts its signatures to a teaching-chapter register rather
 * than copying it verbatim.)
 *
 * The only chapter-writing variant — per Divakar's explicit standing call
 * (2026-08-12): first-person voiced only, no third-person option kept even
 * for reference. The earlier plain third-person write-chapter.ts /
 * write-chapter-cli.ts / /nrs-write-chapter command / nrs-write-chapter
 * skill have all been removed entirely, not just deprioritized.
 */

import { anthropic, CLAUDE_MODEL } from "../clients";

const VOICED_INTRO = `You are drafting material for a book chapter that His Holiness Niranjana Swami is writing himself, in his own voice, first person. He is the author. This is not a book *about* him or *describing* his teaching from outside — it is HIM writing, in print, the way he taught it in class. Every sentence should be plausible as something he typed or dictated himself.`;

function buildVoicedPrompt(hasComparison: boolean): string {
  const inputDescription = hasComparison
    ? `You will be given:
1. A structured summary of the lecture
2. A list of points from the lecture that go beyond what's covered in the standard published commentary (these deserve special emphasis and full development — they are what make this lecture's material distinctive)`
    : `You will be given a structured summary of the lecture — a topical talk (not verse-by-verse Bṛhad-bhāgavatāmṛta commentary; e.g. a festival talk, book distribution talk, or general Q&A), so there is no published commentary to compare against. Write the full chapter from the summary directly.`;

  const structureLine = hasComparison
    ? "STRUCTURE — same as any chapter: full narrative prose, not bullet points or lecture-note subheadings. Present the verse(s), their meaning, and the teaching as continuous narrative. Weave the distinctive points (list #2 above) fully into that narrative — they are the material's main value, not an afterthought."
    : "STRUCTURE — same as any chapter: full narrative prose, not bullet points or lecture-note subheadings. Present the topic(s), their meaning, and the teaching as continuous narrative.";

  return `${VOICED_INTRO}

${inputDescription}

FIRST PERSON IS MANDATORY. Write as "I," not "Mahārāja teaches," not "he shows us," not "Śrīla Sanātana Gosvāmī shows us" in a third-person describing way. Examples of the register to hit:
- "When I first came to this verse, I could not help but notice..."
- "I have often reflected on why Śrīla Sanātana Gosvāmī places this here..."
- "Let us consider what Jaimini Ṛṣi's qualification means for us..."
- "I am reminded, whenever I read this passage, of..."
He may still refer to "Śrīla Sanātana Gosvāmī" and quote him respectfully in third person as the source text's author — that's correct, since NRS is commenting ON Sanātana Gosvāmī's work. What must NOT happen is NRS's own voice/commentary being rendered as "the speaker" or "Mahārāja" in third person — that breaks the premise that he is the author holding the pen.

VOICE — calibrated from a documented profile of his actual writing (his Collected Letters, 5 volumes). Signatures to carry into this first-person chapter-writing context:

- **Humility as a constant undertone.** He positions himself as a fellow servant and debtor of Śrīla Prabhupāda, never as an independent authority. Avoid framing that sounds like scholarly pronouncement from above ("this passage reveals," "one may observe that..."). Prefer: "Śrīla Prabhupāda has shown us...," "I take shelter of what Śrīla Sanātana Gosvāmī teaches here...".
- **"We/us" for the shared devotional situation**, alongside first-person "I" for his own reflection — "I have found," but also "this is meant to help us," "we struggle with this."
- **Anchor every point in authority, not bare personal assertion.** Substantive claims trace to Prabhupāda's purports/letters, a śāstric verse, or a lived example — introduced as received wisdom he is passing on, even when he's the one explaining it.
- **Gentle qualifiers.** "somehow or other," "to some degree," "in some way," "for whatever reason" — soften claims, leave room, avoid absolutist phrasing.
- **Reasoned patience.** Explain *why*, walk through logic step by step, and anticipate the reader's likely resistance or doubt before it's raised.
- **Warm and encouraging, even when the content is demanding or corrective.** Meet difficulty with reassurance, not pressure. Normalize struggle as part of progress rather than a failure.
- **Restate before explaining.** Before unpacking a verse or point, briefly restate in plain terms what it establishes.
- **Understatement and light self-directed humility**, used sparingly — an honest, modest register ("this humble attempt to convey...", "I don't claim any great qualification to speak on this, but...").
- **A closing turn toward prayer or aspiration** at the end of a substantial passage or the chapter as a whole — handing the outcome to Kṛṣṇa/Prabhupāda rather than closing on his own authority.

Do NOT literally reuse his letter formulae (no "Please accept my blessings," no "Your well-wisher" sign-off — those are letter conventions, not book-chapter conventions). Adapt the underlying voice qualities, not the literal furniture of a letter — and remember the letters profile is a reference for tone only; this is chapter prose, first person, not a letter.

${structureLine}

CONTENT RULES:
- Do NOT quote or closely paraphrase any specific translation wording or commentary prose from a third-party published source — write independent prose based on what Mahārāja himself said.
- IAST diacritics throughout: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc.
- Bold key Sanskrit terms on first use.
- Include quoted verses (Sanskrit + translation) where the lecture material provides them, set off as block quotes.
- No lecture-note artifacts like "the speaker says" or "in this class."

Return ONLY the chapter prose. No preamble, no meta-commentary about the task.`;
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// The prompt already explicitly bans this ("No lecture-note artifacts like
// 'the speaker says' or 'in this class'") — prompt-only compliance isn't
// reliable, same failure class as summarize.ts's banned-label bug. Confirmed
// 2026-08-12 with real phrasings slipping through across several chapters —
// "this class" / "the class I had prepared" in one, "our previous session" /
// "this session" in another, then even after stripping the explicit word,
// "When we left off, we..." still implicitly puts the reader live in the
// room with him. A regex list can never enumerate every way a model might
// imply that shared real-time presence — this is a semantic/meaning
// problem, not a fixed-string one, so detection AND correction both go
// through Haiku in a single whole-chapter pass instead of trying to
// pattern-match it deterministically first.
async function fixLectureNoteArtifacts(text: string): Promise<string> {
  try {
    const response = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 8_000,
      system:
        "This is a first-person book chapter written by a spiritual teacher who is the book's author — it is book prose, not lecture notes or a transcript. The reader is not physically present with him; he is writing for someone reading the finished book later, not addressing a live room. Find every place where the text implies the reader was live and present with him at a spoken gathering — not just explicit words like \"class\"/\"session\"/\"talk,\" but ALSO subtler phrasing like \"when we left off,\" \"as we were saying,\" \"we ended there last time,\" or anything else that presumes the reader shared a real-time moment with him rather than reading a written chapter — and rewrite ONLY those specific spots into book-appropriate narrative continuity (e.g. referring back to what the chapter itself established, not to a shared live moment), while preserving the exact same meaning, voice, and every other word of the rest of the text unchanged. If there are no such spots, return the text completely unchanged. Return ONLY the full corrected chapter text, no preamble, no explanation of what you changed.",
      messages: [{ role: "user", content: text }],
    });
    const block = response.content.find((b) => b.type === "text");
    const fixed = (block as { text?: string } | undefined)?.text?.trim();
    return fixed || text;
  } catch {
    return text;
  }
}

export async function writeChapterVoiced(
  lectureSummary: string,
  uniqueInsights?: string
): Promise<string> {
  const hasComparison = typeof uniqueInsights === "string" && uniqueInsights.trim().length > 0;
  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8_000,
    system: buildVoicedPrompt(hasComparison),
    messages: [
      {
        role: "user",
        content: hasComparison
          ? `LECTURE SUMMARY:\n${lectureSummary}\n\n---\n\nDISTINCTIVE POINTS (not in the standard published commentary — develop these fully):\n${uniqueInsights}`
          : `LECTURE SUMMARY:\n${lectureSummary}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = (block as { text?: string } | undefined)?.text;
  if (!text) throw new Error("Voiced chapter writing returned no text");
  return fixLectureNoteArtifacts(text);
}
