/**
 * POST /api/transcribe
 *
 * High-level wrapper around /api/jobs for user-facing source links
 * (NRS lecture URL, YouTube URL). The dispatcher resolves the source
 * link to a downloadable audio URL + metadata, then queues a job that
 * runs through the same orchestrator as /api/jobs.
 *
 * Body:
 *   {
 *     source       : "nrs" | "yt"             // YT not yet wired
 *     source_link  : string                    // URL or bare UUID for NRS
 *     translate?   : ("ru" | "uk")[]           // default []
 *     index?       : boolean                   // default true (write to both indexes)
 *     paragraph?   : boolean                   // default true
 *     provider?    : "auto" | "deepgram" | "groq"  // default "auto"
 *     callback_url?: string
 *   }
 *
 * Response: 202
 *   { job_id, status: "queued", poll_url, resolved: { audio_url, metadata } }
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { createJob, hashUrl, newJobId } from "@/lib/jobs";
import { runPipeline } from "@/lib/orchestrator";
import { resolveSource } from "@/lib/source-resolvers";
import type { CreateJobRequest, Job } from "@/lib/types";

const Body = z.object({
  source: z.enum(["nrs", "yt"]),
  source_link: z.string().min(1),
  translate: z.array(z.enum(["ru", "uk"])).optional(),
  index: z.boolean().optional(),
  paragraph: z.boolean().optional(),
  provider: z.enum(["auto", "deepgram", "groq"]).optional(),
  callback_url: z.string().url().optional(),
  notify_email: z.string().email().optional(),
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

  const {
    source,
    source_link,
    translate,
    index,
    paragraph,
    provider,
    callback_url,
    notify_email,
  } = parsed.data;

  // Resolve user-facing source link → audio URL + metadata.
  const resolved = await resolveSource(source, source_link);
  if ("code" in resolved) {
    return NextResponse.json(
      { error: resolved.message, source, source_link },
      { status: resolved.code }
    );
  }

  // Default: index=true, paragraph=true. The whole point of this endpoint
  // is to land a usable, searchable transcript end-to-end.
  const request: CreateJobRequest = {
    s3_url: resolved.audio_url,
    metadata: resolved.metadata,
    translate: translate ?? [],
    index: index ?? true,
    paragraph: paragraph ?? true,
    provider: provider ?? "auto",
    ...(callback_url ? { callback_url } : {}),
    ...(notify_email ? { notify_email } : {}),
  };

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
  waitUntil(runPipeline(created));

  return NextResponse.json(
    {
      job_id,
      status: "queued",
      poll_url: `/api/transcribe/${job_id}`,
      resolved: {
        audio_url: resolved.audio_url,
        metadata: resolved.metadata,
      },
    },
    { status: 202 }
  );
}
