/**
 * GET    /api/lectures/:id/:lang   → fetch transcript for a (lecture, lang) pair
 * POST   /api/lectures/:id/:lang   → upsert transcript (manual upload, bypassing pipeline)
 * DELETE /api/lectures/:id/:lang   → remove a transcript row
 *
 * `lang` is an ISO 639-1 code: "en", "ru", "uk", etc.
 *
 * POST body:
 *   {
 *     text: string,                       // required
 *     metadata?: { title, date, ... },    // optional
 *     source_job_id?: string              // optional
 *   }
 *
 * GET response:
 *   {
 *     lecture_id, lang, text, chars, words,
 *     metadata, source_job_id, created_at, updated_at
 *   }
 *
 * GET 404 if not found.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  getLecture,
  putLecture,
  deleteLecture,
  type LectureRowMetadata,
} from "@/lib/lectures";

const PostBody = z.object({
  text: z.string().min(1, "text is required"),
  metadata: z.record(z.unknown()).optional(),
  source_job_id: z.string().optional(),
});

const LangCode = /^[a-z]{2}(-[a-z]{2})?$/i; // "en", "ru", "uk", "pt-br", ...

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; lang: string }> }
) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id: lecture_id, lang } = await ctx.params;
  if (!LangCode.test(lang)) {
    return NextResponse.json(
      { error: `Invalid lang code: ${lang}` },
      { status: 400 }
    );
  }

  try {
    const row = await getLecture(lecture_id, lang.toLowerCase());
    if (!row) {
      return NextResponse.json(
        { error: "Not found", lecture_id, lang },
        { status: 404 }
      );
    }
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; lang: string }> }
) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id: lecture_id, lang } = await ctx.params;
  if (!LangCode.test(lang)) {
    return NextResponse.json(
      { error: `Invalid lang code: ${lang}` },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    const row = await putLecture(lecture_id, lang.toLowerCase(), parsed.data.text, {
      metadata: parsed.data.metadata as LectureRowMetadata | undefined,
      source_job_id: parsed.data.source_job_id,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; lang: string }> }
) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id: lecture_id, lang } = await ctx.params;
  if (!LangCode.test(lang)) {
    return NextResponse.json(
      { error: `Invalid lang code: ${lang}` },
      { status: 400 }
    );
  }

  try {
    await deleteLecture(lecture_id, lang.toLowerCase());
    return NextResponse.json({ ok: true, lecture_id, lang });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
