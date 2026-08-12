#!/usr/bin/env node
/**
 * Content-matching verse identification for the 16 BB lectures whose
 * filenames carry no parseable verse range (topical/thematic talks).
 *
 * Haiku citation-extraction (extract-topical-verse-ranges.ts) came back
 * NONE for all 16 — Mahārāja doesn't verbally state numeric verse
 * citations ("BB 1.1.1"), he just reads the Sanskrit and says "the first
 * verse" / "continuing from last time." So instead: extract the actual
 * Sanskrit verse text (IAST) each transcript quotes, and match it against
 * Gopīparāṇadhana's Vol.1 commentary's own verse text using the SAME
 * deterministic n-gram/Jaccard approach verse-restore.mjs already uses to
 * match garbled Whisper output against the scripture corpus — reusing a
 * proven technique rather than asking a model to recall verse numbers it
 * doesn't reliably know (same "code-level enforcement over prompt-only
 * reliability" lesson as everywhere else in this pipeline).
 *
 * A lecture can cite more than one BB verse — collect all matches above
 * threshold, not just the first.
 *
 * Usage: node scripts/match-topical-verses.mjs
 * Output: scripts/topical-verse-matches.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOL1_PATH = join(
  process.env.HOME,
  "Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md"
);
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

// --- Same matching primitives as verse-restore.mjs ---
function stripDiacritics(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ṁḥṅñṭḍṇśṣ]/g, (c) => ({
      ṁ: "m", ḥ: "h", ṅ: "n", ñ: "n", ṭ: "t", ḍ: "d",
      ṇ: "n", ś: "s", ṣ: "s",
    })[c] || c)
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function ngrams(s, n = 3) {
  const clean = stripDiacritics(s).replace(/\s+/g, "");
  const out = new Set();
  for (let i = 0; i + n <= clean.length; i++) out.add(clean.slice(i, i + n));
  return out;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// --- Build the Vol.1 verse-anchor corpus ---
function buildVol1Corpus() {
  const text = readFileSync(VOL1_PATH, "utf-8");
  const lines = text.split("\n");
  const corpus = []; // { ref, text, grams }

  let currentRef = null;
  let verseLines = [];

  const flush = () => {
    if (currentRef && verseLines.length) {
      const verseText = verseLines.join(" ");
      if (verseText.length >= 20) {
        corpus.push({ ref: currentRef, text: verseText, grams: ngrams(verseText) });
      }
    }
    verseLines = [];
  };

  const headerRe = /^## BB (\d+)\.(\d+)\.(\d+)(?:-(\d+))?/;
  const verseLineRe = /^`?\*\*Verse:\*\*\s*(.+?)`?$/;

  for (const line of lines) {
    const h = headerRe.exec(line);
    if (h) {
      flush();
      const [, part, chapter, vStart, vEnd] = h;
      currentRef = vEnd ? `${part}.${chapter}.${vStart}-${vEnd}` : `${part}.${chapter}.${vStart}`;
      continue;
    }
    const v = verseLineRe.exec(line.trim());
    if (v && currentRef) {
      verseLines.push(v[1]);
    }
  }
  flush();

  return corpus;
}

// --- Extract candidate Sanskrit verse blocks from a transcript ---
function isVerseLine(line) {
  const t = line.trim();
  if (t.length < 8) return false;
  const diacritics = (t.match(/[āīūṛṝḷḹṃḥṅñṭḍṇśṣ]/g) || []).length;
  const words = t.split(/\s+/).length;
  // High diacritic density + short-ish lines = likely Sanskrit verse text,
  // not English prose (same heuristic spirit as the corpus's own IAST bias)
  return diacritics >= 2 && words <= 12 && !/[.!?]{1}\s*$/.test(t) === false ? true : diacritics >= 2 && words <= 14;
}

function extractVerseBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (isVerseLine(line)) {
      current.push(line.trim());
    } else {
      if (current.length >= 2) blocks.push(current.join(" "));
      current = [];
    }
  }
  if (current.length >= 2) blocks.push(current.join(" "));
  return blocks;
}

function main() {
  console.log("Building Vol.1 verse corpus...");
  const corpus = buildVol1Corpus();
  console.log(`  ${corpus.length} verse anchors loaded\n`);

  const results = [];

  for (const slug of TOPICAL_FILES) {
    const path = join(BB_DIR, slug, `${slug}_restored.md`);
    const text = readFileSync(path, "utf-8");
    const blocks = extractVerseBlocks(text);

    const matches = new Map(); // ref -> best score

    for (const block of blocks) {
      const bg = ngrams(block);
      if (bg.size < 10) continue; // too short to be a reliable signal
      let best = null;
      for (const c of corpus) {
        const s = jaccard(bg, c.grams);
        if (!best || s > best.score) best = { score: s, ref: c.ref };
      }
      if (best && best.score >= 0.3) {
        const prev = matches.get(best.ref);
        if (!prev || best.score > prev) matches.set(best.ref, best.score);
      }
    }

    const sorted = [...matches.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `${slug.padEnd(45)} -> ${
        sorted.length ? sorted.map(([ref, s]) => `${ref} (${s.toFixed(2)})`).join(", ") : "NO MATCH"
      }  [${blocks.length} verse-like blocks scanned]`
    );
    results.push({ slug, matches: sorted.map(([ref, score]) => ({ ref, score })) });
  }

  const outPath = join(__dirname, "topical-verse-matches.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n-> ${outPath}`);

  const found = results.filter((r) => r.matches.length > 0);
  console.log(`\n${found.length}/${results.length} lectures got at least one match ≥0.30`);
}

main();
