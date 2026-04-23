/**
 * OpenAI embeddings — text-embedding-3-small (1536 dims), batched.
 * Same model as ask-niranjana-swami for compatibility with existing
 * ask-nrs-lectures index.
 */

import { openai } from "../clients";

const EMBED_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 50;

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await openai().embeddings.create({
      model: EMBED_MODEL,
      input: batch,
    });
    all.push(...res.data.map((d) => d.embedding));
  }
  return all;
}
