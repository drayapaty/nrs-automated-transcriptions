/**
 * Audio transcription with Deepgram Nova-3 (primary) and Groq Whisper (fallback).
 *
 * Deepgram uses URL mode — Deepgram fetches the presigned S3 URL itself,
 * no upload, no Vercel-side payload constraints, no file-size limit (2 GB ceiling).
 *
 * Groq is used as a fallback only, and only for files ≤ 24 MB (Whisper's
 * 25 MB hard limit). For larger files we skip Groq rather than waste a call.
 *
 * Provider selection:
 *   - "auto" (default): Deepgram URL → Groq (if small enough)
 *   - "deepgram":       Deepgram URL only
 *   - "groq":           Groq only (requires separate download; fails if >24 MB)
 */

import { deepgramKeys, groq, groqKeys, rotateGroqKey } from "../clients";

const SANSKRIT_PROMPT =
  "Srimad Bhagavatam, Bhagavad-gita, Caitanya-caritamrita, Krishna, Krsna, Srila Prabhupada, " +
  "Hare Krishna, Caitanya Mahaprabhu, Nityananda, Vrindavan, Mayapur, Govardhana, Kali-yuga, " +
  "Damodarastaka, Siksastakam, Bhaktivedanta Swami, sankirtan, prasadam, japa, kirtan, bhakti, " +
  "guru, diksha, siksha, vani, vapu, sastra, sadhu, brahmana, dharma, karma, prema, rasa, lila, " +
  "acarya, Narada Muni, Vyasadeva, Sukadeva Gosvami, Maharaja Pariksit, Naimisaranya, " +
  "Haridas Thakur, Rupa Gosvami, Sanatana Gosvami, Niranjana Swami, Prabhupada said";

// Deepgram Nova-3 KEYTERM PROMPTING — boosts recognition of these terms in the
// PRIMARY Deepgram path (previously SANSKRIT_PROMPT only fed the Groq fallback,
// so Deepgram guessed Sanskrit blind: "harinama ruci" -> "Harinam Rooji").
//
// DELIBERATELY a small, DISTINCTIVE list of proper nouns + multi-syllable terms.
// Do NOT add common chant words (Krishna, Hare Krishna, Rama, Hare, guru, bhakti,
// nama, japa, dharma…): Deepgram already knows them, and boosting high-frequency
// words makes it HALLUCINATE them — a full 100-term list injected a spurious
// "Krishna. Hare Krishna. Rama…" chant tail. Verified: this trimmed list keeps
// "harinama ruci" exact with no hallucinated tail.
const KEYTERMS: string[] = [
  "Srila Prabhupada", "Bhaktivedanta Swami", "Srimad Bhagavatam", "Bhagavad-gita",
  "Caitanya-caritamrita", "Caitanya Mahaprabhu", "Gauranga", "Nityananda",
  "Bhaktisiddhanta Sarasvati", "Bhaktivinoda Thakura", "Visvanatha Cakravarti",
  "Baladeva Vidyabhusana", "Jiva Gosvami", "Rupa Gosvami", "Sanatana Gosvami",
  "Raghunatha dasa Gosvami", "Krsnadasa Kaviraja", "Narottama dasa Thakura",
  "Niranjana Swami", "harinama ruci", "sankirtana", "prasadam", "arcana",
  "Vrindavan", "Mayapur", "Gaudiya", "Vaishnava", "sampradaya", "parampara",
  "Damodarastaka", "Siksastakam",
];

// Repeated `keyterm=` params, each term URL-encoded (spaces preserved as %20 so
// multi-word phrases stay one term).
const KEYTERM_QS = KEYTERMS.map((t) => `keyterm=${encodeURIComponent(t)}`).join("&");

export interface TranscriptionResult {
  text: string;
  provider: "deepgram" | "groq";
  request_id?: string;
  duration_s?: number;
}

const MAX_RETRIES = 5;
const GROQ_MAX_BYTES = 24 * 1024 * 1024; // Whisper hard limit is 25 MB; leave a margin
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Deepgram (URL mode) -----------------------------------------------------

export async function transcribeWithDeepgramUrl(
  audioUrl: string
): Promise<TranscriptionResult> {
  const keys = deepgramKeys();
  if (keys.length === 0) throw new Error("No Deepgram API keys configured");

  let keyIdx = 0;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-3&language=en" +
          "&punctuate=true&paragraphs=true&smart_format=true" +
          (KEYTERM_QS ? `&${KEYTERM_QS}` : ""),
        {
          method: "POST",
          headers: {
            Authorization: `Token ${keys[keyIdx]}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: audioUrl }),
        }
      );

      // Key-specific failures → rotate and retry:
      //   401 = invalid credentials (revoked/deleted key)
      //   402 = credits exhausted on this key
      //   403 = key lacks permissions
      //   429 = rate limited on this key
      if ([401, 402, 403, 429].includes(res.status)) {
        if (keyIdx + 1 < keys.length) {
          const errText = await res.text().catch(() => "");
          console.warn(
            `[deepgram] key ${keyIdx + 1}/${keys.length} returned ${res.status}; rotating. ${errText.substring(0, 120)}`
          );
          keyIdx++;
          await sleep(500);
          continue;
        }
        throw new Error(`Deepgram: all keys exhausted (${res.status})`);
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          `Deepgram ${res.status}: ${errText.substring(0, 400)}`
        );
      }

      const data = await res.json();
      const transcript: string =
        data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
      const duration_s: number | undefined = data?.metadata?.duration;
      const request_id: string | undefined = data?.metadata?.request_id;

      if (!transcript) throw new Error("Deepgram returned empty transcript");

      return {
        text: transcript,
        provider: "deepgram",
        request_id,
        duration_s,
      };
    } catch (err: unknown) {
      lastErr = err as Error;
      if (attempt < MAX_RETRIES && !/all keys exhausted/.test(lastErr.message)) {
        await sleep(3000 * attempt);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error("Deepgram: max retries exceeded");
}

// --- Groq Whisper (fallback, requires local buffer) -------------------------

export async function transcribeWithGroq(
  audio: Buffer,
  filename = "audio.mp3"
): Promise<TranscriptionResult> {
  if (groqKeys().length === 0) throw new Error("No Groq API keys configured");
  if (audio.byteLength > GROQ_MAX_BYTES) {
    throw new Error(
      `Groq Whisper hard limit is 25 MB; file is ${(
        audio.byteLength /
        1024 /
        1024
      ).toFixed(1)} MB. Use Deepgram URL mode instead.`
    );
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const file = new File([new Uint8Array(audio)], filename, {
        type: "audio/mpeg",
      });

      const response = await groq().audio.transcriptions.create({
        model: "whisper-large-v3",
        file,
        language: "en",
        response_format: "text",
        prompt: SANSKRIT_PROMPT,
      });

      return {
        text: (response as unknown as string) || "",
        provider: "groq",
      };
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      const status = e.status || 0;
      const msg = e.message || "";

      if (status === 429 || /rate_limit|429/i.test(msg)) {
        if (rotateGroqKey()) {
          await sleep(1500);
          continue;
        }
        const waitMs = Math.min(60_000 * 2 ** (attempt - 1), 300_000);
        await sleep(waitMs);
        continue;
      }

      throw err;
    }
  }
  throw new Error("Groq: max retries exceeded");
}

// --- HEAD the S3 URL to get size (for Groq eligibility decisions) -----------

async function probeSize(audioUrl: string): Promise<number | null> {
  try {
    const res = await fetch(audioUrl, { method: "HEAD" });
    const n = parseInt(res.headers.get("content-length") || "0", 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function downloadBuffer(audioUrl: string): Promise<{ buffer: Buffer; bytes: number }> {
  const res = await fetch(audioUrl, { method: "GET" });
  if (!res.ok) throw new Error(`Audio download failed: ${res.status}`);
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), bytes: ab.byteLength };
}

// --- Orchestration -----------------------------------------------------------

export async function transcribe(
  audioUrl: string,
  provider: "auto" | "deepgram" | "groq" = "auto"
): Promise<TranscriptionResult> {
  if (provider === "deepgram") {
    return transcribeWithDeepgramUrl(audioUrl);
  }

  if (provider === "groq") {
    const { buffer } = await downloadBuffer(audioUrl);
    return transcribeWithGroq(buffer);
  }

  // auto: Deepgram URL mode first (no size limit). Groq fallback only for
  // small files — otherwise we'd hit the same 413 problem that broke the
  // earlier job.
  try {
    return await transcribeWithDeepgramUrl(audioUrl);
  } catch (err) {
    if (groqKeys().length === 0) throw err;

    const size = await probeSize(audioUrl);
    if (size === null || size > GROQ_MAX_BYTES) {
      console.warn(
        `[transcribe] Deepgram failed and file is ${
          size !== null ? (size / 1024 / 1024).toFixed(1) + "MB" : "unknown size"
        } — skipping Groq fallback (would exceed 25 MB limit). ` +
          `Deepgram error: ${(err as Error).message}`
      );
      throw err;
    }

    console.warn(
      `[transcribe] Deepgram failed, falling back to Groq (${(
        size /
        1024 /
        1024
      ).toFixed(1)}MB): ${(err as Error).message}`
    );
    const { buffer } = await downloadBuffer(audioUrl);
    return transcribeWithGroq(buffer);
  }
}
