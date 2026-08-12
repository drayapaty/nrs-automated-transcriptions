#!/usr/bin/env npx tsx
/**
 * For the 16 BB lectures whose filenames don't carry a parseable verse
 * range (topical/thematic talks — "BB Caitanya", "BB Two Useless Things",
 * etc.), ask Haiku to read the transcript and identify what BB part/
 * chapter/verse(s) is actually being read/commented on, if any. Some of
 * these genuinely aren't sequential verse commentary (a festival talk, a
 * japa reading session) — Haiku is told to say NONE for those rather than
 * guess.
 *
 * This does NOT run compare/elaborate itself — it only produces the verse
 * range so compare-cli.ts can be called with explicit part/chapter/verse
 * args for whichever of the 16 turn out to have one.
 *
 * Usage:
 *   npx tsx scripts/extract-topical-verse-ranges.ts
 *
 * Output: prints one line per file, and writes
 *   scripts/topical-verse-ranges.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

import { anthropic } from "../src/lib/clients";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const BB_DIR = "/Users/divakar/Downloads/bb-book-chapters-2026-08-05";

const TOPICAL_FILES = [
  "2023_03_09_bb_taiwan_p1",
  "2023_03_10_bb_taiwan_p2",
  "2025_07_11_bb_japa_reading",
  "2025_09_14_bb_caitanya",
  "2025_09_21_bb_two_types_dainya",
  "2025_09_28_bb_dainya",
  "2025_10_03_bb_qualifying",
  "2025_10_05_bb_two_useless",
  "2025_10_12_bb_divine_strategy",
  "2025_10_19_bb_human_birth",
  "2025_10_30_bb_is_sb",
  "2025_12_21_bb_book_dist",
  "2026_03_29_bb_budapest",
  "2026_04_01_radha_kunda_prakat_en_hu",
  "2026_04_05_bb_budapest",
  "2026_05_02_nrsimha_caturdasi_en_hu",
];

const SYSTEM_PROMPT = `You read transcripts of H.H. Niranjana Swami's lectures on Bṛhad-bhāgavatāmṛta (a Sanskrit text by Śrīla Sanātana Gosvāmī, translated/commented on by Gopīparāṇadhana Dāsa). Your job: identify which specific verse(s) of the Bṛhad-bhāgavatāmṛta (BB) the lecture is reading and commenting on — not verses he merely quotes in passing from other scriptures (Bhagavad-gītā, Śrīmad-Bhāgavatam, etc.), only BB itself.

A lecture may cover MORE THAN ONE verse or verse range — e.g. it might read and comment on 1.1.1, then later in the same talk jump to 1.2.14-18. List every distinct BB verse/range actually read and commented on, in the order they appear.

Look for signals like: "continuing from where we left off," "the next verse," explicit "part X, chapter Y" references, or Sanskrit verse text followed by his translation/commentary that's clearly BB's own narrative (not a quoted scripture).

Return ONE range per line, in exactly this format, nothing else on each line:
PART.CHAPTER.VERSESTART or PART.CHAPTER.VERSESTART-VERSEEND

If the lecture is NOT primarily BB verse-by-verse commentary at all (a festival talk, a general topic talk, a japa/reading session with no sustained BB narrative, a talk mainly quoting other scriptures), return exactly:
NONE

Do not guess. If uncertain about a specific range, leave it out rather than inventing a wrong verse number. If nothing is certain, return NONE.`;

async function extractOne(slug: string): Promise<{ slug: string; ranges: string[] }> {
  const path = join(BB_DIR, slug, `${slug}_restored.md`);
  const text = readFileSync(path, "utf-8");
  // First ~12000 chars is plenty — the verse being read is always established early
  const excerpt = text.slice(0, 12000);

  const response = await anthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: excerpt }],
  });
  const block = response.content.find((b) => b.type === "text");
  const raw = ((block as { text?: string } | undefined)?.text || "").trim();

  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^[-*\d.]+\s*/, "").trim())
    .filter(Boolean);

  const ranges = lines.filter((l) => /^\d+\.\d+\.\d+(-\d+)?$/.test(l));
  return { slug, ranges };
}

async function main() {
  const results: Array<{ slug: string; ranges: string[] }> = [];
  for (const slug of TOPICAL_FILES) {
    const r = await extractOne(slug);
    console.log(`${slug.padEnd(45)} -> ${r.ranges.length ? r.ranges.join(", ") : "NONE"}`);
    results.push(r);
  }

  const outPath = join(__dirname, "topical-verse-ranges.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n-> ${outPath}`);

  const found = results.filter((r) => r.ranges.length > 0);
  const none = results.filter((r) => r.ranges.length === 0);
  const multi = results.filter((r) => r.ranges.length > 1);
  console.log(`\n${found.length} with at least one verse range, ${none.length} genuinely NONE, ${multi.length} with multiple ranges`);
}

main().catch((err) => {
  console.error(`Extraction failed: ${err.message}`);
  process.exit(1);
});
