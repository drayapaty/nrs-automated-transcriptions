#!/usr/bin/env npx tsx
/**
 * Standalone CLI for the abridge step. See src/lib/pipeline/abridge.ts —
 * always regenerate through the model, never hand-edit book-voice text.
 *
 * Usage:
 *   npx tsx scripts/abridge-cli.ts <part1-or-other-source.md>
 *
 * Output: <input path>, with .md replaced by _abridged.md
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { abridge } from "../src/lib/pipeline/abridge";

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error("Usage: npx tsx scripts/abridge-cli.ts <source.md>");
    process.exit(1);
  }

  const source = readFileSync(inputPath, "utf-8");
  if (!source.trim()) {
    console.error("Source file is empty");
    process.exit(1);
  }

  console.log(`\n=== Abridge step ===`);
  console.log(`Source: ${inputPath} (${source.length} chars)`);

  const t0 = Date.now();
  const output = await abridge(source);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const outPath = inputPath.replace(/\.md$/, "_abridged.md");
  writeFileSync(outPath, output);

  console.log(`Output: ${output.length} chars (${elapsed}s, ${((output.length / source.length) * 100).toFixed(0)}% of source)`);
  console.log(`  → ${outPath}`);
}

main().catch((err) => {
  console.error(`Abridge step failed: ${err.message}`);
  process.exit(1);
});
