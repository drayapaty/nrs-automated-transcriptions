/**
 * Transcript storage (OpenSearch-backed).
 *
 * Index:    nrs-lectures-auto-transcribe
 * Doc _id:  `{lecture_id}_{lang}`  — deterministic, idempotent upsert
 * Shape:    one document per (lecture_id, lang) pair
 *
 * Same function signatures as before — API routes unchanged — but backed
 * by OpenSearch directly instead of dual-writing to DynamoDB. Simpler
 * architecture, full-text search for free, one fewer system to operate.
 */

const INDEX =
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

function docId(lecture_id: string, lang: string): string {
  return `${lecture_id}_${lang}`;
}

/** Top-level metadata stored alongside a transcript row. */
export interface LectureRowMetadata {
  title?: string;
  date?: string;
  year?: number;
  duration?: string;
  location?: string;
  source_type?: string;
  transcription_provider?: "deepgram" | "groq";
  cleanup_model?: string;
  translation_model?: string;
  [k: string]: unknown;
}

export interface LectureRow {
  lecture_id: string;
  lang: string;
  text: string;
  chars: number;
  words: number;
  metadata?: LectureRowMetadata;
  created_at: string;
  updated_at: string;
  source_job_id?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function countWords(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

async function esFetch(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  // Self-signed cert on Hetzner cluster
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const res = await fetch(`${esUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/**
 * Flatten a LectureRow into an OpenSearch document.
 * We flatten metadata to top level for easier search; also keep it nested.
 */
function rowToDoc(row: LectureRow): Record<string, unknown> {
  const meta = row.metadata || {};
  return {
    lecture_id: row.lecture_id,
    lang: row.lang,
    text: row.text,
    chars: row.chars,
    words: row.words,
    // Flatten common metadata fields to top level (matches index mapping)
    title: meta.title,
    date: meta.date,
    year: meta.year,
    duration: meta.duration,
    location: meta.location,
    source_type: meta.source_type,
    transcription_provider: meta.transcription_provider,
    cleanup_model: meta.cleanup_model,
    translation_model: meta.translation_model,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source_job_id: row.source_job_id,
  };
}

/**
 * Inverse: read a doc back into a LectureRow.
 */
function docToRow(doc: Record<string, unknown>): LectureRow {
  return {
    lecture_id: doc.lecture_id as string,
    lang: doc.lang as string,
    text: (doc.text as string) || "",
    chars: (doc.chars as number) || 0,
    words: (doc.words as number) || 0,
    metadata: {
      title: doc.title as string | undefined,
      date: doc.date as string | undefined,
      year: doc.year as number | undefined,
      duration: doc.duration as string | undefined,
      location: doc.location as string | undefined,
      source_type: doc.source_type as string | undefined,
      transcription_provider: doc.transcription_provider as
        | "deepgram"
        | "groq"
        | undefined,
      cleanup_model: doc.cleanup_model as string | undefined,
      translation_model: doc.translation_model as string | undefined,
    },
    created_at: (doc.created_at as string) || nowIso(),
    updated_at: (doc.updated_at as string) || nowIso(),
    source_job_id: doc.source_job_id as string | undefined,
  };
}

/**
 * Upsert a transcript for a (lecture_id, lang) pair.
 * Preserves `created_at` on existing rows, updates `updated_at`.
 */
export async function putLecture(
  lecture_id: string,
  lang: string,
  text: string,
  opts: {
    metadata?: LectureRowMetadata;
    source_job_id?: string;
  } = {}
): Promise<LectureRow> {
  const existing = await getLecture(lecture_id, lang);
  const row: LectureRow = {
    lecture_id,
    lang,
    text,
    chars: text.length,
    words: countWords(text),
    metadata: opts.metadata ?? existing?.metadata,
    source_job_id: opts.source_job_id ?? existing?.source_job_id,
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso(),
  };

  const { status, data } = await esFetch(
    "PUT",
    `/${INDEX}/_doc/${encodeURIComponent(docId(lecture_id, lang))}?refresh=wait_for`,
    rowToDoc(row)
  );

  if (status !== 200 && status !== 201) {
    throw new Error(
      `Failed to upsert lecture ${lecture_id}/${lang}: ${status} ${JSON.stringify(data).substring(0, 200)}`
    );
  }
  return row;
}

/**
 * Fetch a single transcript by (lecture_id, lang).
 */
export async function getLecture(
  lecture_id: string,
  lang: string
): Promise<LectureRow | null> {
  const { status, data } = await esFetch(
    "GET",
    `/${INDEX}/_doc/${encodeURIComponent(docId(lecture_id, lang))}`
  );
  if (status === 404) return null;
  if (status !== 200) {
    throw new Error(`OpenSearch GET failed: ${status}`);
  }
  const d = data as { found?: boolean; _source?: Record<string, unknown> };
  if (!d.found || !d._source) return null;
  return docToRow(d._source);
}

/**
 * List all language rows for a lecture.
 * If `includeText` is false (default), `text` is stripped to keep payloads small.
 */
export async function listLectureLanguages(
  lecture_id: string,
  opts: { includeText?: boolean } = {}
): Promise<LectureRow[]> {
  const sourceFields = opts.includeText
    ? true
    : {
        excludes: ["text"],
      };
  const body = {
    query: { term: { lecture_id } },
    size: 20, // way more than enough — max expected ~5 langs per lecture
    _source: sourceFields,
  };
  const { status, data } = await esFetch("POST", `/${INDEX}/_search`, body);
  if (status !== 200) {
    throw new Error(`OpenSearch search failed: ${status}`);
  }
  const hits =
    ((data as { hits?: { hits?: Array<{ _source: Record<string, unknown> }> } }).hits
      ?.hits ?? []);
  return hits.map((h) => docToRow(h._source));
}

/**
 * Remove a transcript row.
 */
export async function deleteLecture(
  lecture_id: string,
  lang: string
): Promise<void> {
  const { status } = await esFetch(
    "DELETE",
    `/${INDEX}/_doc/${encodeURIComponent(docId(lecture_id, lang))}?refresh=wait_for`
  );
  if (status !== 200 && status !== 404) {
    throw new Error(`OpenSearch DELETE failed: ${status}`);
  }
}
