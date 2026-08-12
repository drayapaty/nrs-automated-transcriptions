#!/usr/bin/env npx tsx
/**
 * Retroactive fix for all 35 signed-off BB lectures, replacing
 * rerestore-all-bb35.mjs (which reused the un-stripped cleaned.md and so
 * baked fabricated guru-praṇāma content into 22/35 restored.md files
 * without catching it):
 *
 *   1. stripFabricatedPranama(raw, cleaned) on each *_cleaned.md, using
 *      the matching *_raw.md as ground truth for whether the praṇāma was
 *      actually said.
 *   2. restoreVerses() on the STRIPPED cleaned text (updated
 *      corpus-seeds.json, 2320 BB verse anchors).
 *
 * Writes corrected _cleaned.md and _restored.md into the bb-book-chapters
 * folders (source _cleaned.md was only ever in bb-retranscribe/, not
 * copied into the per-lecture folders before now). Backs up whatever's
 * currently in the bb-book-chapters folder first.
 *
 * Usage: npx tsx scripts/strip-and-rerestore-bb35.ts
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { restoreVerses } from "../src/lib/pipeline/verse-restore.mjs";
import { stripFabricatedPranama } from "../src/lib/pipeline/strip-fabricated-pranama";

const BB_DIR = "/Users/divakar/Downloads/bb-book-chapters-2026-08-05";
const SRC_DIR = "/Users/divakar/Downloads/bb-retranscribe";

function discoverSlugs(): string[] {
  return readdirSync(BB_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "2026_08_02_hungary_bb_1_3_1_10")
    .map((d) => d.name)
    .sort();
}

function backupIfNeeded(path: string, suffix: string) {
  const backupPath = `${path}.${suffix}`;
  if (existsSync(path) && !existsSync(backupPath)) {
    copyFileSync(path, backupPath);
  }
}

function main() {
  const slugs = discoverSlugs();
  console.log(`${slugs.length} lecture folders\n`);

  let strippedCount = 0;
  let unaffected = 0;

  for (const slug of slugs) {
    const dir = join(BB_DIR, slug);
    const rawPath = join(SRC_DIR, `${slug}_raw.md`);
    const cleanedSrcPath = join(SRC_DIR, `${slug}_cleaned.md`);
    const cleanedOutPath = join(dir, `${slug}_cleaned.md`);
    const restoredPath = join(dir, `${slug}_restored.md`);

    if (!existsSync(rawPath) || !existsSync(cleanedSrcPath)) {
      console.log(`${slug.padEnd(45)} -> SKIP (missing raw/cleaned source)`);
      continue;
    }

    const raw = readFileSync(rawPath, "utf-8");
    const cleanedRaw = readFileSync(cleanedSrcPath, "utf-8");

    const { text: cleaned, stripped } = stripFabricatedPranama(raw, cleanedRaw);
    if (stripped > 0) strippedCount++;
    else unaffected++;

    backupIfNeeded(cleanedOutPath, "pre-pranama-strip.bak");
    writeFileSync(cleanedOutPath, cleaned);

    const { text: restored, stats } = restoreVerses(cleaned);
    backupIfNeeded(restoredPath, "pre-pranama-strip.bak");
    writeFileSync(restoredPath, restored);

    console.log(
      `${slug.padEnd(45)} -> stripped=${stripped}  restored(verse)=${stats.substituted}  canonical=${stats.already_canonical}`
    );
  }

  console.log(`\n${strippedCount} had fabricated praṇāma stripped, ${unaffected} were already clean.`);
}

main();
