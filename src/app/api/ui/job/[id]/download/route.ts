/**
 * GET /api/ui/job/:id/download?format=md|txt
 *
 * Browser-facing download for a completed transcription job. Reuses the
 * server-side ADMIN_BEARER_TOKEN to call the protected /api/transcribe/:id,
 * formats the transcript, and streams it back with Content-Disposition.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Job } from "@/lib/types";

function safeFileName(input: string, fallback: string): string {
  const base = (input || "")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return base || fallback;
}

function formatMarkdown(job: Job): string {
  const m = job.request.metadata;
  const title = m?.title || "(untitled)";
  const date = m?.date ? String(m.date).substring(0, 10) : "";
  const location = m?.location || "";
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  if (date) lines.push(`*${date}*`);
  if (location) lines.push(`*${location}*`);
  if (date || location) lines.push("");
  lines.push("---");
  lines.push("");
  lines.push((job.result?.transcript_en || "(no transcript)").trim());
  lines.push("");
  return lines.join("\n");
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = process.env.ADMIN_BEARER_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Service misconfigured: ADMIN_BEARER_TOKEN not set" },
      { status: 500 }
    );
  }

  const { id } = await ctx.params;
  if (!/^[a-z0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Bad job id" }, { status: 400 });
  }

  const format = (req.nextUrl.searchParams.get("format") || "md").toLowerCase();
  if (format !== "md" && format !== "txt") {
    return NextResponse.json(
      { error: "format must be md or txt" },
      { status: 400 }
    );
  }

  const upstream = new URL(`/api/transcribe/${id}`, req.nextUrl.origin);
  const r = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: `Upstream ${r.status}`, job_id: id },
      { status: r.status }
    );
  }
  const job = (await r.json()) as Job;
  if (job.status !== "done" || !job.result?.transcript_en) {
    return NextResponse.json(
      { error: "Transcript not ready", status: job.status, job_id: id },
      { status: 409 }
    );
  }

  const titleForName = job.request.metadata?.title || "";
  const baseName = safeFileName(titleForName, id);
  const body =
    format === "md" ? formatMarkdown(job) : job.result.transcript_en.trim() + "\n";
  const contentType =
    format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${baseName}.${format}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
