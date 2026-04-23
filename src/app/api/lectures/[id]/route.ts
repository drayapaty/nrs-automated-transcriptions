/**
 * GET /api/lectures/:id
 *
 * Lists all language rows for a lecture.
 *
 * Query params:
 *   ?include_text=true   Bundle full transcript text in the response.
 *                        Default false — returns lightweight metadata only.
 *
 * Response (lightweight):
 *   {
 *     lecture_id: string,
 *     languages: [
 *       { lang, chars, words, metadata, created_at, updated_at, source_job_id }
 *     ]
 *   }
 *
 * Response (with text):
 *   { lecture_id, languages: [{ lang, text, chars, words, ... }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listLectureLanguages } from "@/lib/lectures";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id: lecture_id } = await ctx.params;
  const includeText = req.nextUrl.searchParams.get("include_text") === "true";

  try {
    const rows = await listLectureLanguages(lecture_id, { includeText });
    return NextResponse.json({
      lecture_id,
      languages: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
