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
import { upsertLectureDoc } from "./pipeline/index-lectures";
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

      // Mirror to OpenSearch nrs-lectures-auto-transcribe (whole-doc index)
      if (req.index) {
        await upsertLectureDoc({
          lecture_id: req.metadata.uuid,
          lang: "en",
          text: englishText,
          metadata: req.metadata,
          transcription_provider: tr.provider,
          cleanup_model: req.paragraph === false ? undefined : CLAUDE_MODEL,
          source_job_id: job_id,
        });
      }
    }

    // -- Stage 4: translations (optional) ------------------------------------
    const translations: Partial<Record<Language, string>> = {};
    if (req.translate && req.translate.length > 0) {
      const total = req.translate.length;
      for (let i = 0; i < total; i++) {
        const lang = req.translate[i];
        const pct = 55 + Math.round((i / total) * 25); // 55 → 80
        await setStatus(job_id, "translating", {
          stage: "translating",
          pct,
          message: `→ ${lang}`,
        });
        const translated = await translate(englishText, lang);
        translations[lang] = translated;

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

          // Mirror translations to OpenSearch nrs-lectures-auto-transcribe
          if (req.index) {
            await upsertLectureDoc({
              lecture_id: req.metadata.uuid,
              lang,
              text: translated,
              metadata: req.metadata,
              transcription_provider: tr.provider,
              translation_model: CLAUDE_MODEL,
              source_job_id: job_id,
            });
          }
        }
      }
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
  }
}
