/**
 * Unit test for the fuzzy maṅgalācaraṇa matcher in restore.ts (2026-07-28).
 *
 * Garbles below are REAL Whisper output lifted from the Hungary / YouTube
 * lectures — the ones the exact-substring probes missed and the 0.35 Jaccard
 * threshold refused. Negative cases assert a genuine scripture verse (and the
 * BB verse that sits near the prayers in n-gram space) does NOT match a prayer.
 *
 *   node test-pranama-fuzzy.mjs
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const src = fs.readFileSync("src/lib/pipeline/verse-restore.mjs", "utf-8");
const i = src.indexOf("function looksLikeMangalacarana");
const j = src.indexOf("return null;\n}", i) + "return null;\n}".length;
fs.writeFileSync(
  "/tmp/fn.ts",
  "declare const CORPUS: any;\n" +
  "interface CorpusEntry { reference: string; text: string; translation?: string; source?: string; }\n" +
  "export " + src.slice(i, j)
);
execFileSync("npx", ["tsc", "/tmp/fn.ts", "--target", "es2020", "--module", "es2020",
                     "--outDir", "/tmp/fnout", "--skipLibCheck"], { stdio: "inherit" });

const js = fs.readFileSync("/tmp/fnout/fn.js", "utf-8").replace(/^export /m, "");
const corpus = JSON.parse(fs.readFileSync("corpus.json", "utf-8"));
const match = new Function("CORPUS", js + "\nreturn looksLikeMangalacarana;")(corpus);

const cases = [
  ["jñāna-timarāṇḍasya vinajana-salaḥkaya cakṣo unmerita", "Jñāna-cakṣur-praṇāma"],
  ["ājñāna-timurāṅtasya gṛṇāṁ jana-salakāya cakṣu'oṁ min", "Jñāna-cakṣur-praṇāma"],
  ["nirtaṁ jena-tasmāi śī-gurubhe namaḥ mukāṃ karoti-vācalam", "Guru-praṇāma"],
  ["tasmaiṣi guruve namah mukham karoti vācalam bhāṅgum", "Guru-praṇāma"],
  ["Vishnu Vidhāya Kṛṣṇa Prasthāya Bhūtal", "Prabhupāda-praṇāma"],
  ["Mathe Bhaktivedanta Svāmī Nithināmane Namaste Sarasv", "Prabhupāda-praṇāma"],
  ["Hare Krishna Hare Krishna Krishna Krishna Hare Hare", "Mahā-mantra"],
  // negatives — must stay null
  ["Āta-brahmāndam ātge svīn tājvīn nekṣe kṛpā spadam", null],
  ["viṣāmbhas tad upaspṛśya daivopahata-cetasaḥ nipetur vyasavaḥ sarve", null],
  ["short garble", null],
];

let pass = 0;
for (const [garble, want] of cases) {
  const got = match(garble);
  const ok = got === want;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  want=${String(want).padEnd(22)} got=${String(got).padEnd(22)} :: ${garble.slice(0, 40)}`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
