/**
 * POST /api/ui/upload-init
 *
 * Browser asks for a presigned URL it can PUT an mp3 to directly.
 * Body: { filename: string, contentType: string, size?: number }
 * Returns: { key, uploadUrl, expiresAt }
 *
 * Browser then PUTs file bytes to uploadUrl (no server transit, no
 * Vercel function body limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { presignUpload } from "@/lib/s3-upload";

const Body = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive().optional(),
});

// 500 MB hard cap — typical lecture mp3 is 50–150 MB.
const MAX_BYTES = 500 * 1024 * 1024;

const ALLOWED = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
]);

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
  const { filename, contentType, size } = parsed.data;
  if (!ALLOWED.has(contentType.toLowerCase())) {
    return NextResponse.json(
      {
        error: `Unsupported content type "${contentType}". Allowed: ${[...ALLOWED].join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (size && size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${size} bytes). Max ${MAX_BYTES} bytes.` },
      { status: 413 }
    );
  }
  try {
    const result = await presignUpload(filename, contentType);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
