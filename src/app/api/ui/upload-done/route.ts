/**
 * POST /api/ui/upload-done
 *
 * Called by the browser after a successful PUT to S3. Generates a
 * presigned GET URL for the uploaded object and forwards to the
 * existing /api/jobs pipeline so the same orchestrator (download →
 * Deepgram → cleanup → optional translate → optional index) runs.
 *
 * Body:
 *   {
 *     key:           string,            // S3 object key returned by upload-init
 *     filename:      string,            // original filename (for metadata.title)
 *     notify_email?: string,
 *     translate?:    ("ru"|"uk")[],
 *     index?:        boolean,           // defaults to false here — uploaded
 *                                       //   audio has no canonical UUID
 *   }
 *
 * Response: 202 { job_id, status, poll_url, resolved }
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { presignDownload } from "@/lib/s3-upload";
import { createJob, hashUrl, newJobId } from "@/lib/jobs";
import { runPipeline } from "@/lib/orchestrator";
import type { CreateJobRequest, Job } from "@/lib/types";

const Body = z.object({
  key: z.string().min(1),
  filename: z.string().min(1).max(200),
  notify_email: z.string().email().optional(),
  translate: z.array(z.enum(["ru", "uk"])).optional(),
  index: z.boolean().optional(),
});

function titleFromFilename(name: string): string {
  // Strip extension + replace separators with spaces.
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[._-]+/g, " ")
    .trim() || name;
}

export async function POST(req: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const { key, filename, notify_email, translate, index } = parsed.data;

  let audioUrl: string;
  try {
    audioUrl = await presignDownload(key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not presign uploaded object: ${msg}` },
      { status: 500 }
    );
  }

  const request: CreateJobRequest = {
    s3_url: audioUrl,
    metadata: {
      uuid: `upload-${key.replace(/^uploads\//, "").split("/")[0]}`,
      title: titleFromFilename(filename),
      date: new Date().toISOString(),
      year: new Date().getUTCFullYear(),
      source_type: "lecture",
    },
    translate: translate ?? [],
    index: index ?? false,
    paragraph: true,
    provider: "auto",
    ...(notify_email ? { notify_email } : {}),
  };

  const job_id = newJobId();
  const now = new Date().toISOString();
  const job: Omit<Job, "ttl"> = {
    job_id,
    status: "queued",
    progress: { stage: "queued", pct: 0 },
    request,
    request_hash: hashUrl(audioUrl),
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
        audio_url: audioUrl,
        metadata: request.metadata,
      },
    },
    { status: 202 }
  );
}
