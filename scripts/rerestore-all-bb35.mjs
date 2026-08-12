#!/usr/bin/env node
/**
 * Re-runs the deterministic verse-restore pass (no LLM call) on the
 * existing *_cleaned.md for all 35 signed-off BB lectures, now that
 * corpus-seeds.json has all 2320 Bṛhad-bhāgavatāmṛta Vol.1 verse anchors
 * (update-corpus-seeds-bb.mjs, 2026-08-12). Supersedes
 * rerestore-topical.mjs (which only covered the 16 topical ones) — per
 * Divakar's explicit instruction, ALL 35 get the corpus update, not just
 * the ones that previously had no verse tag at all, since the expanded
 * corpus can also add/correct tags for the 19 that already had a
 * filename-derived verse range.
 *
 * Cheap and safe — same cleaned input text, just a richer corpus to match
 * against. Backs up the existing *_restored.md before overwriting, only
 * writes if the output actually changed.
 *
 * Usage: node scripts/rerestore-all-bb35.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { restoreVerses } from "../src/lib/pipeline/verse-restore.mjs";

const BB_DIR = "/Users/divakar/Downloads/bb-book-chapters-2026-08-05";
const CLEANED_SOURCE_DIR = "/Users/divakar/Downloads/bb-retranscribe";

function discoverSlugs() {
  return readdirSync(BB_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "2026_08_02_hungary_bb_1_3_1_10") // not part of the signed-off 35
    .map((d) => d.name)
    .sort();
}

function main() {
  const slugs = discoverSlugs();
  console.log(`${slugs.length} lecture folders found\n`);

  let changed = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const slug of slugs) {
    const dir = join(BB_DIR, slug);
    const cleanedPath = join(CLEANED_SOURCE_DIR, `${slug}_cleaned.md`);
    const restoredPath = join(dir, `${slug}_restored.md`);

    if (!existsSync(cleanedPath)) {
      console.log(`${slug.padEnd(45)} -> SKIP (no _cleaned.md at ${cleanedPath})`);
      skipped++;
      continue;
    }

    const cleaned = readFileSync(cleanedPath, "utf-8");
    const oldRestored = existsSync(restoredPath) ? readFileSync(restoredPath, "utf-8") : "";

    const { text: newRestored, stats } = restoreVerses(cleaned);

    if (newRestored === oldRestored) {
      console.log(`${slug.padEnd(45)} -> unchanged (${stats.substituted} restored, ${stats.already_canonical} canonical)`);
      unchanged++;
      continue;
    }

    const backupPath = `${restoredPath}.pre-bb-corpus-update.bak`;
    if (existsSync(restoredPath) && !existsSync(backupPath)) {
      copyFileSync(restoredPath, backupPath);
    }
    writeFileSync(restoredPath, newRestored);
    console.log(
      `${slug.padEnd(45)} -> CHANGED (${stats.substituted} restored, ${stats.already_canonical} canonical) — backed up old version`
    );
    changed++;
  }

  console.log(`\n${changed} changed, ${unchanged} unchanged, ${skipped} skipped (of ${slugs.length})`);
}

main();
