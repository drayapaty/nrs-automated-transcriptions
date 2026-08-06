#!/usr/bin/env npx tsx
/**
 * Standalone CLI for the "Elaborate" step — Mahārāja's 4-point write spec.
 * See src/lib/pipeline/elaborate.ts and scripts/ELABORATE_REQUIREMENTS.md.
 *
 * Usage:
 *   npx tsx scripts/elaborate-cli.ts <restored.md> <evernote-summary.md> [comparison.md]
 *
 * If comparison.md is omitted, it's derived from the summary path the same
 * way compare-cli.ts names its own output (strip .md, append _comparison.md).
 * Run /compare on the summary first if that file doesn't exist yet.
 *
 * Output: <evernote-summary.md path>, with .md replaced by _elaborate.md
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { elaborate } from "../src/lib/pipeline/elaborate";

async function main() {
  const restoredPath = process.argv[2];
  const summaryPath = process.argv[3];

  if (!restoredPath || !summaryPath) {
    console.error(
      "Usage: npx tsx scripts/elaborate-cli.ts <restored.md> <evernote-summary.md> [comparison.md]"
    );
    process.exit(1);
  }

  const comparisonPath =
    process.argv[4] || summaryPath.replace(/(_restored|_cleaned)?\.md$/, "_comparison.md");

  if (!existsSync(comparisonPath)) {
    console.error(
      `Comparison file not found: ${comparisonPath}\nRun /compare on the summary first, or pass the comparison path explicitly.`
    );
    process.exit(1);
  }

  const transcript = readFileSync(restoredPath, "utf-8");
  const summary = readFileSync(summaryPath, "utf-8");
  const comparison = readFileSync(comparisonPath, "utf-8");

  if (!transcript.trim() || !summary.trim()) {
    console.error("Transcript or summary file is empty");
    process.exit(1);
  }

  console.log(`\n=== Elaborate step ===`);
  console.log(`Transcript: ${restoredPath} (${transcript.length} chars)`);
  console.log(`Summary: ${summaryPath} (${summary.length} chars)`);
  console.log(`Comparison: ${comparisonPath} (${comparison.length} chars)`);

  const t0 = Date.now();
  const { output, topics } = await elaborate(transcript, summary, comparison);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`Book search topics used: ${topics.join(", ") || "(none generated)"}`);

  const outPath = summaryPath.replace(/\.md$/, "_elaborate.md");
  writeFileSync(outPath, output);

  console.log(`Output: ${output.length} chars (${elapsed}s)`);
  console.log(`  → ${outPath}`);

  // Part 2 (book/lecture parallels) also gets its own file, per Mahārāja's request.
  const part2Match = output.match(/## Part 2[\s\S]*?(?=\n## Part 3|$)/);
  if (part2Match) {
    const part2Path = summaryPath.replace(/\.md$/, "_elaborate_part2.md");
    writeFileSync(part2Path, part2Match[0].trim() + "\n");
    console.log(`  → ${part2Path} (Part 2 only)`);
  }
}

main().catch((err) => {
  console.error(`Elaborate step failed: ${err.message}`);
  process.exit(1);
});
