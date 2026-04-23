/**
 * Shared types for the transcription service.
 */

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "cleaning"
  | "translating"
  | "chunking"
  | "embedding"
  | "indexing"
  | "done"
  | "failed";

export type Language = "ru" | "uk";

/** Input metadata the admin sends for OpenSearch indexing. */
export interface IndexMetadata {
  uuid: string;
  title?: string;
  date?: string; // YYYY-MM-DD
  year?: number;
  duration?: string;
  location?: string;
  source_type?: string; // default "lecture"
  source_file?: string; // defaults to `${uuid}.txt`
  // Optional enrichment fields (mirrors ask-nrs-lectures schema)
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
}

export interface CreateJobRequest {
  /** Presigned S3 URL (or any HTTPS URL) to the source audio. */
  s3_url: string;
  /** Optional. If set, run translations after cleanup. */
  translate?: Language[];
  /** Optional. If true, index to OpenSearch after cleanup. Requires `metadata.uuid`. */
  index?: boolean;
  /** Required if `index: true`. */
  metadata?: IndexMetadata;
  /** Default true — run Claude cleanup + paragraphing pass after raw transcription. */
  paragraph?: boolean;
  /** Optional. If set, POST job result to this URL when done. */
  callback_url?: string;
  /** Optional override of which transcription provider to use. */
  provider?: "auto" | "deepgram" | "groq";
}

export interface JobProgress {
  stage: JobStatus;
  pct: number; // 0-100
  message?: string;
}

export interface JobResult {
  transcript_en: string;
  translations?: Partial<Record<Language, string>>;
  metadata: {
    duration_s?: number;
    words: number;
    chars: number;
    deepgram_request_id?: string;
    transcription_provider: "deepgram" | "groq";
    cleanup_model: string;
    translation_model?: string;
    indexed_chunks?: number;
  };
}

export interface Job {
  job_id: string;
  status: JobStatus;
  progress: JobProgress;
  request: CreateJobRequest;
  result?: JobResult;
  error?: string;
  created_at: string; // ISO
  updated_at: string; // ISO
  finished_at?: string; // ISO
  /** SHA-256 of s3_url, used for idempotent dedupe of in-flight jobs. */
  request_hash: string;
  /** TTL for DynamoDB row expiry (UNIX seconds, 30 days from creation). */
  ttl: number;
}

export interface ChunkDoc {
  _id: string;
  uuid: string;
  chunk_index: number;
  title: string;
  content: string;
  date: string;
  year: number;
  duration: string;
  location: string;
  source_type: string;
  source_file: string;
  embedding: number[];
  // Enrichment passthrough (any fields admin provides)
  [k: string]: unknown;
}
