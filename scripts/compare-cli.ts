#!/usr/bin/env npx tsx
/**
 * Standalone CLI for step 3 of the BB lecture workflow: comparative analysis
 * against Gopīparāṇadhana Dāsa's published Bṛhad-bhāgavatāmṛta Vol.1
 * commentary. See src/lib/pipeline/compare.ts.
 *
 * Usage:
 *   npx tsx scripts/compare-cli.ts <path-to-summary.md> [part] [chapter] [verseStart] [verseEnd]
 *
 * If part/chapter/verseStart/verseEnd are omitted, three fallbacks are tried
 * in order: (1) parse from the input filename (expects a
 * "..._bb_<part>_<chapter>_<start>[_<end>]..." pattern, e.g.
 * "2025_11_02_bb_1_2_14_18_restored.md"); (2) read the "(BB part.chapter.verse)"
 * tags verse-restore already inserted into the sibling _restored.md file, if
 * one exists next to the summary; (3) match the summary/transcript text
 * against Vol.1's own Translation/Commentary prose (catches lectures that
 * read the English translation aloud without re-quoting the Sanskrit). If
 * none of the three finds a range, this exits — a genuinely topical talk has
 * no verse range and this step should be skipped for it, not guessed.
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
  findVerseRangeFromInlineTags,
  findVerseRangeFromContent,
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

  const restoredPath = inputPath.replace(/_summary\.md$/, "_restored.md");
  const restoredText = existsSync(restoredPath) ? readFileSync(restoredPath, "utf-8") : null;

  let part: number, chapter: number, verseStart: number, verseEnd: number;

  if (process.argv[3]) {
    part = Number(process.argv[3]);
    chapter = Number(process.argv[4]);
    verseStart = Number(process.argv[5]);
    verseEnd = Number(process.argv[6] || process.argv[5]);
    console.log(`Verse range: given explicitly.`);
  } else {
    const byFilename = parseVerseRangeFromFilename(basename(inputPath));
    const byTags = !byFilename && restoredText ? findVerseRangeFromInlineTags(restoredText) : null;
    const byContent =
      !byFilename && !byTags ? findVerseRangeFromContent(restoredText || readFileSync(inputPath, "utf-8")) : null;

    const found = byFilename ?? byTags ?? byContent;
    if (!found) {
      console.error(
        "Could not find a BB verse range — not in the filename, not in inline verse-restore tags" +
          (restoredText ? "," : " (no sibling _restored.md found),") +
          " and no content match cleared the confidence floor. Pass it explicitly:\n" +
          "  npx tsx scripts/compare-cli.ts <summary.md> <part> <chapter> <verseStart> [verseEnd]\n" +
          "This is expected for a genuinely topical talk — skip this step for it."
      );
      process.exit(1);
    }
    ({ part, chapter, verseStart, verseEnd } = found);

    if (byFilename) console.log(`Verse range: parsed from filename.`);
    else if (byTags) console.log(`Verse range: inferred from ${(byTags as any).tagCount} inline verse-restore tag(s) — verify this looks right.`);
    else console.log(`Verse range: inferred from content match (score ${(byContent as any).score.toFixed(2)} via ${(byContent as any).via}) — verify this looks right.`);
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
