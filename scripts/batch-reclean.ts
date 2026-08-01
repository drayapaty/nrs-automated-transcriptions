#!/usr/bin/env npx tsx
/**
 * Re-run cleanup + verse-restore on all *_raw.md files in a directory.
 * Backs up existing _cleaned.md and _restored.md before overwriting.
 *
 * Usage:
 *   npx tsx scripts/batch-reclean.ts <directory>
 *   npx tsx scripts/batch-reclean.ts ~/Downloads/bb-retranscribe
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { cleanupTranscript } from "../src/lib/pipeline/cleanup";
import { restoreVerses } from "../src/lib/pipeline/verse-restore.mjs";

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npx tsx scripts/batch-reclean.ts <directory>");
    process.exit(1);
  }

  const rawFiles = readdirSync(dir)
    .filter((f: string) => f.endsWith("_raw.md"))
    .sort();

  console.log(`Found ${rawFiles.length} raw files in ${dir}\n`);

  // Backup existing cleaned + restored files
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = join(homedir(), "backups", "bb-retranscribe", ts);
  mkdirSync(backupDir, { recursive: true });

  let backedUp = 0;
  for (const raw of rawFiles) {
    const base = raw.replace("_raw.md", "");
    for (const suffix of ["_cleaned.md", "_restored.md"]) {
      const src = join(dir, base + suffix);
      if (existsSync(src)) {
        copyFileSync(src, join(backupDir, base + suffix));
        backedUp++;
      }
    }
  }
  console.log(`Backed up ${backedUp} files to ${backupDir}\n`);

  // Process each raw file
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < rawFiles.length; i++) {
    const raw = rawFiles[i];
    const base = raw.replace("_raw.md", "");
    const rawPath = join(dir, raw);
    const cleanedPath = join(dir, base + "_cleaned.md");
    const restoredPath = join(dir, base + "_restored.md");

    const rawText = readFileSync(rawPath, "utf-8");
    const chunks = Math.ceil(rawText.length / 12000);
    console.log(`[${i + 1}/${rawFiles.length}] ${base} (${rawText.length} chars, ~${chunks} chunks)`);

    try {
      // Step 1: cleanup
      const cleaned = await cleanupTranscript(rawText);
      writeFileSync(cleanedPath, cleaned);

      // Step 2: verse-restore
      const { text: restored } = restoreVerses(cleaned);
      writeFileSync(restoredPath, restored);

      // Verify: count praṇāma occurrences after first 500 chars
      const afterOpening = cleaned.slice(500);
      const midLecturePranama = (afterOpening.match(/oṁ ajñāna-timirāndhasya|nama oṁ viṣṇu-pādāya/g) || []).length;

      if (midLecturePranama > 0) {
        console.log(`  ⚠ ${midLecturePranama} mid-lecture praṇāma(s) still present`);
        failed++;
      } else {
        console.log(`  ✓ clean`);
        passed++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR: ${msg}`);
      failed++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${rawFiles.length}`);
  console.log(`Backup: ${backupDir}`);
}

main().catch(console.error);
