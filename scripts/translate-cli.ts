#!/usr/bin/env npx tsx
/**
 * Standalone CLI for translating a transcript file to Russian (or Ukrainian).
 *
 * Usage:
 *   npx tsx scripts/translate-cli.ts <path-to-transcript.md> [lang]
 *
 * lang defaults to "ru". Output: same path with _ru.md suffix.
 *
 * Requires: ANTHROPIC_API_KEY (reads .env.local)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { translate } from "../src/lib/pipeline/translate";
import type { Language } from "../src/lib/types";

async function main() {
  const inputPath = process.argv[2];
  const lang = (process.argv[3] || "ru") as Language;

  if (!inputPath) {
    console.error("Usage: npx tsx scripts/translate-cli.ts <transcript.md> [ru|uk]");
    process.exit(1);
  }

  const text = readFileSync(inputPath, "utf-8");
  if (!text.trim()) {
    console.error("Input file is empty");
    process.exit(1);
  }

  console.log(`\n=== Translating to ${lang} ===`);
  console.log(`Input: ${inputPath} (${text.length} chars)`);

  const t0 = Date.now();
  const translated = await translate(text, lang);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const outPath = inputPath.replace(/(_restored|_cleaned)?\.md$/, `_${lang}.md`);
  writeFileSync(outPath, translated);

  console.log(`Translated: ${translated.length} chars (${elapsed}s)`);
  console.log(`  → ${outPath}`);
}

main().catch((err) => {
  console.error(`Translation failed: ${err.message}`);
  process.exit(1);
});
