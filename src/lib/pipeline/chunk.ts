/**
 * Paragraph-aware text chunking for OpenSearch indexing.
 * Mirrors ask-niranjana-swami's scripts/ingest-elasticsearch.ts (~800 tokens
 * per chunk, ~200 token overlap, 4 chars/token approximation).
 */

const CHUNK_TOKENS = 800;
const OVERLAP_TOKENS = 200;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS_PER_CHUNK = 20_000; // hard cap (OpenAI 8192-token embed limit)

export interface Chunk {
  text: string;
  index: number;
}

export function chunkText(text: string): Chunk[] {
  const target = CHUNK_TOKENS * CHARS_PER_TOKEN;
  const overlap = OVERLAP_TOKENS * CHARS_PER_TOKEN;

  const paragraphs = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let current = "";
  let idx = 0;

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > target && current.length > 0) {
      chunks.push({ text: current.trim(), index: idx++ });
      const words = current.split(/\s+/);
      const overlapWordCount = Math.floor(overlap / 5); // ~5 chars per English word
      const overlapWords = words.slice(-overlapWordCount);
      current = overlapWords.join(" ") + "\n\n" + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim()) {
    chunks.push({ text: current.trim(), index: idx });
  }

  return chunks.map((c) => ({
    ...c,
    text: c.text.length > MAX_CHARS_PER_CHUNK ? c.text.slice(0, MAX_CHARS_PER_CHUNK) : c.text,
  }));
}
