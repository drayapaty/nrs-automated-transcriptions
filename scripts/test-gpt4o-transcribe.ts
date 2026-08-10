#!/usr/bin/env npx tsx
/**
 * Side-by-side test: OpenAI gpt-4o-transcribe vs current Groq Whisper-large-v3.
 * Standalone — does not touch the production pipeline.
 *
 * Usage:
 *   npx tsx scripts/test-gpt4o-transcribe.ts <youtube-url>
 *   npx tsx scripts/test-gpt4o-transcribe.ts <local-mp3-path>
 *
 * Output: ~/Downloads/<slug>_groq.md, ~/Downloads/<slug>_gpt4o.md
 *
 * Requires: node ≥18, ffmpeg, yt-dlp (for YouTube URLs)
 * Env: GROQ_API_KEY, OPENAI_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { transcribeWithGroqChunked, SANSKRIT_PROMPT } from "../src/lib/pipeline/transcribe";
import { openai } from "../src/lib/clients";

const CHUNK_SECS = 600; // 10 min — well under 25 MB at 128 kbps for both APIs

async function transcribeWithGpt4oChunked(mp3Path: string, workDir: string): Promise<string> {
  const pattern = join(workDir, "gpt4o_chunk_%03d.mp3");
  execSync(
    `ffmpeg -y -i "${mp3Path}" -f segment -segment_time ${CHUNK_SECS} -c copy "${pattern}"`,
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  const files = execSync(`ls "${workDir}"/gpt4o_chunk_*.mp3 | sort`, { encoding: "utf-8" })
    .trim()
    .split("\n")
    .filter(Boolean);

  console.log(`[gpt-4o-transcribe] ${files.length} chunk(s) of ~${CHUNK_SECS}s`);

  const texts: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const buf = readFileSync(files[i]);
    const file = new File([new Uint8Array(buf)], `chunk_${i}.mp3`, { type: "audio/mpeg" });
    const response = await openai().audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file,
      response_format: "json",
      prompt: SANSKRIT_PROMPT,
    });
    const text = typeof response === "string" ? response : (response as { text?: string }).text || "";
    texts.push(text);
    console.log(`  chunk ${i + 1}/${files.length}: ${text.length} chars`);
  }
  return texts.join(" ");
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npx tsx scripts/test-gpt4o-transcribe.ts <youtube-url | mp3-path>");
    process.exit(1);
  }

  const isYoutube = /youtu\.?be/.test(input);
  const downloadsDir = join(homedir(), "Downloads");

  let audioBuf: Buffer;
  let mp3Path: string;
  let slug: string;
  const workDir = mkdtempSync(join(tmpdir(), "nrs_gpt4o_test_"));

  if (isYoutube) {
    console.log(`=== Downloading from YouTube ===`);
    const title = execSync(`yt-dlp --print title "${input}"`, { encoding: "utf-8" }).trim();
    slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
    console.log(`Title: ${title}`);
    mp3Path = join(workDir, `${slug}.mp3`);
    execSync(`yt-dlp -x --audio-format mp3 --audio-quality 128K -o "${mp3Path}" "${input}"`, {
      stdio: "inherit",
    });
    audioBuf = readFileSync(mp3Path);
  } else {
    audioBuf = readFileSync(input);
    slug = input.replace(/.*\//, "").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    mp3Path = input;
  }

  console.log(`Audio: ${(audioBuf.length / 1024 / 1024).toFixed(1)} MB\n`);

  console.log(`=== Groq Whisper-large-v3 (current primary) ===`);
  const tGroq = Date.now();
  const groqResult = await transcribeWithGroqChunked(audioBuf);
  const groqSecs = ((Date.now() - tGroq) / 1000).toFixed(1);
  console.log(`Groq: ${groqResult.text.length} chars (${groqSecs}s)`);
  const groqPath = join(downloadsDir, `${slug}_groq.md`);
  writeFileSync(groqPath, groqResult.text);
  console.log(`  → ${groqPath}\n`);

  console.log(`=== OpenAI gpt-4o-transcribe ===`);
  const tGpt4o = Date.now();
  const gpt4oText = await transcribeWithGpt4oChunked(mp3Path, workDir);
  const gpt4oSecs = ((Date.now() - tGpt4o) / 1000).toFixed(1);
  console.log(`gpt-4o-transcribe: ${gpt4oText.length} chars (${gpt4oSecs}s)`);
  const gpt4oPath = join(downloadsDir, `${slug}_gpt4o.md`);
  writeFileSync(gpt4oPath, gpt4oText);
  console.log(`  → ${gpt4oPath}\n`);

  rmSync(workDir, { recursive: true, force: true });

  console.log(`=== Summary ===`);
  console.log(`Groq:              ${groqResult.text.length} chars, ${groqSecs}s`);
  console.log(`gpt-4o-transcribe: ${gpt4oText.length} chars, ${gpt4oSecs}s`);
  console.log(`Diff files:`);
  console.log(`  ${groqPath}`);
  console.log(`  ${gpt4oPath}`);
}

main().catch((err) => {
  console.error(`Test failed: ${err.message}`);
  process.exit(1);
});
