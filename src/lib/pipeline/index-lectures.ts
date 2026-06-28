/**
 * Upsert a single whole-transcript document into the
 * `nrs-lectures-auto-transcribe` OpenSearch index.
 *
 * Document shape mirrors the DynamoDB table of the same name:
 *   - one doc per (lecture_id, lang) pair
 *   - doc _id is deterministic:  `{lecture_id}_{lang}`
 *   - re-runs overwrite cleanly (idempotent)
 *
 * Called from orchestrator.ts after each language transcript is finalized
 * (English after cleanup; RU/UK after translation).
 */

import type { IndexMetadata } from "../types";

const INDEX_LECTURES =
  process.env.OPENSEARCH_INDEX_LECTURES || "nrs-lectures-auto-transcribe";

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

function countWords(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

export interface LectureIndexDoc {
  lecture_id: string;
  lang: string;
  text: string;
  chars: number;
  words: number;
  // metadata passthrough
  title?: string;
  date?: string;
  year?: number;
  duration?: string;
  location?: string;
  source_type?: string;
  // enrichment
  topic_en?: string;
  topic_ru?: string;
  location_en?: string;
  location_ru?: string;
  event_en?: string;
  event_ru?: string;
  scripture_part?: string;
  scripture_chapter?: string;
  scripture_verse?: string;
  play_count?: number;
  download_count?: number;
  page_view_count?: number;
  // provenance
  transcription_provider?: string;
  cleanup_model?: string;
  translation_model?: string;
  source_job_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpsertLectureOpts {
  lecture_id: string;
  lang: string;
  text: string;
  metadata?: IndexMetadata;
  transcription_provider?: string;
  cleanup_model?: string;
  translation_model?: string;
  source_job_id?: string;
}

export async function upsertLectureDoc(opts: UpsertLectureOpts): Promise<void> {
  // Self-signed cert on Hetzner cluster
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const { lecture_id, lang, text, metadata, source_job_id } = opts;
  if (!lecture_id) throw new Error("lecture_id required");
  if (!lang) throw new Error("lang required");

  const nowIso = new Date().toISOString();
  const year =
    metadata?.year ??
    (metadata?.date ? parseInt(metadata.date.substring(0, 4), 10) : undefined);

  const doc: LectureIndexDoc = {
    lecture_id,
    lang,
    text,
    chars: text.length,
    words: countWords(text),
    ...(metadata?.title && { title: metadata.title }),
    ...(metadata?.date && { date: metadata.date }),
    ...(year !== undefined && Number.isFinite(year) && { year }),
    ...(metadata?.duration && { duration: metadata.duration }),
    ...(metadata?.location && { location: metadata.location }),
    source_type: metadata?.source_type || "lecture",
    ...(metadata?.topic_en && { topic_en: metadata.topic_en }),
    ...(metadata?.topic_ru && { topic_ru: metadata.topic_ru }),
    ...(metadata?.location_en && { location_en: metadata.location_en }),
    ...(metadata?.location_ru && { location_ru: metadata.location_ru }),
    ...(metadata?.event_en && { event_en: metadata.event_en }),
    ...(metadata?.event_ru && { event_ru: metadata.event_ru }),
    ...(metadata?.scripture_part && { scripture_part: metadata.scripture_part }),
    ...(metadata?.scripture_chapter && { scripture_chapter: metadata.scripture_chapter }),
    ...(metadata?.scripture_verse && { scripture_verse: metadata.scripture_verse }),
    ...(metadata?.play_count != null && { play_count: metadata.play_count }),
    ...(metadata?.download_count != null && { download_count: metadata.download_count }),
    ...(metadata?.page_view_count != null && { page_view_count: metadata.page_view_count }),
    ...(opts.transcription_provider && { transcription_provider: opts.transcription_provider }),
    ...(opts.cleanup_model && { cleanup_model: opts.cleanup_model }),
    ...(opts.translation_model && { translation_model: opts.translation_model }),
    ...(source_job_id && { source_job_id }),
    created_at: nowIso, // overwritten by existing on update via retry strategy below
    updated_at: nowIso,
  };

  const docId = `${lecture_id}_${lang}`;

  // Use PUT (index) for idempotent replace. `created_at` will be overwritten
  // on re-runs; if you want true "created_at preserved", switch to an update
  // script — DynamoDB already preserves it in lectures.ts.
  const res = await fetch(
    `${esUrl()}/${INDEX_LECTURES}/_doc/${encodeURIComponent(docId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify(doc),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Upsert to ${INDEX_LECTURES}/${docId} failed (${res.status}): ${errText.substring(0, 200)}`
    );
  }
}
