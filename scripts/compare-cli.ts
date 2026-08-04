#!/usr/bin/env npx tsx
/**
 * Standalone CLI for step 3 of the BB lecture workflow: comparative analysis
 * against Gopīparāṇadhana Dāsa's published Bṛhad-bhāgavatāmṛta Vol.1
 * commentary. See src/lib/pipeline/compare.ts.
 *
 * Usage:
 *   npx tsx scripts/compare-cli.ts <path-to-summary.md> [part] [chapter] [verseStart] [verseEnd]
 *
 * If part/chapter/verseStart/verseEnd are omitted, they're parsed from the
 * input filename (expects a "..._bb_<part>_<chapter>_<start>[_<end>]..." pattern,
 * e.g. "2025_11_02_bb_1_2_14_18_restored.md"). Lectures that don't follow a
 * sequential BB verse range (topical talks) aren't supported — pass the range
 * explicitly, or skip this step for that file.
 *
 * Output: same path with _comparison.md suffix.
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import {
  extractCommentarySection,
  generateComparativeAnalysis,
  parseVerseRangeFromFilename,
  GOPIPARANADHANA_VOL1_PATH,
} from "../src/lib/pipeline/compare";

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error(
      "Usage: npx tsx scripts/compare-cli.ts <summary.md> [part] [chapter] [verseStart] [verseEnd]"
    );
    process.exit(1);
  }

  if (!existsSync(GOPIPARANADHANA_VOL1_PATH)) {
    console.error(`Gopīparāṇadhana Vol.1 source not found at:\n  ${GOPIPARANADHANA_VOL1_PATH}`);
    process.exit(1);
  }

  let part: number, chapter: number, verseStart: number, verseEnd: number;

  if (process.argv[3]) {
    part = Number(process.argv[3]);
    chapter = Number(process.argv[4]);
    verseStart = Number(process.argv[5]);
    verseEnd = Number(process.argv[6] || process.argv[5]);
  } else {
    const parsed = parseVerseRangeFromFilename(basename(inputPath));
    if (!parsed) {
      console.error(
        "Could not parse a BB verse range from the filename. Pass it explicitly:\n" +
          "  npx tsx scripts/compare-cli.ts <summary.md> <part> <chapter> <verseStart> [verseEnd]"
      );
      process.exit(1);
    }
    ({ part, chapter, verseStart, verseEnd } = parsed);
  }

  console.log(`\n=== Comparative analysis: BB ${part}.${chapter}.${verseStart}-${verseEnd} ===`);

  const commentaryExcerpt = extractCommentarySection(part, chapter, verseStart, verseEnd);
  if (!commentaryExcerpt) {
    console.error(
      `No matching section found in Gopīparāṇadhana's commentary for BB ${part}.${chapter}.${verseStart}-${verseEnd}.`
    );
    process.exit(1);
  }
  console.log(`Commentary excerpt: ${commentaryExcerpt.length} chars`);

  const summaryText = readFileSync(inputPath, "utf-8");
  if (!summaryText.trim()) {
    console.error("Input file is empty");
    process.exit(1);
  }
  console.log(`Lecture summary: ${summaryText.length} chars`);

  const t0 = Date.now();
  const analysis = await generateComparativeAnalysis(summaryText, commentaryExcerpt);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const outPath = inputPath.replace(/(_summary|_restored|_cleaned)?\.md$/, `_comparison.md`);
  writeFileSync(outPath, analysis);

  console.log(`Analysis: ${analysis.length} chars (${elapsed}s)`);
  console.log(`  → ${outPath}`);
}

main().catch((err) => {
  console.error(`Comparative analysis failed: ${err.message}`);
  process.exit(1);
});
