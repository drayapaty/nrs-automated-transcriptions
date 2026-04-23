/**
 * DynamoDB store for transcripts/translations.
 *
 * Table:    nrs-lectures-auto-transcribe
 * PK:       lecture_id (S)   — UUID of the lecture (admin-supplied)
 * SK:       lang       (S)   — ISO 639-1 code: "en", "ru", "uk", or any future language
 *
 * One row per (lecture, language). Replacing a row replaces the entire
 * transcript for that language.
 */

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { dynamo } from "./clients";

export const TABLE_LECTURES =
  process.env.DYNAMODB_TABLE_LECTURES || "nrs-lectures-auto-transcribe";

/** Top-level metadata stored alongside a transcript row. */
export interface LectureRowMetadata {
  title?: string;
  date?: string;
  year?: number;
  duration?: string;
  location?: string;
  source_type?: string;
  // Pipeline-recorded provenance
  transcription_provider?: "deepgram" | "groq";
  cleanup_model?: string;
  translation_model?: string;
  // Anything else admin sent originally (passthrough)
  [k: string]: unknown;
}

export interface LectureRow {
  lecture_id: string;
  lang: string;
  text: string;
  /** Character count (denormalized for cheap listing). */
  chars: number;
  /** Word count (denormalized). */
  words: number;
  metadata?: LectureRowMetadata;
  created_at: string; // ISO
  updated_at: string; // ISO
  /** Optional source job_id (where this transcript came from). */
  source_job_id?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function countWords(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

/**
 * Upsert a transcript for a (lecture_id, lang) pair.
 * If the row already exists, it is replaced (and `created_at` is preserved).
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
  await dynamo().send(
    new PutCommand({ TableName: TABLE_LECTURES, Item: row })
  );
  return row;
}

export async function getLecture(
  lecture_id: string,
  lang: string
): Promise<LectureRow | null> {
  const res = await dynamo().send(
    new GetCommand({
      TableName: TABLE_LECTURES,
      Key: { lecture_id, lang },
    })
  );
  return (res.Item as LectureRow | undefined) ?? null;
}

/**
 * List all language rows for a given lecture.
 * Returns lightweight rows (text excluded by default to keep payload small);
 * pass `includeText: true` to bundle transcripts inline.
 */
export async function listLectureLanguages(
  lecture_id: string,
  opts: { includeText?: boolean } = {}
): Promise<Omit<LectureRow, "text">[] | LectureRow[]> {
  const projection = opts.includeText
    ? undefined
    : {
        ProjectionExpression:
          "lecture_id, lang, chars, words, metadata, created_at, updated_at, source_job_id",
      };
  const res = await dynamo().send(
    new QueryCommand({
      TableName: TABLE_LECTURES,
      KeyConditionExpression: "lecture_id = :id",
      ExpressionAttributeValues: { ":id": lecture_id },
      ...(projection || {}),
    })
  );
  return (res.Items || []) as LectureRow[];
}

export async function deleteLecture(
  lecture_id: string,
  lang: string
): Promise<void> {
  await dynamo().send(
    new DeleteCommand({
      TableName: TABLE_LECTURES,
      Key: { lecture_id, lang },
    })
  );
}
