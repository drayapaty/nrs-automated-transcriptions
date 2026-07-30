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
