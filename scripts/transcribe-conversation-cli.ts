#!/usr/bin/env npx tsx
/**
 * Multi-speaker conversation transcription pipeline.
 *
 * Usage:
 *   npx tsx scripts/transcribe-conversation-cli.ts <audio-file> [--speakers "0:Name One,1:Name Two"]
 *
 * Output: ~/Downloads/<slug>_{diarized_raw,diarized_cleaned,diarized_restored}.md
 *
 * Requires: node ≥18, ffmpeg, GROQ_API_KEY, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import {
  transcribeWithWordTimestamps,
  diarize,
  mergeSpeakers,
  formatConversation,
  cleanupConversation,
} from "../src/lib/pipeline/diarize";
import { restoreVerses } from "../src/lib/pipeline/verse-restore.mjs";

function parseSpeakers(arg?: string): Record<number, string> | undefined {
  if (!arg) return undefined;
  const map: Record<number, string> = {};
  for (const pair of arg.split(",")) {
    const [id, ...rest] = pair.split(":");
    if (id !== undefined && rest.length) map[parseInt(id)] = rest.join(":");
  }
  return Object.keys(map).length ? map : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const audioPath = args.find((a) => !a.startsWith("--"));
  const speakersIdx = args.indexOf("--speakers");
  const speakerNames =
    speakersIdx >= 0 ? parseSpeakers(args[speakersIdx + 1]) : undefined;

  if (!audioPath) {
    console.error(
      'Usage: npx tsx scripts/transcribe-conversation-cli.ts <audio-file> [--speakers "0:Name,1:Name"]'
    );
    process.exit(1);
  }

  const slug = audioPath
    .replace(/.*\//, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
  const downloadsDir = join(homedir(), "Downloads");
  const audioBuf = readFileSync(audioPath);

  console.log(`\nAudio: ${(audioBuf.length / 1024 / 1024).toFixed(1)} MB`);
  if (speakerNames) {
    console.log(`Speakers: ${JSON.stringify(speakerNames)}`);
  }

  const t0 = Date.now();

  // Stage 1: Groq Whisper (word timestamps) + Deepgram (speaker labels) in parallel
  console.log("\n=== Stage 1: Transcribe + Diarize (parallel) ===");
  const [whisperWords, diarization] = await Promise.all([
    transcribeWithWordTimestamps(audioPath),
    diarize(audioBuf),
  ]);
  console.log(`Whisper: ${whisperWords.length} words`);
  console.log(
    `Deepgram: ${diarization.numSpeakers} speakers, ${diarization.dgWords.length} words`
  );

  // Stage 2: Merge
  console.log("\n=== Stage 2: Merge ===");
  const merged = mergeSpeakers(whisperWords, diarization.dgWords);
  const rawTranscript = formatConversation(merged, speakerNames);
  const rawPath = join(downloadsDir, `${slug}_diarized_raw.md`);
  writeFileSync(rawPath, rawTranscript);
  console.log(`Raw: ${rawTranscript.length} chars → ${rawPath}`);

  // Stage 3: Sonnet cleanup
  console.log("\n=== Stage 3: Cleanup (Sonnet IAST) ===");
  const cleaned = await cleanupConversation(rawTranscript, speakerNames);
  const cleanedPath = join(downloadsDir, `${slug}_diarized_cleaned.md`);
  writeFileSync(cleanedPath, cleaned);
  console.log(`Cleaned: ${cleaned.length} chars → ${cleanedPath}`);

  // Stage 4: Verse-restore
  console.log("\n=== Stage 4: Verse-restore ===");
  const { text: restored, stats } = restoreVerses(cleaned);
  const restoredPath = join(downloadsDir, `${slug}_diarized_restored.md`);
  writeFileSync(restoredPath, restored);
  console.log(
    `Restored: ${restored.length} chars (${stats.substituted} restored, ${stats.already_canonical} canonical)`
  );

  const totalTime = ((Date.now() - t0) / 1000).toFixed(0);
  const iastCount = (restored.match(/[āīūṛḷṅñṭḍṇśṣḥṁ]/g) || []).length;
  console.log(`\n=== Done (${totalTime}s) ===`);
  console.log(`Speakers: ${diarization.numSpeakers}`);
  console.log(`IAST chars: ${iastCount}`);
  console.log(`Files:\n  ${rawPath}\n  ${cleanedPath}\n  ${restoredPath}`);
}

main().catch((err) => {
  console.error(`Pipeline failed: ${err.message}`);
  process.exit(1);
});
