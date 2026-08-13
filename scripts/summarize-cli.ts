#!/usr/bin/env npx tsx
/**
 * Standalone CLI for generating an Evernote-style lecture summary from a
 * cleaned/verse-restored transcript.
 *
 * Usage:
 *   npx tsx scripts/summarize-cli.ts <path-to-transcript.md>
 *
 * Output, all produced automatically (not separate steps to remember):
 *   _summary.md       — English summary
 *   _summary.docx     — via summary-to-docx.js
 *   _summary_ru.md    — Russian translation (structure-preserving)
 *   _summary_ru.docx  — via summary-to-docx.js
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { generateSummary } from "../src/lib/pipeline/summarize";
import { translateStructuredSummary } from "../src/lib/pipeline/translate";

function toDocx(mdPath: string, docxPath: string) {
  try {
    execFileSync("node", [join(__dirname, "summary-to-docx.js"), mdPath, docxPath], {
      stdio: "inherit",
    });
    console.log(`  → ${docxPath}`);
  } catch (err: any) {
    console.error(`  docx conversion failed (${mdPath} is still fine): ${err.message}`);
  }
}

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

  toDocx(outPath, outPath.replace(/\.md$/, ".docx"));

  console.log(`\n=== Translating to Russian ===`);
  try {
    const t1 = Date.now();
    const ru = await translateStructuredSummary(summary, "ru");
    const ruElapsed = ((Date.now() - t1) / 1000).toFixed(1);
    const ruPath = outPath.replace(/\.md$/, "_ru.md");
    writeFileSync(ruPath, ru);
    console.log(`Russian: ${ru.length} chars (${ruElapsed}s)`);
    console.log(`  → ${ruPath}`);
    toDocx(ruPath, ruPath.replace(/\.md$/, ".docx"));
  } catch (err: any) {
    console.error(`  Russian translation failed (English summary is still fine): ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Summary generation failed: ${err.message}`);
  process.exit(1);
});
