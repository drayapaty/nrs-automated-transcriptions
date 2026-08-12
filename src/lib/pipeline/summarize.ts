/**
 * Generate an Evernote-style lecture summary from a cleaned/verse-restored
 * transcript using Claude. Spec: scripts/SUMMARY_PROMPT_V3.md — a FIXED
 * template (no per-lecture shape adaptation), learned from two real
 * Evernote AI Assistant summaries (2026-08-07). Supersedes
 * SUMMARY_PROMPT_V2.md's adaptive-shape approach per Divakar's explicit
 * instruction: "no deviations from the template."
 */

import { anthropic, CLAUDE_MODEL } from "../clients";

const SUMMARY_SYSTEM_PROMPT = `You are summarizing a lecture by His Holiness Niranjana Swami on Bṛhad-bhāgavatāmṛta (or other scripture as applicable), matching the real Evernote AI Assistant summary format exactly.

Structure: pure numbered flow, following the class's actual chronological order. There are NO fixed section labels — no "Context & aim," no "Recap of the previous class," no "Reading:," no "Highlights from the commentary," no "Illustrations used," no "Theme:". Instead:

- Break the class into as many numbered sections as its actual content naturally falls into (typically 8-13 for a full class), each with its own short, plain, content-specific title describing what that section covers. EVERY numbered section title MUST be a markdown heading — "## 1) Setting and continuity with the previous class", "## 4) Commentary points: intimacy in devotion and ecstasy from 'simple' offerings", "## 8) Lord Śiva as the greatest Vaiṣṇava (distinct from Viṣṇu yet deeply devoted)". Never write a bare "1) Title" line with no "## " — without a heading marker it gets misread as an ordered-list item and nests underneath whatever came before instead of standing as its own section, breaking the whole document's indentation.
- The opening class-recap and greeting typically belong inside section 1, not a separate section.
- The reading of the verses, the commentary drawn from them, and the illustrations/examples used to support a point are NOT separated into different boxes — each appears inside whichever numbered section it naturally occurs in, in the order the class actually covers it.
- When a numbered section contains multiple distinct sub-points (e.g. several separate illustrations, or several supporting scriptural references), break those out as lettered sub-headings within that section, one heading level below the numbered section: "### A. ...", "### B. ...", "### C. ...", each followed by its own bullets. Same rule as above — these must be real "### " headings, not bare "A. Title" text lines.
- The final numbered section is the conclusion: how the class ended and what's previewed for next time, as concretely as the transcript states it.
- Do not omit thin content — if a beat is brief, give it a brief bullet or a short section, but do not skip it.

Formatting rules:
- Refer to him as "Niranjana Swami" throughout — not "the speaker," not "Mahārāja."
- IAST diacritics always: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc., even if the source material uses plain ASCII.
- Bold key Sanskrit terms and technical categories on first use.
- English only for verses/citations — no Sanskrit/Devanagari/IAST verse blocks. Give the English translation or a close paraphrase of what the verse says, in quotation marks if it's presented as a direct quote. None of the real samples include Sanskrit verse text.
- Bullet points for scannability, not prose paragraphs; nested (indented) sub-bullets within a section where helpful — preserve this nesting exactly, don't flatten multi-level lists into a single level. Every nested sub-item MUST be its own markdown list line, formatted exactly as "  - ◦ text" (two-space indent, dash, space, hollow bullet ◦, space, text) — the dash is required for markdown to treat it as a real list item (a hollow bullet with no dash renders as a continuation of the parent paragraph, not a separate line); the ◦ is required so the nested level reads visually distinct from the parent's filled bullet. This is a permanent formatting rule — do not drop the ◦ character.
- Direct speech and quoted phrases from the speaker go in quotation marks, verbatim, exactly as said — don't paraphrase what's actually a quote.
- No fixed metadata header block (no "Lecture by/Location/Date" box).
- Omit generic boilerplate that isn't specific to this lecture's actual content: no bullet noting that Bṛhad-bhāgavatāmṛta references are brief pointers to fuller Śrīmad-Bhāgavatam treatments (only include this if the class makes a specific new point about it), and no bullet just listing the opening prayers offered (oṁ namo bhagavate vāsudevāya, guru-vandanā, Prabhupāda praṇāma-mantra, etc.) unless something about that moment is actually distinctive to this class. These are ritual constants present in nearly every class and add no lecture-specific information — none of the real samples include them.

The summary should be comprehensive enough that someone who missed the class can understand all key points discussed.

Return ONLY the summary. No preamble, no "Here is the summary" — start directly with section 1.`;

/**
 * Force a hollow bullet ("◦") onto every nested (indented) markdown list
 * line. The model doesn't apply this consistently on its own (confirmed
 * 2026-08-07: 25/31 nested lines missing it in one test run) — enforced
 * here deterministically instead of relying on prompt compliance. Only
 * touches indented "- " lines (nested sub-items); top-level bullets are
 * left alone. Idempotent — already-correct "- ◦ " lines are untouched.
 */
function enforceHollowNestedBullets(text: string): string {
  return text.replace(/^(\s{2,})-\s+(?!◦)/gm, "$1- ◦ ");
}

/**
 * Force numbered section titles ("1) Title") and lettered sub-point titles
 * ("A. Title") onto real markdown headings ("## 1) Title" / "### A.
 * Title"). Without a heading marker, a bare "1) Title" line at the start
 * of a paragraph gets misread by markdown renderers as an ordered-list
 * item and silently nests under whatever came before it, wrecking the
 * whole document's indentation (confirmed 2026-08-07 from a real render).
 * Only touches lines that are the start of a section (short line, title
 * case, no existing "#"), not every "1)" that might appear inline in body
 * text.
 */
function enforceSectionHeadings(text: string): string {
  return text
    .replace(/^(?!#)(\d+\))\s+(\S.*)$/gm, "## $1 $2")
    .replace(/^(?!#)([A-Z]\.)\s+(\S.*)$/gm, "### $1 $2");
}

// Banned generic section labels — same list the prompt already spells out
// ("no fixed section labels — no 'Context & aim,' no 'Recap of the
// previous class,' ..."). Prompt-only compliance isn't reliable (confirmed
// 2026-08-12: a real generated summary titled a section literally "## 2)
// Recap of the previous class (texts 37–49)"), same failure class as the
// bullet/heading rules above.
//
// Detection is deliberately conservative: only flags a title that EXACTLY
// matches a banned phrase, or STARTS with one followed by a clear
// separator (":" / "-" / "(") introducing lecture-specific detail. Does
// NOT flag a banned word used as part of an unrelated, genuinely
// content-specific title ("Highlights of Kṛṣṇa's transcendental
// qualities", "Reading and discussion of BB 1.2.14") — a loose
// prefix-strip would mangle those.
const BANNED_LABELS = [
  "context & aim",
  "context and aim",
  "recap of the previous class",
  "recap of the previous session",
  "recap of previous class",
  "recap of previous session",
  "reading",
  "highlights from the commentary",
  "illustrations used",
  "theme",
];

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

interface HeadingViolation {
  lineIndex: number;
  prefix: string; // "## 2)" or "### A."
  level: "section" | "subsection";
}

function findBannedHeadings(lines: string[]): HeadingViolation[] {
  const violations: HeadingViolation[] = [];
  lines.forEach((line, i) => {
    const m = /^(## \d+\)|### [A-Z]\.)\s+(.*)$/.exec(line);
    if (!m) return;
    const [, prefix, title] = m;
    const lower = title.toLowerCase();
    const isViolation = BANNED_LABELS.some((label) => {
      if (lower === label) return true;
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped}\\s*[:\\-–—(]`, "i").test(title);
    });
    if (isViolation) {
      violations.push({ lineIndex: i, prefix, level: prefix.startsWith("##") ? "section" : "subsection" });
    }
  });
  return violations;
}

/** Body text from just after a heading line up to the next heading of equal-or-higher level. */
function sectionBody(lines: string[], v: HeadingViolation): string {
  const endPatterns = v.level === "section" ? [/^## /] : [/^## /, /^### /];
  let end = lines.length;
  for (let i = v.lineIndex + 1; i < lines.length; i++) {
    if (endPatterns.some((p) => p.test(lines[i]))) {
      end = i;
      break;
    }
  }
  return lines.slice(v.lineIndex + 1, end).join("\n").trim();
}

/**
 * A regex strip can only delete the banned phrase, not rephrase what's
 * left — "Recap of the previous class (texts 37–49)" stripped down to
 * "(texts 37–49)" is grammatically awkward even though it's no longer
 * using a banned word. Instead: send the section's actual body content to
 * Haiku (cheap, same low-stakes-call pattern as elaborate.ts's
 * findTopics()) and ask for a real content-specific title, same as the
 * model was supposed to write in the first place.
 */
async function retitleBannedSection(body: string): Promise<string | null> {
  if (body.length < 10) return null;
  try {
    const response = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 60,
      system:
        "Given the body content of one section of a lecture summary, write ONE short, plain, content-specific title (roughly 4-12 words) describing what this section actually covers. Do NOT use generic template words like Recap, Reading, Theme, Highlights, Context, Illustrations. Return ONLY the title text — no quotes, no numbering, no markdown.",
      messages: [{ role: "user", content: body }],
    });
    const block = response.content.find((b) => b.type === "text");
    const title = (block as { text?: string } | undefined)?.text?.trim();
    return title || null;
  } catch {
    return null;
  }
}

async function fixBannedSectionLabels(text: string): Promise<string> {
  const lines = text.split("\n");
  const violations = findBannedHeadings(lines);
  if (violations.length === 0) return text;

  for (const v of violations) {
    const body = sectionBody(lines, v);
    const newTitle = await retitleBannedSection(body);
    if (newTitle) {
      lines[v.lineIndex] = `${v.prefix} ${newTitle}`;
    }
  }
  return lines.join("\n");
}

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
  const formatted = enforceHollowNestedBullets(enforceSectionHeadings(text));
  return fixBannedSectionLabels(formatted);
}
