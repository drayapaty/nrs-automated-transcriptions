/**
 * Verse-restore — deterministic corpus-only pass (no LLM calls).
 * Ported from nrs-pipeline-lambda/src/verse-restore.mjs.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CORPUS = (() => {
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "corpus.json"), "utf-8"));
    return raw;
  } catch {
    console.error("[verse-restore] corpus.json not found — proceeding without corpus");
    return {};
  }
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

const CORPUS_NGRAMS = (() => {
  const arr = [];
  for (const [key, e] of Object.entries(CORPUS)) {
    if (!e.text || e.text.length < 20) continue;
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

function displayReference(corpusRef) {
  return REFERENCE_OVERRIDE[corpusRef] || corpusRef;
}

const COMMON_SUBS = [
  { from: /\bRādhe(-|\s+)Kṛṣṇa\b/g, to: "Hare Kṛṣṇa" },
  { from: /\bRadhe(-|\s+)Krishna\b/g, to: "Hare Krishna" },
  { from: /(?<![-Ā-ɏ\w])bhaktas(?![-])/g, to: "devotees" },
  { from: /(?<![-Ā-ɏ\w])bhakta(?![-\w])/g, to: "devotee" },
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
  if (/all glories to/i.test(headerWindow)) return { text: md, fixed: false };
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (/dear devotees/i.test(lines[i])) {
      lines[i] = lines[i].replace(
        /(dear devotees)[.,]?\s*(our glorious Śrīla Prabhupāda)?/i,
        "dear devotees. All glories to Śrīla Prabhupāda."
      );
      return { text: lines.join("\n"), fixed: true };
    }
  }
  return { text: md, fixed: false };
}

function isVerseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 10) return false;
  if (/[Ѐ-ӿ]/.test(trimmed)) return false;
  const engWords = (trimmed.match(/\b(the|is|of|and|to|that|this|for|with|not|are|was|but|has|had|his|her|can|our|how|who|we|he|she|it|do|if|so|as|by|at|in|on|or|an|no)\b/gi) || []).length;
  const words = trimmed.split(/\s+/).length;
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
    if (!isVerseLine(lines[i])) { i++; continue; }

    const verseStart = i;
    const verseLines = [];
    while (i < lines.length && isVerseLine(lines[i])) {
      verseLines.push(lines[i].trim());
      i++;
    }
    if (verseLines.length === 0) continue;

    const garbled = verseLines.join(" ");

    // General corpus match first (full 26k+ entries)
    const q = ngrams(garbled);
    let best = null;
    for (const c of CORPUS_NGRAMS) {
      const s = jaccard(q, c.grams);
      if (s > (best?.score ?? 0)) best = { score: s, entry: c.entry, key: c.key };
    }

    if (best && best.score >= 0.85) { skipped++; continue; }

    // Containment check (correct excerpt, not garbled)
    if (best && best.score >= 0.40) {
      const canonGrams = best.entry.text ? ngrams(best.entry.text) : new Set();
      let contained = 0;
      for (const g of q) if (canonGrams.has(g)) contained++;
      const containment = q.size > 0 ? contained / q.size : 0;
      if (containment >= 0.90) { skipped++; continue; }
    }

    // Decide: general match wins if score ≥ 0.40, else try prayer fallback
    let matchEntry = null;
    let matchRef = null;
    let matchMethod = null;

    if (best && best.score >= 0.40) {
      matchEntry = best.entry;
      matchRef = best.entry.reference ? displayReference(best.entry.reference) : best.key;
      matchMethod = `score ${best.score.toFixed(2)}`;
    } else {
      // Prayer fallback: bypasses the 0.40 threshold for the 6 known prayers.
      // Safe because the candidate pool is tiny and every lecture opens with one.
      const prayerKey = looksLikeMangalacarana(garbled);
      if (prayerKey && CORPUS[prayerKey]) {
        matchEntry = CORPUS[prayerKey];
        matchRef = matchEntry.reference ? displayReference(matchEntry.reference) : prayerKey;
        matchMethod = "prayer match";
      }
    }

    if (!matchEntry) continue;

    let spliceStart = verseStart;
    if (verseStart > 0 && /\[unverified citation\]/i.test(lines[verseStart - 1])) {
      spliceStart = verseStart - 1;
    }

    const canonical = matchEntry.text.split(/\r?\n/);
    if (matchRef) canonical.push(`(${matchRef})`);

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
