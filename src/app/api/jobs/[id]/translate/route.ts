/**
 * POST /api/jobs/:id/translate
 *
 * Add additional language translations to an already-completed job.
 * Reads the English transcript from the job result, runs translation,
 * persists to nrs-lectures-auto-transcribe, and returns the new translations.
 *
 * Body: { langs: ("ru" | "uk")[] }
 *
 * Response: 200
 *   {
 *     job_id,
 *     translations: { ru?: string, uk?: string }
 *   }
 *
 * 404 if no such job. 409 if job not yet done (or has no transcript).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/auth";
import { getJob, setStatus, setResult } from "@/lib/jobs";
import { translate } from "@/lib/pipeline/translate";
import { upsertLectureDoc } from "@/lib/pipeline/index-lectures";
import { putLecture } from "@/lib/lectures";
import { CLAUDE_MODEL } from "@/lib/clients";
import type { Language } from "@/lib/types";

const Body = z.object({
  langs: z.array(z.enum(["ru", "uk"])).min(1),
  /**
   * If true, run synchronously and return translations in response.
   * If false (default), run in background — caller polls GET /api/jobs/:id
   * which will show updated translations once done.
   */
  sync: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found", job_id: id }, { status: 404 });
  }
  if (job.status !== "done" || !job.result?.transcript_en) {
    return NextResponse.json(
      {
        error: "Job not in 'done' state or has no transcript_en",
        current_status: job.status,
      },
      { status: 409 }
    );
  }

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
  const { langs, sync } = parsed.data;

  const englishText = job.result.transcript_en;
  const lecture_id = job.request.metadata?.uuid;

  async function runTranslations(): Promise<Partial<Record<Language, string>>> {
    await setStatus(id, "translating", { stage: "translating", pct: 50 });
    const existing: Partial<Record<Language, string>> = {
      ...(job!.result?.translations || {}),
    };

    // Translate + persist all languages IN PARALLEL so total wall-clock =
    // max(per-lang time), not sum. Critical on Hobby plan (300s function cap).
    const per = await Promise.all(
      langs.map(async (lang) => {
        const translated = await translate(englishText, lang);
        if (lecture_id) {
          await putLecture(lecture_id, lang, translated, {
            metadata: {
              ...(job!.request.metadata || {}),
              transcription_provider: job!.result?.metadata.transcription_provider,
              translation_model: CLAUDE_MODEL,
            },
            source_job_id: id,
          });

          // Mirror to OpenSearch nrs-lectures-auto-transcribe if the original
          // job was indexed.
          if (job!.request.index) {
            await upsertLectureDoc({
              lecture_id,
              lang,
              text: translated,
              metadata: job!.request.metadata,
              transcription_provider: job!.result?.metadata.transcription_provider,
              translation_model: CLAUDE_MODEL,
              source_job_id: id,
            });
          }
        }
        return [lang, translated] as const;
      })
    );

    const out: Partial<Record<Language, string>> = { ...existing };
    for (const [lang, text] of per) out[lang] = text;

    await setResult(id, {
      ...job!.result!,
      translations: out,
      metadata: {
        ...job!.result!.metadata,
        translation_model: CLAUDE_MODEL,
      },
    });
    return out;
  }

  if (sync) {
    try {
      const translations = await runTranslations();
      return NextResponse.json({ job_id: id, translations });
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 500 }
      );
    }
  }

  waitUntil(runTranslations());
  return NextResponse.json(
    { job_id: id, status: "translating", langs, poll_url: `/api/jobs/${id}` },
    { status: 202 }
  );
}
