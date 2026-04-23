/**
 * Audio transcription with Deepgram Nova-3 (primary) and Groq Whisper (fallback).
 *
 * Behavior:
 *   - "auto" (default): try Deepgram first; on hard failure, fall back to Groq
 *   - "deepgram": Deepgram only, error if all keys exhausted
 *   - "groq": Groq only
 *
 * Deepgram is preferred because:
 *   - Higher accuracy on Sanskrit/Bengali names
 *   - Built-in paragraphing + smart formatting
 *   - We have ~$1,400 of prepaid credits across 7 keys
 */

import { deepgramKeys, groq, groqKeys, rotateGroqKey } from "../clients";

const SANSKRIT_PROMPT =
  "Srimad Bhagavatam, Bhagavad-gita, Caitanya-caritamrita, Krishna, Krsna, Srila Prabhupada, " +
  "Hare Krishna, Caitanya Mahaprabhu, Nityananda, Vrindavan, Mayapur, Govardhana, Kali-yuga, " +
  "Damodarastaka, Siksastakam, Bhaktivedanta Swami, sankirtan, prasadam, japa, kirtan, bhakti, " +
  "guru, diksha, siksha, vani, vapu, sastra, sadhu, brahmana, dharma, karma, prema, rasa, lila, " +
  "acarya, Narada Muni, Vyasadeva, Sukadeva Gosvami, Maharaja Pariksit, Naimisaranya, " +
  "Haridas Thakur, Rupa Gosvami, Sanatana Gosvami, Niranjana Swami, Prabhupada said";

export interface TranscriptionResult {
  text: string;
  provider: "deepgram" | "groq";
  request_id?: string;
  duration_s?: number;
}

const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Deepgram ----------------------------------------------------------------

export async function transcribeWithDeepgram(
  audio: Buffer,
  contentType: string
): Promise<TranscriptionResult> {
  const keys = deepgramKeys();
  if (keys.length === 0) throw new Error("No Deepgram API keys configured");

  let keyIdx = 0;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-3&language=en" +
          "&punctuate=true&paragraphs=true&smart_format=true",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${keys[keyIdx]}`,
            "Content-Type": contentType,
          },
          body: audio as unknown as BodyInit,
        }
      );

      // Rate-limit / credit exhaustion → rotate key and retry
      if (res.status === 429 || res.status === 402) {
        if (keyIdx + 1 < keys.length) {
          keyIdx++;
          await sleep(1000);
          continue;
        }
        throw new Error(`Deepgram: all keys exhausted (${res.status})`);
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Deepgram ${res.status}: ${errText.substring(0, 200)}`);
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

// --- Groq Whisper ------------------------------------------------------------

export async function transcribeWithGroq(
  audio: Buffer,
  filename = "audio.mp3"
): Promise<TranscriptionResult> {
  if (groqKeys().length === 0) throw new Error("No Groq API keys configured");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Groq SDK expects a File-like; build one from the buffer
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

      // Rate limit → rotate key
      if (status === 429 || /rate_limit|429/i.test(msg)) {
        if (rotateGroqKey()) {
          await sleep(1500);
          continue;
        }
        // All keys exhausted → exponential backoff
        const waitMs = Math.min(60_000 * 2 ** (attempt - 1), 300_000);
        await sleep(waitMs);
        continue;
      }

      // Hard failure (413 too large, malformed, etc.) → bubble up
      throw err;
    }
  }
  throw new Error("Groq: max retries exceeded");
}

// --- Orchestration -----------------------------------------------------------

export async function transcribe(
  audio: Buffer,
  contentType: string,
  provider: "auto" | "deepgram" | "groq" = "auto"
): Promise<TranscriptionResult> {
  if (provider === "deepgram") {
    return transcribeWithDeepgram(audio, contentType);
  }
  if (provider === "groq") {
    return transcribeWithGroq(audio);
  }

  // auto: Deepgram first, Groq fallback
  try {
    return await transcribeWithDeepgram(audio, contentType);
  } catch (err) {
    if (groqKeys().length > 0) {
      console.warn(
        `[transcribe] Deepgram failed, falling back to Groq: ${(err as Error).message}`
      );
      return transcribeWithGroq(audio);
    }
    throw err;
  }
}
