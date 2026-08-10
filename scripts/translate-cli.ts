#!/usr/bin/env npx tsx
/**
 * Standalone CLI for translating a transcript or summary file to Russian
 * (or Ukrainian).
 *
 * Usage:
 *   npx tsx scripts/translate-cli.ts <path-to-file.md|.docx> [lang]
 *
 * lang defaults to "ru". Output: same path with _ru.md suffix, plus a
 * matching _ru.docx if the input was itself a .docx (round-tripped through
 * docx-to-summary-md.js / summary-to-docx.js so headings, indentation, and
 * bullet structure survive the translation).
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { translate, translateStructuredSummary } from "../src/lib/pipeline/translate";
import type { Language } from "../src/lib/types";

async function main() {
  const inputPath = process.argv[2];
  const lang = (process.argv[3] || "ru") as Language;

  if (!inputPath) {
    console.error("Usage: npx tsx scripts/translate-cli.ts <file.md|.docx> [ru|uk]");
    process.exit(1);
  }

  const isDocx = extname(inputPath).toLowerCase() === ".docx";
  let text: string;
  let tmpDir: string | undefined;

  if (isDocx) {
    tmpDir = mkdtempSync(join(tmpdir(), "translate-docx-"));
    const extractedMd = join(tmpDir, "extracted.md");
    execFileSync("node", [join(__dirname, "docx-to-summary-md.js"), inputPath, extractedMd]);
    text = readFileSync(extractedMd, "utf-8");
  } else {
    text = readFileSync(inputPath, "utf-8");
  }

  if (!text.trim()) {
    console.error("Input file is empty");
    process.exit(1);
  }

  console.log(`\n=== Translating to ${lang} ===`);
  console.log(`Input: ${inputPath} (${text.length} chars)`);

  const t0 = Date.now();
  // .docx input is always our own V3 summary structure (headings/bullets) —
  // use the structure-preserving translator, not the prose one, so the
  // heading markers survive into the reassembled .docx.
  const translated = isDocx
    ? await translateStructuredSummary(text, lang)
    : await translate(text, lang);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const base = inputPath.replace(/(_restored|_cleaned)?\.(md|docx)$/i, "");
  const outMdPath = `${base}_${lang}.md`;
  writeFileSync(outMdPath, translated);

  console.log(`Translated: ${translated.length} chars (${elapsed}s)`);
  console.log(`  → ${outMdPath}`);

  if (isDocx) {
    const outDocxPath = `${base}_${lang}.docx`;
    execFileSync("node", [join(__dirname, "summary-to-docx.js"), outMdPath, outDocxPath]);
    console.log(`  → ${outDocxPath}`);
  }

  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(`Translation failed: ${err.message}`);
  process.exit(1);
});
