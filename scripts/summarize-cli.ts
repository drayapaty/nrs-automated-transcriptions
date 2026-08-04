#!/usr/bin/env npx tsx
/**
 * Standalone CLI for generating an Evernote-style lecture summary from a
 * cleaned/verse-restored transcript.
 *
 * Usage:
 *   npx tsx scripts/summarize-cli.ts <path-to-transcript.md>
 *
 * Output: same path with _summary.md suffix.
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { generateSummary } from "../src/lib/pipeline/summarize";

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error("Usage: npx tsx scripts/summarize-cli.ts <transcript.md>");
    process.exit(1);
  }

  const text = readFileSync(inputPath, "utf-8");
  if (!text.trim()) {
    console.error("Input file is empty");
    process.exit(1);
  }

  console.log(`\n=== Generating summary ===`);
  console.log(`Input: ${inputPath} (${text.length} chars)`);

  const t0 = Date.now();
  const summary = await generateSummary(text);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const outPath = inputPath.replace(/(_restored|_cleaned)?\.md$/, `_summary.md`);
  writeFileSync(outPath, summary);

  console.log(`Summary: ${summary.length} chars (${elapsed}s)`);
  console.log(`  → ${outPath}`);
}

main().catch((err) => {
  console.error(`Summary generation failed: ${err.message}`);
  process.exit(1);
});
