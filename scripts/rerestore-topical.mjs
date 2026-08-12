#!/usr/bin/env node
/**
 * Re-runs the deterministic verse-restore pass (no LLM call) on the
 * existing *_cleaned.md for the 16 topical BB lectures, now that
 * corpus-seeds.json has all 2320 Bṛhad-bhāgavatāmṛta Vol.1 verse anchors
 * (update-corpus-seeds-bb.mjs, 2026-08-12). Cheap and safe — same input
 * text, just a richer corpus to match against. Backs up the existing
 * *_restored.md before overwriting, only writes if the output actually
 * changed.
 *
 * Usage: node scripts/rerestore-topical.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { restoreVerses } from "../src/lib/pipeline/verse-restore.mjs";

const BB_DIR = "/Users/divakar/Downloads/bb-book-chapters-2026-08-05";
const CLEANED_SOURCE_DIR = "/Users/divakar/Downloads/bb-retranscribe";

const TOPICAL_FILES = [
  "2023_03_09_bb_taiwan_p1",
  "2023_03_10_bb_taiwan_p2",
  "2025_07_11_bb_japa_reading",
  "2025_09_14_bb_caitanya",
  "2025_09_21_bb_two_types_dainya",
  "2025_09_28_bb_dainya",
  "2025_10_03_bb_qualifying",
  "2025_10_05_bb_two_useless",
  "2025_10_12_bb_divine_strategy",
  "2025_10_19_bb_human_birth",
  "2025_10_30_bb_is_sb",
  "2025_12_21_bb_book_dist",
  "2026_03_29_bb_budapest",
  "2026_04_01_radha_kunda_prakat_en_hu",
  "2026_04_05_bb_budapest",
  "2026_05_02_nrsimha_caturdasi_en_hu",
];

function main() {
  for (const slug of TOPICAL_FILES) {
    const dir = join(BB_DIR, slug);
    const cleanedPath = join(CLEANED_SOURCE_DIR, `${slug}_cleaned.md`);
    const restoredPath = join(dir, `${slug}_restored.md`);

    if (!existsSync(cleanedPath)) {
      console.log(`${slug.padEnd(45)} -> SKIP (no _cleaned.md)`);
      continue;
    }

    const cleaned = readFileSync(cleanedPath, "utf-8");
    const oldRestored = existsSync(restoredPath) ? readFileSync(restoredPath, "utf-8") : "";

    const { text: newRestored, stats } = restoreVerses(cleaned);

    if (newRestored === oldRestored) {
      console.log(`${slug.padEnd(45)} -> unchanged (${stats.substituted} restored, ${stats.already_canonical} canonical)`);
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
  }
}

main();
