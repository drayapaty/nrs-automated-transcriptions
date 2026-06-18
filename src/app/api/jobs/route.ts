/**
 * POST /api/jobs
 *
 * Create a new transcription job. Returns immediately with a job_id; the
 * pipeline runs in the background via Vercel's `waitUntil()`.
 *
 * Body:
 *   {
 *     s3_url:        string                       // presigned S3 URL (or any HTTPS audio URL)
 *     translate?:    ("ru" | "uk")[]              // optional translations
 *     index?:        boolean                      // index to OpenSearch (requires metadata.uuid)
 *     metadata?: {
 *       uuid:        string                       // required if index=true OR if you want
 *                                                 //   transcripts persisted to nrs-lectures-auto-transcribe
 *       title?:      string,
 *       date?:       string,                      // YYYY-MM-DD
 *       year?:       number,
 *       duration?:   string,
 *       location?:   string,
 *       source_type? string,                      // default "lecture"
 *       // ... + optional enrichment fields (see types.ts)
 *     },
 *     paragraph?:    boolean = true               // run Claude cleanup pass
 *     callback_url?: string                       // POST result here when done
 *     provider?:     "auto" | "deepgram" | "groq" // default "auto"
 *   }
 *
 * Response: 202
 *   { job_id, status: "queued", poll_url }
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { createJob, hashUrl, newJobId } from "@/lib/jobs";
import { runPipeline } from "@/lib/orchestrator";
import type { CreateJobRequest, Job } from "@/lib/types";

const IndexMetadataSchema = z
  .object({
    uuid: z.string().min(1),
    title: z.string().optional(),
    date: z.string().optional(),
    year: z.number().int().optional(),
    duration: z.string().optional(),
    location: z.string().optional(),
    source_type: z.string().optional(),
    source_file: z.string().optional(),
    topic_en: z.string().optional(),
    topic_ru: z.string().optional(),
    location_en: z.string().optional(),
    location_ru: z.string().optional(),
    event_en: z.string().optional(),
    event_ru: z.string().optional(),
    scripture_part: z.string().optional(),
    scripture_chapter: z.string().optional(),
    scripture_verse: z.string().optional(),
    play_count: z.number().optional(),
    download_count: z.number().optional(),
    page_view_count: z.number().optional(),
  })
  .passthrough();

const Body = z
  .object({
    s3_url: z.string().url(),
    translate: z.array(z.enum(["ru", "uk"])).optional(),
    index: z.boolean().optional(),
    metadata: IndexMetadataSchema.optional(),
    paragraph: z.boolean().optional(),
    callback_url: z.string().url().optional(),
    notify_email: z.string().email().optional(),
    provider: z.enum(["auto", "deepgram", "groq"]).optional(),
  })
  .refine((b) => !b.index || !!b.metadata?.uuid, {
    message: "metadata.uuid is required when index=true",
    path: ["metadata", "uuid"],
  });

export async function POST(req: NextRequest) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const request: CreateJobRequest = parsed.data;
  const job_id = newJobId();
  const now = new Date().toISOString();

  const job: Omit<Job, "ttl"> = {
    job_id,
    status: "queued",
    progress: { stage: "queued", pct: 0 },
    request,
    request_hash: hashUrl(request.s3_url),
    created_at: now,
    updated_at: now,
  };

  const created = await createJob(job);

  // Kick off pipeline in background — function returns to client immediately.
  waitUntil(runPipeline(created));

  return NextResponse.json(
    {
      job_id,
      status: "queued",
      poll_url: `/api/jobs/${job_id}`,
    },
    { status: 202 }
  );
}
