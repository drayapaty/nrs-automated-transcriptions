#!/usr/bin/env node
/**
 * Second-pass verse identification for the 15 lectures where
 * match-topical-verses.mjs (Sanskrit-text matching) found nothing.
 *
 * Root cause, confirmed 2026-08-12 by reading two transcripts by hand
 * (Divakar's find): several of these lectures don't re-quote the Sanskrit
 * at all — they read the ENGLISH TRANSLATION/COMMENTARY instead ("We're
 * reading the first chapter, first verse... I'll read the translation of
 * the verse once again: 'All glories to that inconceivable Lord...'" —
 * word-for-word matching BB 1.1.1's Translation text in Vol.1). The
 * Sanskrit-only matcher structurally can't see this.
 *
 * This pass builds a second corpus from Vol.1's own **Translation:** and
 * **Commentary:** text per verse anchor (same source file, different
 * section) and matches each target transcript's FULL text against it via
 * word-4-gram Jaccard — English prose, so word-level n-grams (not the
 * character-level ones used for Sanskrit, which assume tight/undiacritic'd
 * spelling variance, not applicable here).
 *
 * Usage: node scripts/match-verses-by-commentary.mjs
 * Output: scripts/topical-verse-matches-by-commentary.json
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

// The 15 lectures with zero Sanskrit-text match (from match-topical-verses.mjs
// + the 4 verse-range lectures whose inline citations came up empty)
const TARGET_FILES = [
  "2023_03_10_bb_taiwan_p2",
  "2025_09_14_bb_caitanya",
  "2025_09_21_bb_two_types_dainya",
  "2025_09_28_bb_dainya",
  "2025_10_03_bb_qualifying",
  "2025_10_05_bb_two_useless",
  "2025_10_19_bb_human_birth",
  "2025_10_30_bb_is_sb",
  "2025_12_21_bb_book_dist",
  "2026_03_29_bb_budapest",
  "2026_04_01_radha_kunda_prakat_en_hu",
  "2026_04_05_bb_budapest",
  "2025_09_11_bb_1_1_24_42",
  "2025_11_02_bb_1_2_14_18",
  "2025_11_09_bb_1_2_19_30",
  "2026_02_08_bb_1_2_35_42",
];

function words(s) {
  return s
    .toLowerCase()
    .replace(/[^a-zāīūṛṝḷḹṃḥṅñṭḍṇśṣ'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordNgrams(text, n = 4) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

// Containment, not Jaccard: what fraction of the (short) verse anchor's
// n-grams show up somewhere in the (long) transcript. Jaccard divides by
// the union, which a multi-thousand-word transcript dominates regardless
// of match quality — a perfect quote of a 150-word translation still
// scores near-zero against a 4000-word transcript under plain Jaccard.
function containment(anchorNgrams, transcriptNgrams) {
  if (anchorNgrams.size === 0) return 0;
  let inter = 0;
  for (const x of anchorNgrams) if (transcriptNgrams.has(x)) inter++;
  return inter / anchorNgrams.size;
}

function buildCommentaryCorpus() {
  const text = readFileSync(VOL1_PATH, "utf-8");
  const lines = text.split("\n");
  const corpus = []; // { ref, translationNgrams, commentaryNgrams }

  let currentRef = null;
  let transBuffer = [];
  let commBuffer = [];

  // Translation and Commentary scored SEPARATELY, not merged into one blob.
  // Translation text is read near-verbatim (high signal, short — ~50-150
  // word ngrams). Commentary is Sanātana Gosvāmī's/Gopīparāṇadhana's full
  // written prose, usually paraphrased or only partially read aloud — much
  // longer (hundreds to thousands of words), so merging it in dilutes a
  // perfect Translation match down near zero under containment scoring
  // (confirmed bug, 2026-08-12: BB 1.1.1 scored 0.98 on Translation alone,
  // 0.05 once Commentary was merged in — a real quote got buried under
  // mostly-unread commentary text).
  const flush = () => {
    if (currentRef) {
      const transText = transBuffer.join(" ");
      const commText = commBuffer.join(" ");
      if (transText.length >= 20 || commText.length >= 40) {
        corpus.push({
          ref: currentRef,
          translationNgrams: transText.length >= 20 ? wordNgrams(transText) : null,
          commentaryNgrams: commText.length >= 40 ? wordNgrams(commText) : null,
        });
      }
    }
    transBuffer = [];
    commBuffer = [];
  };

  const headerRe = /^## BB (\d+)\.(\d+)\.(\d+)(?:-(\d+))?/;
  const transRe = /^\*\*Translation:\*\*\s*(.+)$/;
  const commRe = /^\*\*Commentary:\*\*\s*(.+)$/;

  for (const line of lines) {
    const h = headerRe.exec(line);
    if (h) {
      flush();
      const [, part, chapter, vStart, vEnd] = h;
      currentRef = vEnd ? `${part}.${chapter}.${vStart}-${vEnd}` : `${part}.${chapter}.${vStart}`;
      continue;
    }
    const t = transRe.exec(line.trim());
    const c = commRe.exec(line.trim());
    if (t) transBuffer.push(t[1]);
    else if (c) commBuffer.push(c[1]);
  }
  flush();

  return corpus;
}

function main() {
  console.log("Building Vol.1 translation+commentary corpus...");
  const corpus = buildCommentaryCorpus();
  console.log(`  ${corpus.length} verse anchors with translation/commentary text\n`);

  const results = [];

  for (const slug of TARGET_FILES) {
    const path = join(BB_DIR, slug, `${slug}_restored.md`);
    let text;
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      console.log(`${slug.padEnd(45)} -> SKIP (file not found)`);
      continue;
    }

    const tg = wordNgrams(text);
    const scored = [];
    for (const c of corpus) {
      const transScore = c.translationNgrams ? containment(c.translationNgrams, tg) : 0;
      const commScore = c.commentaryNgrams ? containment(c.commentaryNgrams, tg) : 0;
      const s = Math.max(transScore, commScore);
      const via = transScore >= commScore ? "translation" : "commentary";
      if (s >= 0.15) scored.push({ ref: c.ref, score: s, via });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);

    console.log(
      `${slug.padEnd(45)} -> ${
        top.length ? top.map((m) => `${m.ref} (${m.score.toFixed(3)} via ${m.via})`).join(", ") : "NO MATCH"
      }`
    );
    results.push({ slug, matches: top });
  }

  const outPath = join(__dirname, "topical-verse-matches-by-commentary.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n-> ${outPath}`);
}

main();
