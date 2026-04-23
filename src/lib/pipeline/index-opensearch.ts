/**
 * Bulk-index transcript chunks into OpenSearch.
 * Target index: ask-nrs-lectures (same as ask-niranjana-swami).
 *
 * Document ID pattern: `{uuid}_chunk_{index}` — deterministic, re-indexable.
 */

import type { ChunkDoc, IndexMetadata } from "../types";
import { chunkText } from "./chunk";
import { embedBatch } from "./embed";

const ES_INDEX = process.env.OPENSEARCH_INDEX || "ask-nrs-lectures";

function authHeader(): string {
  const user = process.env.OPENSEARCH_USER!;
  const pass = process.env.OPENSEARCH_PASS!;
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

function esUrl(): string {
  const url = process.env.OPENSEARCH_URL;
  if (!url) throw new Error("OPENSEARCH_URL not set");
  return url.replace(/\/$/, "");
}

export interface IndexResult {
  chunks: number;
  indexed: number;
  errors: number;
}

/**
 * Chunk + embed + bulk-index a transcript.
 * Returns the count of chunks indexed and any errors.
 */
export async function indexTranscript(
  englishText: string,
  metadata: IndexMetadata
): Promise<IndexResult> {
  if (!metadata.uuid) {
    throw new Error("metadata.uuid is required for indexing");
  }
  // Self-signed cert on the Hetzner cluster — same workaround as ask-nrs.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const chunks = chunkText(englishText);
  if (chunks.length === 0) return { chunks: 0, indexed: 0, errors: 0 };

  // Embed
  const embeddings = await embedBatch(chunks.map((c) => c.text));

  // Build docs
  const year =
    metadata.year ??
    (metadata.date ? parseInt(metadata.date.substring(0, 4), 10) : 0);

  const docs: ChunkDoc[] = chunks.map((c, i) => ({
    _id: `${metadata.uuid}_chunk_${c.index}`,
    uuid: metadata.uuid,
    chunk_index: c.index,
    title: metadata.title || "",
    content: c.text,
    date: metadata.date || "",
    year: Number.isFinite(year) ? year : 0,
    duration: metadata.duration || "",
    location: metadata.location || "",
    source_type: metadata.source_type || "lecture",
    source_file: metadata.source_file || `${metadata.uuid}.txt`,
    embedding: embeddings[i],
    // Optional enrichment passthrough — only set if defined
    ...(metadata.topic_en && { topic_en: metadata.topic_en }),
    ...(metadata.topic_ru && { topic_ru: metadata.topic_ru }),
    ...(metadata.location_en && { location_en: metadata.location_en }),
    ...(metadata.location_ru && { location_ru: metadata.location_ru }),
    ...(metadata.event_en && { event_en: metadata.event_en }),
    ...(metadata.event_ru && { event_ru: metadata.event_ru }),
    ...(metadata.scripture_part && { scripture_part: metadata.scripture_part }),
    ...(metadata.scripture_chapter && { scripture_chapter: metadata.scripture_chapter }),
    ...(metadata.scripture_verse && { scripture_verse: metadata.scripture_verse }),
    ...(metadata.play_count != null && { play_count: metadata.play_count }),
    ...(metadata.download_count != null && { download_count: metadata.download_count }),
    ...(metadata.page_view_count != null && { page_view_count: metadata.page_view_count }),
  }));

  // Bulk index in batches of 50 to keep request payloads sane
  const BULK_SIZE = 50;
  let indexed = 0;
  let errors = 0;

  for (let i = 0; i < docs.length; i += BULK_SIZE) {
    const batch = docs.slice(i, i + BULK_SIZE);
    let body = "";
    for (const doc of batch) {
      const { _id, ...source } = doc;
      body += JSON.stringify({ index: { _index: ES_INDEX, _id } }) + "\n";
      body += JSON.stringify(source) + "\n";
    }

    const res = await fetch(`${esUrl()}/_bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-ndjson",
        Authorization: authHeader(),
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Bulk index failed (${res.status}): ${errText.substring(0, 200)}`);
    }

    const result = await res.json();
    const errCount =
      result.items?.filter((it: { index?: { error?: unknown } }) => it.index?.error).length || 0;
    indexed += batch.length - errCount;
    errors += errCount;
  }

  return { chunks: chunks.length, indexed, errors };
}
