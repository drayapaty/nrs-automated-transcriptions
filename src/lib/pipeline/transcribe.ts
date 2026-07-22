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

// Whisper `prompt` field — biases decoding toward Vaiṣṇava vocabulary AND
// verse-shape audio. Whisper's prompt cap is ~224 tokens; we include a noun
// bank (proper nouns, common concepts) plus 3 sample Sanskrit verses. Verified
// empirically: including sample verses makes Whisper preserve verse-length
// Sanskrit that the noun-only version silently drops (Maharaja's SB 11.14.15
// citation was dropped by noun-only prompt, preserved when sample verses added).
const SANSKRIT_PROMPT =
  // Nouns / concepts (~40 terms)
  "Srimad Bhagavatam, Bhagavad-gita, Caitanya-caritamrita, Brihad-bhagavatamrita, " +
  "Krishna, Krsna, Srila Prabhupada, Hare Krishna, Caitanya Mahaprabhu, Nityananda, " +
  "Vrindavan, Mayapur, Govardhana, Bhaktivedanta Swami, sankirtan, prasadam, japa, " +
  "kirtan, bhakti, guru, sastra, sadhu, brahmana, dharma, karma, prema, rasa, lila, " +
  "acarya, Narada Muni, Vyasadeva, Sukadeva Gosvami, Prahlada Maharaja, Uddhava, " +
  "Rupa Gosvami, Sanatana Gosvami, Nrsimha, Niranjana Swami. " +
  // Sample verses to prime Whisper on verse-shape audio
  "nehābhikrama-nāśo 'sti pratyavāyo na vidyate " +
  "svalpam apy asya dharmasya trāyate mahato bhayāt. " +
  "namas te narasiṁhāya prahlādāhlāda-dāyine " +
  "hiraṇyakaśipor vakṣaḥ-śilā-ṭaṅka-nakhālaye. " +
  "Hare Kṛṣṇa Hare Kṛṣṇa Kṛṣṇa Kṛṣṇa Hare Hare " +
  "Hare Rāma Hare Rāma Rāma Rāma Hare Hare.";

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

// --- MP3 bitrate detection (no external deps, pure header parsing) -----------
//
// Reads the first valid MPEG audio frame header to determine bitrate, then
// calculates the byte offset for ~2-min time-based chunks. This lets us do
// time-based splitting in Vercel (no ffmpeg) by slicing the Buffer.

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

function detectMp3BitrateKbps(buf: Buffer): number {
  const limit = Math.min(buf.length - 4, 16384);
  for (let i = 0; i < limit; i++) {
    if (buf[i] !== 0xFF || (buf[i + 1] & 0xE0) !== 0xE0) continue;
    const versionBits = (buf[i + 1] >> 3) & 0x03;
    const layerBits = (buf[i + 1] >> 1) & 0x03;
    const brIdx = (buf[i + 2] >> 4) & 0x0F;
    if (brIdx === 0 || brIdx === 15) continue;
    if (layerBits === 0x01) {
      // Layer III
      if (versionBits === 0x03) return MPEG1_L3_BITRATES[brIdx];   // MPEG1
      if (versionBits === 0x02 || versionBits === 0x00) return MPEG2_L3_BITRATES[brIdx]; // MPEG2/2.5
    }
  }
  return 64; // safe fallback — yields ~2.8 min chunks at 120s target
}

// --- Groq Whisper (now PRIMARY for NRS lectures, with 2-min time chunking) ---
//
// Whisper drops content when processing long audio in a single call — even for
// files well under its 25 MB limit. Empirically tested: 2-min time-based
// chunks recover 51% more content than a single-call transcription. Shorter
// (1-min) chunks fail because Whisper needs ~90s minimum context.
//
// Since ffmpeg is unavailable in Vercel, we parse the MP3 bitrate from the
// frame header and calculate byte offsets for ~2-min segments. MP3 frame sync
// breaks at slice boundaries but Whisper tolerates the brief glitch.
//
// response_format MUST be "json" — Groq's "text" format silently returns empty
// on some segments (confirmed bug, not rate-limiting).

const TARGET_CHUNK_SECS = 120; // 2 minutes — empirically optimal

export async function transcribeWithGroqChunked(
  audio: Buffer
): Promise<TranscriptionResult> {
  const bitrateKbps = detectMp3BitrateKbps(audio);
  const bytesPerSec = (bitrateKbps * 1000) / 8;
  const chunkBytes = Math.floor(bytesPerSec * TARGET_CHUNK_SECS);
  const estimatedDuration = audio.byteLength / bytesPerSec;

  // Short audio (< 3 min) — single call is fine
  if (estimatedDuration <= 180) {
    console.log(`[groq] short audio (~${Math.round(estimatedDuration)}s), single call`);
    return transcribeWithGroq(audio);
  }

  const chunks: Buffer[] = [];
  for (let i = 0; i < audio.byteLength; i += chunkBytes) {
    const end = Math.min(i + chunkBytes, audio.byteLength);
    // Skip tiny tail fragments (< 5s of audio)
    if (end - i < bytesPerSec * 5 && chunks.length > 0) {
      // Append tail to last chunk instead of creating a tiny segment
      const last = chunks[chunks.length - 1];
      chunks[chunks.length - 1] = Buffer.concat([last, audio.subarray(i, end)]);
    } else {
      chunks.push(audio.subarray(i, end));
    }
  }

  console.log(
    `[groq] ${bitrateKbps} kbps, ~${Math.round(estimatedDuration)}s → ` +
    `${chunks.length} × ~${TARGET_CHUNK_SECS}s chunks (${(chunkBytes / 1024).toFixed(0)} KB each)`
  );

  const texts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].byteLength > GROQ_MAX_BYTES) {
      // Chunk exceeds Whisper limit (very high bitrate) — sub-split by bytes
      const subChunks: Buffer[] = [];
      const subSize = GROQ_MAX_BYTES - 1024 * 1024;
      for (let j = 0; j < chunks[i].byteLength; j += subSize) {
        subChunks.push(chunks[i].subarray(j, Math.min(j + subSize, chunks[i].byteLength)));
      }
      for (let s = 0; s < subChunks.length; s++) {
        const r = await transcribeWithGroq(subChunks[s], `chunk_${i}_${s}.mp3`);
        texts.push(r.text);
      }
    } else {
      const r = await transcribeWithGroq(chunks[i], `chunk_${i}.mp3`);
      texts.push(r.text);
    }
    // Pace requests to avoid rate limits (1s between chunks)
    if (i < chunks.length - 1) await sleep(1000);
  }
  return { text: texts.join(" "), provider: "groq" };
}

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
        response_format: "json",
        prompt: SANSKRIT_PROMPT,
      });

      const text = typeof response === "string"
        ? response
        : (response as { text?: string }).text || "";

      return { text, provider: "groq" };
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
    return transcribeWithGroqChunked(buffer);
  }

  // auto: Groq Whisper PRIMARY (multilingual — captures Sanskrit prayers +
  // verses Maharaja recites), Deepgram URL mode FALLBACK (handles cases
  // where Groq is rate-limited / down or audio is so large we want the
  // single-call URL mode). Reversed from the original order: Deepgram
  // nova-3 English-only filters Sanskrit chants as non-speech and silently
  // drops them, so the opening praṇāmas never made it into the transcript.
  if (groqKeys().length > 0) {
    try {
      const { buffer } = await downloadBuffer(audioUrl);
      return await transcribeWithGroqChunked(buffer);
    } catch (err) {
      console.warn(
        `[transcribe] Groq Whisper failed, falling back to Deepgram: ${(err as Error).message}`
      );
    }
  }
  return transcribeWithDeepgramUrl(audioUrl);
}
