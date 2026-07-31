/**
 * Multi-speaker conversation transcription pipeline.
 *
 * Groq Whisper (word-level timestamps, IAST quality) + Deepgram (speaker
 * diarization labels) merged by timestamp alignment, then Sonnet IAST cleanup.
 *
 * Requires ffmpeg for time-based audio chunking.
 */

import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { groqKeys, deepgramKeys, anthropic, CLAUDE_MODEL } from "../clients";

export interface TimestampedWord {
  word: string;
  start: number;
  end: number;
}

export interface SpeakerWord extends TimestampedWord {
  speaker: number;
}

export interface DiarizationResult {
  dgWords: { speaker: number; start: number; end: number }[];
  numSpeakers: number;
}

const SANSKRIT_PROMPT =
  "Srimad Bhagavatam, Bhagavad-gita, Caitanya-caritamrita, Brihad-bhagavatamrita, " +
  "Krishna, Krsna, Srila Prabhupada, Hare Krishna, Caitanya Mahaprabhu, Nityananda, " +
  "Vrindavan, Mayapur, Govardhana, Bhaktivedanta Swami, sankirtan, prasadam, japa, " +
  "kirtan, bhakti, guru, sastra, sadhu, brahmana, dharma, karma, prema, rasa, lila, " +
  "acarya, Narada Muni, Vyasadeva, Sukadeva Gosvami, Prahlada Maharaja, Uddhava, " +
  "Rupa Gosvami, Sanatana Gosvami, Nrsimha, Niranjana Swami.";

const MAX_RETRIES = 5;
const CHUNK_SECS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Groq Whisper with word-level timestamps.
 * Uses raw fetch (not SDK) because timestamp_granularities needs verbose_json.
 * Chunks audio into 2-min segments via ffmpeg for reliability.
 */
export async function transcribeWithWordTimestamps(
  audioPath: string
): Promise<TimestampedWord[]> {
  const totalDuration = parseFloat(
    execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { encoding: "utf-8" }
    ).trim()
  );

  const numChunks = Math.ceil(totalDuration / CHUNK_SECS);
  const tmp = mkdtempSync(join(tmpdir(), "nrs-diarize-"));
  const allWords: TimestampedWord[] = [];

  const keys = groqKeys();
  if (keys.length === 0) throw new Error("No Groq API keys configured");
  let keyIdx = 0;

  console.log(
    `[groq-words] ${(totalDuration / 60).toFixed(1)} min → ${numChunks} chunks`
  );

  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SECS;
    const chunkPath = join(tmp, `chunk_${i}.mp3`);
    execSync(
      `ffmpeg -y -ss ${start} -t ${CHUNK_SECS} -i "${audioPath}" ` +
        `-codec:a libmp3lame -b:a 128k "${chunkPath}" 2>/dev/null`
    );
    const chunkBuf = readFileSync(chunkPath);

    let data: { words?: { word: string; start: number; end: number }[] } | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const form = new FormData();
      form.append(
        "file",
        new Blob([chunkBuf], { type: "audio/mpeg" }),
        `chunk_${i}.mp3`
      );
      form.append("model", "whisper-large-v3");
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      form.append("language", "en");
      form.append("prompt", SANSKRIT_PROMPT);

      const res = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${keys[keyIdx]}` },
          body: form,
        }
      );

      if (res.ok) {
        data = await res.json();
        break;
      }

      if (res.status === 429) {
        if (keyIdx + 1 < keys.length) {
          keyIdx++;
          await sleep(1500);
          continue;
        }
        await sleep(Math.min(5000 * (attempt + 1), 30000));
        continue;
      }

      const err = await res.text();
      throw new Error(`Groq chunk ${i}: ${res.status} ${err}`);
    }

    if (!data) throw new Error(`Groq chunk ${i}: no response after ${MAX_RETRIES} attempts`);

    const words = (data.words || []).map((w) => ({
      word: w.word,
      start: w.start + start,
      end: w.end + start,
    }));
    allWords.push(...words);
    process.stdout.write(`  chunk ${i + 1}/${numChunks}: ${words.length} words\n`);

    try {
      unlinkSync(chunkPath);
    } catch {}
    if (i < numChunks - 1) await sleep(1000);
  }

  try {
    execSync(`rm -rf "${tmp}"`);
  } catch {}

  console.log(`  Total: ${allWords.length} words`);
  return allWords;
}

/**
 * Deepgram diarization — returns word-level speaker labels.
 * Uses nova-2 (speaker diarization not available on nova-3 for raw upload).
 */
export async function diarize(audioBuf: Buffer): Promise<DiarizationResult> {
  const keys = deepgramKeys();
  if (keys.length === 0) throw new Error("No Deepgram API keys configured");

  console.log("[deepgram] diarizing...");
  let keyIdx = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&utterances=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${keys[keyIdx]}`,
          "Content-Type": "audio/mpeg",
        },
        body: new Uint8Array(audioBuf),
      }
    );

    if ([401, 402, 403, 429].includes(res.status)) {
      if (keyIdx + 1 < keys.length) {
        console.warn(
          `[deepgram] key ${keyIdx + 1}/${keys.length} returned ${res.status}; rotating`
        );
        keyIdx++;
        await sleep(500);
        continue;
      }
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Deepgram: ${res.status} ${err.substring(0, 400)}`);
    }

    const data = await res.json();
    const dgWords = (
      data.results?.channels?.[0]?.alternatives?.[0]?.words || []
    ).map((w: { speaker: number; start: number; end: number }) => ({
      speaker: w.speaker,
      start: w.start,
      end: w.end,
    }));

    const numSpeakers = new Set(dgWords.map((w: { speaker: number }) => w.speaker)).size;
    console.log(
      `  ${dgWords.length} words, ${numSpeakers} speakers detected`
    );
    return { dgWords, numSpeakers };
  }

  throw new Error("Deepgram: max retries exceeded");
}

/**
 * Merge Whisper text with Deepgram speaker labels by timestamp alignment.
 * For each Whisper word, find the closest Deepgram word and copy its speaker ID.
 */
export function mergeSpeakers(
  whisperWords: TimestampedWord[],
  dgWords: { speaker: number; start: number; end: number }[]
): SpeakerWord[] {
  return whisperWords.map((ww) => {
    const mid = (ww.start + ww.end) / 2;
    let bestDist = Infinity;
    let bestSpeaker = 0;
    for (const dw of dgWords) {
      const dist = Math.abs(dw.start - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestSpeaker = dw.speaker;
      }
      if (dw.start > mid + 5) break;
    }
    return { ...ww, speaker: bestSpeaker };
  });
}

/**
 * Format merged words as a markdown conversation transcript.
 */
export function formatConversation(
  mergedWords: SpeakerWord[],
  speakerNames?: Record<number, string>
): string {
  if (mergedWords.length === 0) return "";

  const nameOf = (s: number) => speakerNames?.[s] || `Speaker ${s}`;
  const lines: string[] = [];
  let currentSpeaker = mergedWords[0].speaker;
  let currentWords: string[] = [];
  let segStart = mergedWords[0].start;

  for (const w of mergedWords) {
    if (w.speaker !== currentSpeaker) {
      const mins = Math.floor(segStart / 60);
      const secs = Math.floor(segStart % 60);
      const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      lines.push(`**[${ts}] ${nameOf(currentSpeaker)}:**`);
      lines.push(currentWords.join(" "));
      lines.push("");

      currentSpeaker = w.speaker;
      currentWords = [w.word];
      segStart = w.start;
    } else {
      currentWords.push(w.word);
    }
  }

  const mins = Math.floor(segStart / 60);
  const secs = Math.floor(segStart % 60);
  const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  lines.push(`**[${ts}] ${nameOf(currentSpeaker)}:**`);
  lines.push(currentWords.join(" "));

  return lines.join("\n");
}

/**
 * Sonnet cleanup for diarized transcript — IAST + optional speaker name mapping.
 */
export async function cleanupConversation(
  rawTranscript: string,
  speakerNames?: Record<number, string>
): Promise<string> {
  const speakerList = speakerNames
    ? Object.entries(speakerNames)
        .map(([id, name]) => `- Speaker ${id} → ${name}`)
        .join("\n")
    : "Speaker identities unknown — keep the generic Speaker N labels.";

  const systemPrompt = `You are a Vaiṣṇava transcription editor for H.H. Nirañjana Svāmī's recordings.

Your task: clean up a multi-speaker conversation transcript generated by Whisper + Deepgram diarization.

SPEAKER MAPPING:
${speakerList}

IAST CORRECTIONS — fix all Sanskrit transliteration to proper IAST:
- Proper diacritics: ā ī ū ṛ ḷ ṅ ñ ṭ ḍ ṇ ś ṣ ḥ ṁ
- Names: Kṛṣṇa, Nārada, Prahlāda, Uddhava, Brahmā, Śiva, Śrīla Prabhupāda, Sanātana Gosvāmī, Rūpa Gosvāmī, Jīva Gosvāmī, Raghunātha Dāsa Gosvāmī, Kṛṣṇadāsa Kavirāja, Bhaktivinoda Ṭhākura, Bhaktisiddhānta Sarasvatī, Viśvanātha Cakravartī Ṭhākura, Baladeva Vidyābhūṣaṇa, etc.
- Scriptures: Śrīmad-Bhāgavatam, Bhagavad-gītā, Caitanya-caritāmṛta, Bṛhad-bhāgavatāmṛta
- Terms: bhakti, prema, rasa, līlā, sevā, nāma, kīrtana, saṅkīrtana, harināma, prasāda, japa, ācārya, śāstra, sādhu
- Verse references: keep as-is (SB 1.4.17, BG 2.40, etc.)

FORMAT:
- Keep the **[MM:SS] Speaker Name:** format
- Replace generic "Speaker N" with the mapped name when provided
- Merge consecutive same-speaker segments that are clearly one continuous thought (< 5s gap)
- Fix obvious Whisper errors (wrong words, garbled names)
- Keep the conversational tone — don't formalize casual speech
- Preserve all content — don't summarize or omit
- Break long speaker turns into readable paragraphs

Output the cleaned transcript only, no commentary.`;

  const MAX_CHUNK = 10_000;
  const lines = rawTranscript.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    if (
      currentLen + line.length > MAX_CHUNK &&
      current.length > 0 &&
      line.startsWith("**[")
    ) {
      chunks.push(current.join("\n"));
      current = [line];
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen += line.length;
    }
  }
  if (current.length) chunks.push(current.join("\n"));

  console.log(`[cleanup] ${chunks.length} chunks`);
  const results: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
    const response = await anthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16_000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Clean up this section of the transcript:\n\n${chunks[i]}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    results.push(
      (block as { text?: string } | undefined)?.text || chunks[i]
    );
  }

  return results.join("\n\n");
}
