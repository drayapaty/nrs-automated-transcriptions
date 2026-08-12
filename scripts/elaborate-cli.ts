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
import { abridge } from "../src/lib/pipeline/abridge";

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
    process.argv[4] || summaryPath.replace(/(_summary|_restored|_cleaned)?\.md$/, "_comparison.md");

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

  // Part 1, Part 2, Part 3 each also get their own standalone file, per
  // Divakar's request (2026-08-07) — same content as inside _elaborate.md,
  // just split out for convenience.
  const part1Match = output.match(/## Part 1[\s\S]*?(?=\n## Part 2|$)/);
  if (part1Match) {
    const part1Path = summaryPath.replace(/\.md$/, "_part-1.md");
    writeFileSync(part1Path, part1Match[0].trim() + "\n");
    console.log(`  → ${part1Path} (Part 1 only, full length)`);
  }

  const part2Match = output.match(/## Part 2[\s\S]*?(?=\n## Part 3|$)/);
  if (part2Match) {
    const part2Path = summaryPath.replace(/\.md$/, "_part-2.md");
    writeFileSync(part2Path, part2Match[0].trim() + "\n");
    console.log(`  → ${part2Path} (Part 2 only)`);
  }

  const part3MatchEarly = output.match(/## Part 3[\s\S]*$/);
  if (part3MatchEarly) {
    const part3Path = summaryPath.replace(/\.md$/, "_part-3.md");
    writeFileSync(part3Path, part3MatchEarly[0].trim() + "\n");
    console.log(`  → ${part3Path} (Part 3 only)`);
  }

  // Abridged Part 1 companion, always generated alongside the full output —
  // standing convention per Divakar, 2026-08-06 (see DECISIONS.md).
  let abridgedPart1 = "";
  if (part1Match) {
    const t1 = Date.now();
    abridgedPart1 = await abridge(part1Match[0].trim());
    const abridgedElapsed = ((Date.now() - t1) / 1000).toFixed(1);
    const abridgedPath = summaryPath.replace(/\.md$/, "_abridged_part1.md");
    writeFileSync(abridgedPath, abridgedPart1);
    console.log(`  → ${abridgedPath} (Part 1, abridged, ${abridgedElapsed}s)`);
  }

  // Two combined files — always generated, standing convention per Divakar,
  // 2026-08-07: one with the full-length Part 1, one with the abridged Part 1.
  const part3Match = part3MatchEarly;
  if (part1Match && part2Match && part3Match) {
    const fullCombined =
      `${part1Match[0].trim()}\n\n---\n\n${part2Match[0].trim()}\n\n---\n\n${part3Match[0].trim()}\n`;
    const fullCombinedPath = summaryPath.replace(/\.md$/, "_elaborate_combined.md");
    writeFileSync(fullCombinedPath, fullCombined);
    console.log(`  → ${fullCombinedPath} (Part 1 full + Part 2 + Part 3, combined)`);
  }
  if (abridgedPart1 && part2Match && part3Match) {
    const abridgeCombined =
      `## Part 1 — Elaboration (abridged)\n\n${abridgedPart1.trim()}\n\n---\n\n` +
      `${part2Match[0].trim()}\n\n---\n\n${part3Match[0].trim()}\n`;
    const abridgeCombinedPath = summaryPath.replace(/\.md$/, "_abridged_combined.md");
    writeFileSync(abridgeCombinedPath, abridgeCombined);
    console.log(`  → ${abridgeCombinedPath} (Part 1 abridged + Part 2 + Part 3, combined)`);
  }
}

main().catch((err) => {
  console.error(`Elaborate step failed: ${err.message}`);
  process.exit(1);
});
