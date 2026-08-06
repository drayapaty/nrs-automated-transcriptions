#!/usr/bin/env npx tsx
/**
 * Standalone CLI to fetch H.H. Niranjana Swami's latest Zoom class
 * recording (audio only). Defaults to the most recent recording
 * automatically — see DECISIONS.md 2026-08-06.
 *
 * Usage:
 *   npx tsx scripts/fetch-zoom-cli.ts
 *
 * Requires: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (reads .env.local)
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { fetchLatestZoomRecording } from "../src/lib/pipeline/fetch-zoom";

async function main() {
  console.log(`\n=== Fetching latest Zoom recording ===`);

  const t0 = Date.now();
  const result = await fetchLatestZoomRecording();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`Topic: ${result.topic}`);
  console.log(`Recorded: ${result.startTime}`);
  console.log(`Size: ${(result.fileSizeBytes / 1024 / 1024).toFixed(1)} MB (${elapsed}s)`);
  if (result.ambiguous) {
    console.log(
      `\n⚠ WARNING: ${result.candidateCount} recordings found on the same day — picked the most recent by start_time, verify this is the right one.`
    );
  }
  console.log(`  → ${result.outPath}`);
}

main().catch((err) => {
  console.error(`Zoom fetch failed: ${err.message}`);
  process.exit(1);
});
