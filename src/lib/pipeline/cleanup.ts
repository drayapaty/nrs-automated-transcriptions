/**
 * Claude post-processing: Sanskrit term cleanup + paragraphing.
 *
 * Identical prompt to ask-niranjana-swami's fetch-lectures.ts so output is
 * consistent with the existing transcript corpus.
 */

import { anthropic, CLAUDE_MODEL } from "../clients";

const CLEANUP_PROMPT = `You are cleaning up an AI-generated transcript of a lecture by His Holiness Niranjana Swami, a Gaudiya Vaishnava teacher and disciple of Srila Prabhupada.

Fix these issues — do NOT change the English content, sentence structure, or meaning:

1. Sanskrit terms: Fix garbled Sanskrit/Bengali to correct form (Srimad Bhagavatam, Bhagavad-gita, Caitanya-caritamrita, Krishna, Prabhupada, Vrindavan, Mayapur, sankirtan, prasadam, japa, kirtan, bhakti, guru, sastra, sadhu, dharma, karma, prema, etc.)
2. Mangala-carana prayers: Fix opening prayers to correct form
3. Verse references: Fix garbled verse numbers (SB 12.3.31, BG 2.40, CC Adi 1.1)
4. Remove obvious transcription hallucinations (repeated phrases, nonsensical filler)
5. Remove translated portions: If the lecture has a translator speaking in Russian, Hungarian, Mandarin, or any other non-English language, REMOVE those translated sections entirely.
6. PARAGRAPHING: Break the transcript into logical, readable paragraphs. Start a new paragraph when:
   - The speaker shifts to a new topic or point
   - A verse or quote begins or ends
   - There is a natural pause or transition ("So...", "Now...", "And therefore...")
   - Q&A sections begin
   Keep paragraphs 3-6 sentences each. Do NOT make single-sentence paragraphs unless it is a standalone quote or verse.

Return ONLY the cleaned, well-paragraphed English transcript. No headers, commentary, or explanations.`;

const MAX_CHUNK_CHARS = 12_000;

export async function cleanupTranscript(rawText: string): Promise<string> {
  if (rawText.length <= MAX_CHUNK_CHARS) {
    return cleanupChunk(rawText);
  }

  // Split at sentence boundaries to keep semantic coherence
  const sentences = rawText.match(/[^.!?]+[.!?]+/g) || [rawText];
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

  const cleaned: string[] = [];
  for (const chunk of chunks) {
    cleaned.push(await cleanupChunk(chunk));
  }
  return cleaned.join("\n\n");
}

async function cleanupChunk(text: string): Promise<string> {
  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16_000,
    messages: [
      { role: "user", content: `${CLEANUP_PROMPT}\n\nTRANSCRIPT:\n${text}` },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return (textBlock as { text?: string } | undefined)?.text || text;
}
