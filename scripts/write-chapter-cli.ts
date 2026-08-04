#!/usr/bin/env npx tsx
/**
 * Standalone CLI for step 4 of the BB lecture workflow: write book chapter
 * material from a lecture summary + comparative-analysis unique points.
 * See src/lib/pipeline/write-chapter.ts.
 *
 * Usage:
 *   npx tsx scripts/write-chapter-cli.ts <path-to-summary.md> [path-to-comparison.md]
 *
 * If comparison.md path is omitted, it's derived by swapping the summary
 * file's "_summary.md" suffix for "_comparison.md" in the same directory.
 *
 * Output: same path with _chapter.md suffix.
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { writeChapter } from "../src/lib/pipeline/write-chapter";

async function main() {
  const summaryPath = process.argv[2];

  if (!summaryPath) {
    console.error(
      "Usage: npx tsx scripts/write-chapter-cli.ts <summary.md> [comparison.md]"
    );
    process.exit(1);
  }

  const comparisonPath =
    process.argv[3] || summaryPath.replace(/_summary\.md$/, "_comparison.md");

  if (!existsSync(comparisonPath)) {
    console.error(
      `Comparison file not found: ${comparisonPath}\nRun /compare first, or pass the path explicitly.`
    );
    process.exit(1);
  }

  const summaryText = readFileSync(summaryPath, "utf-8");
  const comparisonText = readFileSync(comparisonPath, "utf-8");

  if (!summaryText.trim()) {
    console.error("Summary file is empty");
    process.exit(1);
  }

  console.log(`\n=== Writing chapter material ===`);
  console.log(`Summary: ${summaryPath} (${summaryText.length} chars)`);
  console.log(`Comparison: ${comparisonPath} (${comparisonText.length} chars)`);

  const t0 = Date.now();
  const chapter = await writeChapter(summaryText, comparisonText);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const outPath = summaryPath.replace(/(_summary)?\.md$/, `_chapter.md`);
  writeFileSync(outPath, chapter);

  console.log(`Chapter: ${chapter.length} chars (${elapsed}s)`);
  console.log(`  → ${outPath}`);
}

main().catch((err) => {
  console.error(`Chapter writing failed: ${err.message}`);
  process.exit(1);
});
