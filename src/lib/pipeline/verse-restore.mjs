/**
 * Verse-restore — deterministic corpus-only pass (no LLM calls).
 * Ported from nrs-pipeline-lambda/src/verse-restore.mjs.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CORPUS = (() => {
  let base = {};
  try {
    base = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "corpus.json"), "utf-8"));
  } catch {
    console.error("[verse-restore] corpus.json not found — proceeding without corpus");
  }
  try {
    const seeds = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "corpus-seeds.json"), "utf-8"));
    let count = 0;
    for (const [k, v] of Object.entries(seeds)) {
      if (k === "_meta") continue;
      base[k] = v;
      count++;
    }
    if (count) console.log(`[verse-restore] merged ${count} seed entries`);
  } catch {
    // corpus-seeds.json is optional
  }
  return base;
})();

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

const PRAYER_ALIAS = new Set(["CC Ādi-līlā 12.2"]);

const CORPUS_NGRAMS = (() => {
  const arr = [];
  for (const [key, e] of Object.entries(CORPUS)) {
    if (!e.text || e.text.length < 20) continue;
    if (PRAYER_ALIAS.has(key)) continue;
    arr.push({ key, entry: e, grams: ngrams(e.text) });
  }
  console.log(`[verse-restore] corpus loaded: ${arr.length} entries with n-grams`);
  return arr;
})();

const REFERENCE_OVERRIDE = {
  "BB 1": "BB 1.1.1", "BB 2": "BB 1.1.2", "BB 3": "BB 1.1.3",
  "BB 4": "BB 1.1.4", "BB 5": "BB 1.1.5", "BB 6": "BB 1.1.6",
  "BB 7": "BB 1.1.7", "BB 8": "BB 1.1.8",
};

// --- Spoken-reference extraction (ported from restore.ts) ---
function extractReferences(text) {
  const refs = [];
  for (const m of text.matchAll(/\b(BG|SB|CC|BB|BRS|BS|Iso|CB)\s+([\dA-Za-z.\s]+?)\b(?=[\s,.;?!]|$)/g)) {
    refs.push(`${m[1]} ${m[2].trim()}`);
  }
  const bb = text.match(/Volume\s+(\d+)[,.\s]+Chapter\s+(\d+)[,.\s]+Text\s+(\d+)/i);
  if (bb) refs.push(`BB ${bb[1]}.${bb[2]}.${bb[3]}`);
  // Named works: Mahāprabhu's eight verses are cited by NAME + verse number
  // ("Śikṣāṣṭaka 3", "Siksastaka verse 3", "Shikshashtakam 3"), never by a
  // scripture prefix. Corpus keys are "Śikṣāṣṭaka N" — aliases of the
  // CC Antya-līlā 20.x entries that hold the same text.
  // Match on a folded copy: JS \b does not treat "Ś" as a word char, and the
  // anglicised spelling uses "sh" digraphs ("Shikshashtakam"). Fold diacritics,
  // then collapse sh→s so every spelling reduces to "siksastaka".
  const folded = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/sh/g, "s");
  for (const m of folded.matchAll(/siksastakam?[^a-z0-9]{0,12}(?:verse\s*)?([1-8])(?![0-9])/g)) {
    refs.push(`Śikṣāṣṭaka ${m[1]}`);
  }
  return refs;
}

// --- Maṅgalācaraṇa (opening prayer) matcher (ported from restore.ts d183935) ---
// Exact-substring probes first, then fuzzy n-gram Jaccard scoped ONLY to
// the 6 prayer-keyed corpus entries. Accepts at score ≥ 0.15 with ≥ 0.05
// lead over runner-up; requires ≥ 8 trigrams. Safe because the candidate
// pool is 6 known prayers — a genuine scripture verse scores ~0.05 against
// this set.
function looksLikeMangalacarana(garbled) {
  const flat = garbled.toLowerCase().replace(/[^a-zāīūṛḷṅñṭḍṇśṣḥṁ]/g, "");
  const probes = [
    ["mukamkaroti", "Guru-praṇāma"],
    ["ajñānatimirāndhasya", "Jñāna-cakṣur-praṇāma"],
    ["ajnanatimir", "Jñāna-cakṣur-praṇāma"],
    ["namoṁviṣṇupādāya", "Prabhupāda-praṇāma"],
    ["namovisnupadaya", "Prabhupāda-praṇāma"],
    ["namoombhagavatevāsudevāya", "Bhagavat-namaskāra"],
    ["harekṛṣṇaharekṛṣṇa", "Mahā-mantra"],
    ["harekrishnaharekrishna", "Mahā-mantra"],
    ["hariharirama", "Mahā-mantra"],
    ["namastenarasiṁhāya", "Nṛsiṁha-praṇāma"],
    ["namastenarasimhaya", "Nṛsiṁha-praṇāma"],
    ["śrīkṛṣṇacaitanya", "Pañca-tattva-mantra"],
    ["srikrishnacaitanya", "Pañca-tattva-mantra"],
    ["taptakāñcanagaurāṅgi", "Rādhā-praṇāma"],
    ["taptakanchanagaurangi", "Rādhā-praṇāma"],
    ["vṛṣabhānu", "Rādhā-praṇāma"],
    ["vrishabhanusute", "Rādhā-praṇāma"],
    ["oṁnamobhagavatevyāsadevāya", "Vyāsa-namaskāra"],
    ["oṁnamobhagavatevyasadevaya", "Vyāsa-namaskāra"],
  ];
  for (const [needle, key] of probes) {
    if (flat.includes(needle)) return key;
  }
  const PRAYER_FLOOR = 0.15;
  const PRAYER_MARGIN = 0.05;
  const tri = (s) => {
    const t = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    const out = new Set();
    for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const jac = (a, b) => {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  };
  const gg = tri(garbled);
  if (gg.size < 8) return null;
  const scored = [];
  for (const [key, entry] of Object.entries(CORPUS)) {
    if (!/praṇāma|mantra|namaskāra/i.test(key)) continue;
    const text = typeof entry === "string" ? entry : entry?.text ?? "";
    if (!text) continue;
    scored.push([jac(gg, tri(text)), key]);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored[0];
  const runnerUp = scored[1]?.[0] ?? 0;
  if (top[0] >= PRAYER_FLOOR && top[0] - runnerUp >= PRAYER_MARGIN) return top[1];
  return null;
}

const PRAYER_KEY = /praṇāma|mantra|namaskāra|mahā-mantra/i;

function displayReference(corpusRef) {
  let ref = REFERENCE_OVERRIDE[corpusRef] || corpusRef;
  ref = ref.replace(/^(SB|CC|CB|BB|BRS) (\d+) (\d)/, "$1 $2.$3");
  return ref;
}

// Keys that name a work directly rather than by scripture reference. Used to
// settle exact score ties in favour of the meaningful label (see the match
// loop in autoRestoreFromCorpus).
const NAMED_WORK =
  /^(Śikṣāṣṭaka|Guru-praṇāma|Prabhupāda-praṇāma|Jñāna-cakṣur-praṇāma|Pañca-tattva-mantra|Mahā-mantra|Nṛsiṁha-praṇāma|Bhagavat-namaskāra|Rādhā-praṇāma|Vyāsa-namaskāra)\b/;

const CC_KEY = /^CC\b/;

const COMMON_SUBS = [
  { from: /\bRādhe(-|\s+)Kṛṣṇa\b/g, to: "Hare Kṛṣṇa" },
  { from: /\bRadhe(-|\s+)Krishna\b/g, to: "Hare Krishna" },
];

function applyCommonSubs(md) {
  const hits = [];
  let out = md;
  for (const { from, to } of COMMON_SUBS) {
    const before = out;
    out = out.replace(from, to);
    if (out !== before) hits.push(`${from.source} → ${to}`);
  }
  return { text: out, hits };
}

function restoreLectureOpening(md) {
  const lines = md.split(/\r?\n/);
  const headerWindow = lines.slice(0, 5).join(" ").toLowerCase();
  if (!/dear devotees/i.test(headerWindow)) return { text: md, fixed: false };
  if (/all glories to (?:śrīla |srila )?prabhup[aā]d/i.test(headerWindow)) {
    return { text: md, fixed: false };
  }
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (/dear devotees/i.test(lines[i])) {
      lines[i] = lines[i].replace(
        /(dear devotees)[.,]?\s*(?:(?:all\s+)?(?:glor(?:y|ies)|obeisances)\s+to\s+(?:(?:śrīla|srila)\s+)?prabhup[aā]d[aā]\.?\s*|(?:our\s+)?glorious\s+(?:\S+\s+)?prabhup[aā]d[aā]\.?\s*)?/i,
        "dear devotees. All glories to Śrīla Prabhupāda. "
      );
      lines[i] = lines[i].replace(/ {2,}/g, " ").trimEnd();
      return { text: lines.join("\n"), fixed: true };
    }
  }
  return { text: md, fixed: false };
}

const ENG_STOPS = new Set([
  "the","is","of","and","to","that","this","for","with","not","are","was",
  "but","has","had","his","her","can","our","how","who","we","he","she",
  "it","do","if","so","as","by","at","in","on","or","an","no",
  "you","your","very","much","them","they","been","what","when","will",
  "from","about","just","want","here","now","have","also","would","could",
]);

function isVerseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 10) return false;
  if (/[Ѐ-ӿ]/.test(trimmed)) return false;
  // Split on whitespace only — \b matches inside hyphenated Sanskrit
  // compounds ("jñāna-karmādy-anāvṛtam" → false \ban\b hit).
  const tokens = trimmed.split(/\s+/);
  const words = tokens.length;
  const engWords = tokens.filter(t => ENG_STOPS.has(t.toLowerCase())).length;
  if (engWords / words >= 0.15) return false;
  const iastChars = (trimmed.match(/[āīūṛḷṅñṭḍṇśṣḥṁ]/g) || []).length;
  return iastChars >= 3 && iastChars / words >= 0.4;
}

function autoRestoreFromCorpus(md) {
  const lines = md.split(/\r?\n/);
  let restored = 0;
  let skipped = 0;
  const identified = [];

  let i = 0;
  while (i < lines.length) {
    // Secondary entry: [unverified citation] tag — gather lines below it
    // as a verse block even if isVerseLine fails (covers low-IAST or ASCII
    // garbles that Sonnet already flagged).
    if (/\[unverified citation\]/i.test(lines[i])) {
      const tagIdx = i;
      i++;
      const verseLines = [];
      while (i < lines.length && lines[i].trim() &&
             !lines[i].startsWith("[") &&
             !/^(Commentary|That |So |And |This |He |She |We |The |In |But |For |As |It |They |Which |What |Where |When |How )/.test(lines[i])) {
        verseLines.push(lines[i].trim());
        i++;
      }
      if (verseLines.length > 0) {
        const garbled = verseLines.join(" ");
        const q = ngrams(garbled);
        let best = null;
        for (const c of CORPUS_NGRAMS) {
          const s = jaccard(q, c.grams);
          if (!best || s > best.score ||
              (s === best.score && NAMED_WORK.test(c.key) && !NAMED_WORK.test(best.key)) ||
              (Math.abs(s - best.score) < 0.02 && !CC_KEY.test(c.key) && CC_KEY.test(best.key))) {
            best = { score: s, entry: c.entry, key: c.key };
          }
        }
        if (best && best.score >= 0.30) {
          const ref = best.entry.reference ? displayReference(best.entry.reference) : best.key;
          // Replace tag + garbled verse with canonical text + reference
          const canonical = best.entry.text.split(/\r?\n/);
          if (!PRAYER_KEY.test(best.key)) canonical.push(`(${ref})`);
          const label = best.score >= 0.85 ? "near-canonical" : "auto-restore";
          console.log(`  ${label}: "${verseLines[0].slice(0, 60)}…" → ${ref} (score ${best.score.toFixed(2)}, via [unverified])`);
          identified.push({ reference: best.entry.reference || ref, score: best.score });
          lines.splice(tagIdx, i - tagIdx, ...canonical);
          i = tagIdx + canonical.length;
          restored++;
          continue;
        }
      }
      continue;
    }

    if (!isVerseLine(lines[i])) { i++; continue; }

    const verseStart = i;
    const verseLines = [];
    while (i < lines.length && isVerseLine(lines[i])) {
      verseLines.push(lines[i].trim());
      i++;
    }
    if (verseLines.length === 0) continue;

    const garbled = verseLines.join(" ");

    // Prayer check — multi-line blocks only. Single-line "Hare Kṛṣṇa"
    // or "oṁ namo" mixed with English falls through to general corpus,
    // which rejects short mismatches via the length-ratio gate.
    const earlyPrayerKey = verseLines.length > 1 ? looksLikeMangalacarana(garbled) : null;
    if (earlyPrayerKey && CORPUS[earlyPrayerKey]) {
      const pe = CORPUS[earlyPrayerKey];
      const canonical = pe.text.split(/\r?\n/);
      // Skip when heard text is already correct and LONGER than canonical
      // — that means intentional repetition (triple oṁ namo, japa rounds),
      // not a garble that needs restoration.
      const hLen = stripDiacritics(garbled).replace(/\s/g, "").length;
      const cLen = stripDiacritics(pe.text).replace(/\s/g, "").length;
      if (hLen > cLen) {
        const fg = ngrams(garbled), cg = ngrams(pe.text);
        let hit = 0;
        for (const g of fg) if (cg.has(g)) hit++;
        if (fg.size > 0 && hit / fg.size >= 0.90) continue;
      }
      let spliceStart = verseStart;
      if (verseStart > 0 && /\[unverified citation\]/i.test(lines[verseStart - 1])) {
        spliceStart = verseStart - 1;
      }
      const pRef = pe.reference ? displayReference(pe.reference) : earlyPrayerKey;
      console.log(`  prayer-restore: "${verseLines[0].slice(0, 60)}…" → ${pRef} (prayer match)`);
      identified.push({ reference: pe.reference || pRef, score: 1.0 });
      lines.splice(spliceStart, i - spliceStart, ...canonical);
      i = spliceStart + canonical.length;
      restored++;
      // One-shot fragment removal: if next verse block is SHORTER than
      // canonical AND mostly contained, it's a leftover stanza (e.g.
      // praṇāma stanza 2). Full-length repeats (triple oṁ namo) kept.
      let tail = i;
      while (tail < lines.length && !lines[tail].trim()) tail++;
      if (tail < lines.length && isVerseLine(lines[tail])) {
        let blockEnd = tail;
        while (blockEnd < lines.length && isVerseLine(lines[blockEnd])) blockEnd++;
        if (blockEnd - tail < canonical.length) {
          const fg = ngrams(lines.slice(tail, blockEnd).join(" "));
          const cg = ngrams(pe.text);
          let hit = 0;
          for (const g of fg) if (cg.has(g)) hit++;
          if (fg.size > 0 && hit / fg.size >= 0.80) {
            lines.splice(tail, blockEnd - tail);
          }
        }
      }
      continue;
    }

    // General corpus match (full 26k+ entries)
    const q = ngrams(garbled);
    let best = null;
    for (const c of CORPUS_NGRAMS) {
      const s = jaccard(q, c.grams);
      if (!best || s > best.score ||
          (s === best.score && NAMED_WORK.test(c.key) && !NAMED_WORK.test(best.key)) ||
          (Math.abs(s - best.score) < 0.02 && !CC_KEY.test(c.key) && CC_KEY.test(best.key))) {
        best = { score: s, entry: c.entry, key: c.key };
      }
    }

    if (best && best.score >= 0.85) {
      const ref = best.entry.reference ? displayReference(best.entry.reference) : best.key;
      let spliceStart = verseStart;
      if (verseStart > 0 && /\[unverified citation\]/i.test(lines[verseStart - 1])) {
        spliceStart = verseStart - 1;
      }
      const canonical = best.entry.text.split(/\r?\n/);
      if (!PRAYER_KEY.test(best.key)) canonical.push(`(${ref})`);
      console.log(`  near-canonical: "${verseLines[0].slice(0, 60)}…" → ${ref} (score ${best.score.toFixed(2)})`);
      identified.push({ reference: best.entry.reference || ref, score: best.score });
      lines.splice(spliceStart, i - spliceStart, ...canonical);
      i = spliceStart + canonical.length;
      restored++;
      continue;
    }

    // Containment check (correct excerpt, not garbled). Floor is 0.35 to
    // match the lowest gate below, so a comparable-length match that is
    // already canonical is still skipped rather than needlessly rewritten.
    if (best && best.score >= 0.35) {
      const canonGrams = best.entry.text ? ngrams(best.entry.text) : new Set();
      let contained = 0;
      for (const g of q) if (canonGrams.has(g)) contained++;
      const containment = q.size > 0 ? contained / q.size : 0;
      if (containment >= 0.90) {
        // Same cite-only fix for containment skip
        if (verseStart > 0 && /\[unverified citation\]/i.test(lines[verseStart - 1])) {
          const ref = best.entry.reference ? displayReference(best.entry.reference) : best.key;
          lines[verseStart - 1] = `(${ref})`;
          console.log(`  cite-only: "${verseLines[0].slice(0, 60)}…" → ${ref} (score ${best.score.toFixed(2)})`);
          identified.push({ reference: best.entry.reference || ref, score: best.score });
        }
        skipped++; continue;
      }
    }

    // Length guard (2026-07-28, evidence: scripts/eval-gate.py over 17
    // transcripts). Lowering the gate alone corrupts transcripts: Mahārāja
    // says "Hare Kṛṣṇa." as a greeting six times across these lectures, and
    // that scores 0.35 against the full four-line Mahā-mantra — a 9-char
    // heard span vs a 68-char verse. Every CORRECT band match was 47-84% of
    // its verse's length; that false one was 13%. So require comparable
    // length before trusting a sub-0.40 score.
    const heardLen = stripDiacritics(garbled).replace(/\s/g, "").length;
    const verseLen = best?.entry?.text
      ? stripDiacritics(best.entry.text).replace(/\s/g, "").length
      : 0;
    const lengthRatio = verseLen > 0 ? heardLen / verseLen : 0;
    const longEnough = lengthRatio >= 0.40;

    // Gate: 0.40 outright, or 0.35 when the lengths are comparable. Admits 4
    // more correct BB verses across these lectures with no known false
    // positive. Cases at 0.25-0.27 (SB 6.17.28, BB 91) stay refused — a
    // scalar gate cannot reach them without also admitting wrong-verse
    // matches of identical length (e.g. the dvādaśākṣara mantra scoring 0.30
    // against SB 1.5.37). That needs the detection classifier, not a lower gate.
    const GATE = longEnough ? 0.35 : 0.40;

    let matchEntry = null;
    let matchRef = null;
    let matchMethod = null;

    if (best && best.score >= GATE) {
      matchEntry = best.entry;
      matchRef = best.entry.reference ? displayReference(best.entry.reference) : best.key;
      matchMethod = `score ${best.score.toFixed(2)}`;
    }

    if (!matchEntry) {
      // No corpus or prayer match — auto-tag for manual review unless
      // already tagged by upstream cleanup. Guard against isVerseLine
      // false positives (single-line greetings with IAST names) by
      // requiring multi-line OR a meaningful corpus score.
      const shouldTag = verseLines.length >= 2 || (best && best.score >= 0.20);
      if (shouldTag && (verseStart === 0 || !/\[unverified citation\]/i.test(lines[verseStart - 1]))) {
        lines.splice(verseStart, 0, "[unverified citation]");
        i = verseStart + 1 + verseLines.length;
        console.log(`  auto-tag: "${verseLines[0].slice(0, 60)}…" (best score ${best?.score?.toFixed(2) ?? "none"})`);
      }
      continue;
    }

    let spliceStart = verseStart;
    if (verseStart > 0 && /\[unverified citation\]/i.test(lines[verseStart - 1])) {
      spliceStart = verseStart - 1;
    }

    const canonical = matchEntry.text.split(/\r?\n/);
    if (matchRef && !PRAYER_KEY.test(matchRef)) canonical.push(`(${matchRef})`);

    const label = matchMethod.startsWith("prayer") ? "prayer-restore" : "auto-restore";
    console.log(`  ${label}: "${verseLines[0].slice(0, 60)}…" → ${matchRef} (${matchMethod})`);
    identified.push({ reference: matchEntry.reference || matchRef, score: best?.score ?? 1.0 });

    lines.splice(spliceStart, i - spliceStart, ...canonical);
    i = spliceStart + canonical.length;
    restored++;
  }

  return { text: lines.join("\n"), restored, skipped, identified };
}

export { looksLikeMangalacarana, extractReferences };

export function restoreVerses(md) {
  const log = [];

  const pre = applyCommonSubs(md);
  if (pre.hits.length > 0) {
    log.push(`Common-subs: ${pre.hits.join(", ")}`);
  }
  let text = pre.text;

  const opening = restoreLectureOpening(text);
  if (opening.fixed) {
    log.push('Lecture opening restored: "All glories to Śrīla Prabhupāda"');
  }
  text = opening.text;

  const auto = autoRestoreFromCorpus(text);
  if (auto.restored > 0 || auto.skipped > 0) {
    log.push(`Auto-restore: ${auto.restored} substituted, ${auto.skipped} already canonical`);
  }
  text = auto.text;

  return {
    text,
    stats: {
      substituted: auto.restored,
      already_canonical: auto.skipped,
      common_subs: pre.hits.length,
      opening_fixed: opening.fixed,
      identified_verses: auto.identified,
    },
    log,
  };
}
