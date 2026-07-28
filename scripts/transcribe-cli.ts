#!/usr/bin/env npx tsx
/**
 * Standalone CLI pipeline runner for local use (Mac Mini / Claude Desktop).
 * No DynamoDB, S3, or Vercel dependencies.
 *
 * Usage:
 *   npx tsx scripts/transcribe-cli.ts <youtube-url>
 *   npx tsx scripts/transcribe-cli.ts <local-mp3-path>
 *
 * Output: ~/Downloads/<slug>_{raw,cleaned,restored}.md
 *
 * Requires: node ≥18, ffmpeg, yt-dlp (for YouTube URLs)
 * Env: GROQ_API_KEY, ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { transcribeWithGroqChunked } from "../src/lib/pipeline/transcribe";
import { cleanupTranscript } from "../src/lib/pipeline/cleanup";
import { restoreVerses } from "../src/lib/pipeline/verse-restore.mjs";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npx tsx scripts/transcribe-cli.ts <youtube-url | mp3-path>");
    process.exit(1);
  }

  const isYoutube = /youtu\.?be/.test(input);
  const downloadsDir = join(homedir(), "Downloads");

  let audioBuf: Buffer;
  let slug: string;

  if (isYoutube) {
    console.log(`\n=== Downloading from YouTube ===`);
    const title = execSync(`yt-dlp --print title "${input}"`, { encoding: "utf-8" }).trim();
    slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
    console.log(`Title: ${title}`);
    console.log(`Slug: ${slug}`);

    const tmpMp3 = `/tmp/nrs_cli_${slug}.mp3`;
    execSync(`yt-dlp -x --audio-format mp3 --audio-quality 128K -o "${tmpMp3}" "${input}"`, {
      stdio: "inherit",
    });
    audioBuf = readFileSync(tmpMp3);
  } else {
    audioBuf = readFileSync(input);
    slug = input.replace(/.*\//, "").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  }

  console.log(`Audio: ${(audioBuf.length / 1024 / 1024).toFixed(1)} MB`);

  // Stage 1: Transcribe
  console.log(`\n=== Stage 1: Transcribe (Groq Whisper) ===`);
  const t1 = Date.now();
  const tr = await transcribeWithGroqChunked(audioBuf);
  const rawText = tr.text;
  console.log(`Raw: ${rawText.length} chars (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  const rawPath = join(downloadsDir, `${slug}_raw.md`);
  writeFileSync(rawPath, rawText);
  console.log(`  → ${rawPath}`);

  // Stage 2: Cleanup
  console.log(`\n=== Stage 2: Cleanup (Sonnet IAST) ===`);
  const t2 = Date.now();
  const cleaned = await cleanupTranscript(rawText);
  console.log(`Cleaned: ${cleaned.length} chars (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
  const cleanedPath = join(downloadsDir, `${slug}_cleaned.md`);
  writeFileSync(cleanedPath, cleaned);
  console.log(`  → ${cleanedPath}`);

  // Stage 3: Verse-restore
  console.log(`\n=== Stage 3: Verse-restore ===`);
  const t3 = Date.now();
  const { text: restored, stats } = restoreVerses(cleaned);
  console.log(`Restored: ${restored.length} chars (${((Date.now() - t3) / 1000).toFixed(1)}s)`);
  console.log(`Stats: ${stats.substituted} restored, ${stats.already_canonical} canonical, ${stats.common_subs} common subs`);
  const restoredPath = join(downloadsDir, `${slug}_restored.md`);
  writeFileSync(restoredPath, restored);
  console.log(`  → ${restoredPath}`);

  // Summary
  const iastCount = (restored.match(/[āīūṛḷṅñṭḍṇśṣḥṁ]/g) || []).length;
  const totalTime = ((Date.now() - t1) / 1000).toFixed(0);
  console.log(`\n=== Done (${totalTime}s total) ===`);
  console.log(`IAST chars: ${iastCount}`);
  console.log(`Files: ${rawPath}`);
  console.log(`       ${cleanedPath}`);
  console.log(`       ${restoredPath}`);
}

main().catch((err) => {
  console.error(`Pipeline failed: ${err.message}`);
  process.exit(1);
});
