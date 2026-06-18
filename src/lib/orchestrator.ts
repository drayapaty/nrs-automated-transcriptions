/**
 * Pipeline orchestrator. Runs the full chain for a job:
 *
 *   download → transcribe → cleanup → (translate?) → (index?) → done
 *
 * After each stage completes, results are persisted:
 *   - English transcript  → nrs-lectures-auto-transcribe (lang="en")
 *   - Each translation    → nrs-lectures-auto-transcribe (lang=<code>)
 *   - Final job state     → nrs-transcribe-jobs
 *
 * If `request.callback_url` is set, POSTs the final job to that URL on completion.
 */

import type { Job, JobResult, Language } from "./types";
import { setStatus, setResult, setError } from "./jobs";
import { putLecture } from "./lectures";
import { transcribe } from "./pipeline/transcribe";
import { cleanupTranscript } from "./pipeline/cleanup";
import { translate } from "./pipeline/translate";
import { indexTranscript } from "./pipeline/index-opensearch";
import { sendCompletionEmail, sendFailureEmail } from "./email";
import { CLAUDE_MODEL } from "./clients";

function wordsOf(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

async function fireCallback(url: string, payload: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn(
      `[orchestrator] callback to ${url} failed: ${(err as Error).message}`
    );
  }
}

export async function runPipeline(job: Job): Promise<void> {
  const job_id = job.job_id;
  const req = job.request;

  try {
    // -- Stage 1: transcribe ------------------------------------------------
    // Deepgram URL mode — Deepgram fetches the presigned S3 URL itself.
    // No upload from the Vercel function, no size limit, no memory pressure.
    await setStatus(job_id, "transcribing", {
      stage: "transcribing",
      pct: 15,
      message: "via Deepgram URL mode",
    });
    const tr = await transcribe(req.s3_url, req.provider || "auto");

    // -- Stage 3: cleanup (paragraph + Sanskrit cleanup) --------------------
    let englishText = tr.text;
    if (req.paragraph !== false) {
      await setStatus(job_id, "cleaning", { stage: "cleaning", pct: 40 });
      englishText = await cleanupTranscript(tr.text);
    }

    // Persist EN immediately so it's queryable even if translations fail later
    if (req.metadata?.uuid) {
      // putLecture now writes to OpenSearch `nrs-lectures-auto-transcribe`
      // directly — no separate mirror step needed.
      await putLecture(req.metadata.uuid, "en", englishText, {
        metadata: {
          title: req.metadata.title,
          date: req.metadata.date,
          year: req.metadata.year,
          duration: req.metadata.duration,
          location: req.metadata.location,
          source_type: req.metadata.source_type || "lecture",
          transcription_provider: tr.provider,
          cleanup_model: req.paragraph === false ? undefined : CLAUDE_MODEL,
        },
        source_job_id: job_id,
      });
    }

    // -- Stage 4: translations (optional) ------------------------------------
    const translations: Partial<Record<Language, string>> = {};
    if (req.translate && req.translate.length > 0) {
      await setStatus(job_id, "translating", {
        stage: "translating",
        pct: 55,
        message: `→ ${req.translate.join(", ")} (parallel)`,
      });

      // Parallel fan-out — wall-clock = max(per-lang time), not sum.
      // Essential for Vercel Hobby's 300s function limit.
      const translatedPairs = await Promise.all(
        req.translate.map(async (lang) => {
          const translated = await translate(englishText, lang);
          if (req.metadata?.uuid) {
            await putLecture(req.metadata.uuid, lang, translated, {
              metadata: {
                title: req.metadata.title,
                date: req.metadata.date,
                year: req.metadata.year,
                duration: req.metadata.duration,
                location: req.metadata.location,
                source_type: req.metadata.source_type || "lecture",
                transcription_provider: tr.provider,
                translation_model: CLAUDE_MODEL,
              },
              source_job_id: job_id,
            });
          }
          return [lang, translated] as const;
        })
      );
      for (const [lang, text] of translatedPairs) translations[lang] = text;
    }

    // -- Stage 5: OpenSearch chunked indexing (optional) --------------------
    // Writes chunked + embedded English docs to `ask-nrs-lectures` for RAG.
    // English only — translations live in `nrs-lectures-auto-transcribe`
    // (whole-doc index, already written above during translation loop).
    let indexed_chunks: number | undefined;
    if (req.index) {
      if (!req.metadata?.uuid) {
        throw new Error("metadata.uuid is required when index=true");
      }
      await setStatus(job_id, "indexing", { stage: "indexing", pct: 85 });
      const idx = await indexTranscript(englishText, req.metadata);
      indexed_chunks = idx.indexed;
    }

    // -- Done ----------------------------------------------------------------
    const result: JobResult = {
      transcript_en: englishText,
      translations: Object.keys(translations).length ? translations : undefined,
      metadata: {
        duration_s: tr.duration_s,
        words: wordsOf(englishText),
        chars: englishText.length,
        deepgram_request_id: tr.request_id,
        transcription_provider: tr.provider,
        cleanup_model: req.paragraph === false ? "(skipped)" : CLAUDE_MODEL,
        translation_model:
          req.translate && req.translate.length ? CLAUDE_MODEL : undefined,
        indexed_chunks,
      },
    };
    await setResult(job_id, result);

    if (req.callback_url) {
      await fireCallback(req.callback_url, {
        job_id,
        status: "done",
        result,
      });
    }
    if (req.notify_email) {
      const finalJob: Job = {
        ...job,
        status: "done",
        result,
        finished_at: new Date().toISOString(),
      };
      const r = await sendCompletionEmail(req.notify_email, finalJob);
      if (!r.sent) {
        console.warn(`[orchestrator] notify email skipped: ${r.reason}`);
      }
    }
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[orchestrator] job ${job_id} failed: ${msg}`);
    await setError(job_id, msg);
    if (req.callback_url) {
      await fireCallback(req.callback_url, {
        job_id,
        status: "failed",
        error: msg,
      });
    }
    if (req.notify_email) {
      await sendFailureEmail(req.notify_email, job, msg);
    }
  }
}
