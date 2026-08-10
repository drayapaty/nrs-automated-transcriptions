/**
 * Translate cleaned English transcript into a target language using Claude.
 *
 * Prompts mirror demo-pipeline.ts in ask-niranjana-swami so output style is
 * consistent across the corpus.
 */

import { anthropic, CLAUDE_MODEL } from "../clients";
import type { Language } from "../types";

const RUSSIAN_PROMPT = `You are translating a lecture transcript by His Holiness Niranjana Swami into Russian.

The transcript is from a Gaudiya Vaishnava spiritual lecture. Translate the entire English text into fluent, natural Russian.

Rules:
1. Cyrillicize ALL Sanskrit proper names and terms:
   - Names: Кришна, Брахма, Шива, Нарада, Прахлад, Вишну, Чайтанья, Прабхупада, Хануман, Пандавы
   - Scriptures: Брихад-бхагаватамрита, Шримад-Бхагаватам, Бхагавад-гита, Чайтанья-чаритамрита
   - Places: Вриндаван, Враджа, Сатьялока, Матхура, Дварака
   - Sanskrit terms: лила, джива, дхама (always "святая дхама"), Йогамайя, Махамайя, йукта-вайрагья, гуна-аватара
   - ONLY keep in Latin: verse references (SB 1.2.6, BG 2.40, CC Adi 1.1)

2. Use devotional register, not mechanical calques:
   - "recipient of mercy" → "преданный, который обрел милость Кришны" (not "получатель милости")
   - "life fulfilled" → "жизнь увенчалась успехом"
   - "correcting with the same tongue" → "искупить вину тем же языком"
   - "lesson about reverence" → "урок о правильном умонастроении"

3. Prefer full clauses over participial compression — natural Russian sentence flow

4. Always prefix dhām with святая/святой: "святая дхама", "святой дхамой" — never bare

5. Use «мысли с собой» (ключевые выводы) for "takeaways" sections, not «выводы»

6. Standard Vaishnava conventions: Господь (Lord), преданное служение (devotional service), духовный учитель (spiritual master)

7. Maintain the same paragraph structure as the English original

8. If the input is markdown (headings like "## 1) Title" or "### A. Title", bullet lines starting with "-", nested "  - ◦ " sub-bullets, "**bold**" markers), preserve that exact markdown syntax around the translated text — translate the words, not the structural characters. Never drop the "## "/"### " heading markers, the "◦" nested-bullet marker, or "**" bold markers.

Translate naturally — the Russian should read as if Maharaja spoke in Russian. Return ONLY the Russian translation. No headers, commentary, or explanations.`;

const UKRAINIAN_PROMPT = `You are translating a lecture transcript by His Holiness Niranjana Swami into Ukrainian.

The transcript is from a Gaudiya Vaishnava spiritual lecture. Translate the entire English text into fluent, natural Ukrainian.

Rules:
- Maintain the same paragraph structure as the English original
- Keep Sanskrit terms in their standard transliterated form (do NOT translate them into Cyrillic): Krishna, Prabhupada, Bhagavad-gita, Srimad Bhagavatam, etc.
- Keep verse references as-is (SB 1.2.6, BG 2.40, CC Adi 1.1)
- Use standard Ukrainian Vaishnava conventions (Господь for Lord, віддане служіння for devotional service, духовний вчитель for spiritual master, etc.)
- Translate naturally — not word-for-word. The Ukrainian should read as if Maharaja spoke in Ukrainian.

Return ONLY the Ukrainian translation. No headers, commentary, or explanations.`;

const PROMPTS: Record<Language, string> = {
  ru: RUSSIAN_PROMPT,
  uk: UKRAINIAN_PROMPT,
};

const MAX_CHUNK_CHARS = 12_000;

export async function translate(
  englishText: string,
  lang: Language
): Promise<string> {
  const prompt = PROMPTS[lang];
  if (!prompt) throw new Error(`Unsupported translation language: ${lang}`);

  if (englishText.length <= MAX_CHUNK_CHARS) {
    return translateChunk(prompt, englishText);
  }

  const sentences = englishText.match(/[^.!?]+[.!?]+/g) || [englishText];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > MAX_CHUNK_CHARS && current) {
      chunks.push(current);
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current);

  const out: string[] = [];
  for (const chunk of chunks) {
    out.push(await translateChunk(prompt, chunk));
  }
  return out.join("\n\n");
}

async function translateChunk(prompt: string, text: string): Promise<string> {
  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16_000,
    messages: [{ role: "user", content: `${prompt}\n\nTRANSCRIPT:\n${text}` }],
  });
  const block = response.content.find((b) => b.type === "text");
  return (block as { text?: string } | undefined)?.text || text;
}

type MdLine =
  | { kind: "blank" }
  | { kind: "h2" | "h3" | "topBullet" | "nestedBullet" | "plain"; text: string };

const LINE_PATTERNS: Array<[MdLine["kind"], RegExp]> = [
  ["h2", /^##\s+(.*)$/],
  ["h3", /^###\s+(.*)$/],
  ["nestedBullet", /^\s{2,}-\s+◦?\s*(.*)$/],
  ["topBullet", /^-\s+(.*)$/],
];

function parseMdLines(md: string): MdLine[] {
  return md.split("\n").map((raw) => {
    const line = raw.trimEnd();
    if (!line.trim()) return { kind: "blank" };
    for (const [kind, re] of LINE_PATTERNS) {
      const m = line.match(re);
      if (m) return { kind, text: m[1] };
    }
    return { kind: "plain", text: line };
  });
}

function rebuildMdLine(kind: MdLine["kind"], text: string): string {
  switch (kind) {
    case "h2": return `## ${text}`;
    case "h3": return `### ${text}`;
    case "nestedBullet": return `  - ◦ ${text}`;
    case "topBullet": return `- ${text}`;
    default: return text;
  }
}

/**
 * Translate a V3-format summary markdown file (numbered "## N) Title"
 * sections, lettered "### A. Title" sub-sections, "- " / "  - ◦ " bullets)
 * while guaranteeing the structural markers survive intact. A plain prose
 * translation of the whole blob (see translateChunk above) is NOT reliable
 * for this — the model drops "## "/"### " markers under prompt instruction
 * alone (confirmed 2026-08-07: same reliability problem as the hollow-
 * bullet formatting rule during summary generation). Fix follows the same
 * pattern used there: extract structure in code, translate only the text
 * content (as a numbered list so line correspondence is trivial to
 * enforce), then reassemble the original markers programmatically —
 * structure preservation no longer depends on the model remembering a
 * formatting instruction.
 */
export async function translateStructuredSummary(
  md: string,
  lang: Language
): Promise<string> {
  const prompt = PROMPTS[lang];
  if (!prompt) throw new Error(`Unsupported translation language: ${lang}`);

  const parsed = parseMdLines(md);
  const textLines = parsed
    .map((l, i) => (l.kind === "blank" ? null : { i, text: (l as { text: string }).text }))
    .filter((x): x is { i: number; text: string } => x !== null && x.text.trim() !== "");

  if (textLines.length === 0) return md;

  const numbered = textLines.map((l, idx) => `${idx + 1}. ${l.text}`).join("\n");
  const listPrompt = `${prompt}

The text below is a numbered list, one line of a lecture summary per item. Translate ONLY the text of each item into Russian — do not add, remove, merge, split, or reorder items. Return the exact same count of numbered items, one per line, same numbering, same order, nothing else (no preamble, no extra commentary).

ITEMS:
${numbered}`;

  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16_000,
    messages: [{ role: "user", content: listPrompt }],
  });
  const block = response.content.find((b) => b.type === "text");
  const raw = (block as { text?: string } | undefined)?.text || "";

  const translatedByIndex = new Map<number, string>();
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(\d+)\.\s*(.*)$/);
    if (m) translatedByIndex.set(parseInt(m[1], 10) - 1, m[2]);
  }

  const out: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const l = parsed[i];
    if (l.kind === "blank") {
      out.push("");
      continue;
    }
    const textIdx = textLines.findIndex((t) => t.i === i);
    const translatedText = translatedByIndex.get(textIdx) ?? (l as { text: string }).text;
    out.push(rebuildMdLine(l.kind, translatedText));
  }
  return out.join("\n");
}
