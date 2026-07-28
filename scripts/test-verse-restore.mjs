#!/usr/bin/env node
/**
 * Regression test for verse-restore prayer matcher + general restore.
 *
 * Fixtures are REAL Whisper garbles from the Hungary BB lectures.
 * Tests both looksLikeMangalacarana() in isolation and restoreVerses()
 * end-to-end on synthetic markdown.
 *
 *   node scripts/test-verse-restore.mjs
 */
import {
  looksLikeMangalacarana,
  restoreVerses,
  extractReferences,
} from "../src/lib/pipeline/verse-restore.mjs";

let pass = 0;
let fail = 0;

function assert(label, got, want) {
  const ok = got === want;
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}  want=${String(want)}  got=${String(got)}`);
  }
}

// ---- Part 1: looksLikeMangalacarana in isolation ----
console.log("\n=== looksLikeMangalacarana ===\n");

const prayerCases = [
  // Positives — garbled prayers should match their corpus key
  ["jñāna-timarāṇḍasya vinajana-salaḥkaya cakṣo unmerita", "Jñāna-cakṣur-praṇāma"],
  ["ājñāna-timurāṅtasya gṛṇāṁ jana-salakāya cakṣu'oṁ min", "Jñāna-cakṣur-praṇāma"],
  ["nirtaṁ jena-tasmāi śī-gurubhe namaḥ mukāṃ karoti-vācalam", "Guru-praṇāma"],
  ["tasmaiṣi guruve namah mukham karoti vācalam bhāṅgum", "Guru-praṇāma"],
  ["Vishnu Vidhāya Kṛṣṇa Prasthāya Bhūtal", "Prabhupāda-praṇāma"],
  ["Mathe Bhaktivedanta Svāmī Nithināmane Namaste Sarasv", "Prabhupāda-praṇāma"],
  ["Hare Krishna Hare Krishna Krishna Krishna Hare Hare", "Mahā-mantra"],
  // Negatives — scripture verses must NOT match a prayer
  ["Āta-brahmāndam ātge svīn tājvīn nekṣe kṛpā spadam", null],
  ["viṣāmbhas tad upaspṛśya daivopahata-cetasaḥ nipetur vyasavaḥ sarve", null],
  ["nārāya nākparākṣave nākputas cañyabhībiti sva-gapāvāgandhārakṣa", null],
  ["Gurum Pranam Yatam Gantum Kailāsaṃgīraṃ gud-sukha", null],
  // BB 92 partial — looksLikeMangalacarana DOES weakly match (0.1574) due to shared
  // trigrams (guruṁ, girim). Defense is in the wiring: prayer is fallback only when
  // general score < 0.40. BB 92 general score = 0.46 → takes general path. See e2e test.
  ["*śrī-parīkṣid uvāca guruṁ praṇamya yantaṁ gantuṁ kailāsaṁ giri-vāraṇam", "Guru-praṇāma"],
  ["short garble", null],
];

for (const [garble, want] of prayerCases) {
  const got = looksLikeMangalacarana(garble);
  assert(`prayer(${garble.slice(0, 45)}…)`, got, want);
}

// ---- Part 2: restoreVerses end-to-end ----
console.log("\n=== restoreVerses end-to-end ===\n");

// Build synthetic markdown with garbled prayers on separate lines
// (simulates post-cleanup output where Sonnet split but didn't fix them)
const testMd = `Hare Kṛṣṇa. Good morning, dear devotees. All glories to Śrīla Prabhupāda.

We're reading from Bṛhad-bhāgavatāmṛta today.

jñāna-timarāṇḍasya vinajana-salaḥkaya cakṣo unmerita
tasmāi śī-gurave namaḥ

nirtaṁ jena-tasmāi śī-gurubhe namaḥ mukāṃ karoti-vācalam
hāṅgum naṅgāya te gariṁ yāt-kṛpātā-mahā-mande

Mathe Bhaktivedanta Svāmī Nithināmane Namaste Sarasv
śrīmat-bhakti-vidhānta-svāmīti te nāmane

So as I said there is a lot in this verse and commentary.

nārāya nākparākṣave nākputas cañyabhībiti
sva-gapāvāgandhārakṣa-tuttulāpitāśana

The devotees do not fear any condition of life.
`;

const { text: restored, stats } = restoreVerses(testMd);

// Prayers should be restored (canonical text present in output)
assert("Jñāna-cakṣur restored", restored.includes("ajñāna-timirāndhasya"), true);
assert("Guru-praṇāma restored", restored.includes("mūkaṁ karoti vācālaṁ"), true);
assert("Prabhupāda-praṇāma restored", restored.includes("viṣṇu-pādāya"), true);

// Reference labels should appear
assert("Jñāna ref label", restored.includes("(Jñāna-cakṣur-praṇāma)"), true);
assert("Guru ref label", /\(Guru-praṇāma/.test(restored), true);
assert("Prabhupāda ref label", restored.includes("(Prabhupāda-praṇāma)"), true);

// SB verse garble should NOT be restored (score ~0.27, below 0.40 threshold)
assert("SB garble NOT restored", restored.includes("nārāya nākparākṣave"), true);

// BB 92 partial lines — should be restored via general match, NOT prayer match
const bb92Md = `Some introductory text here.

*śrī-parīkṣid uvāca
guruṁ praṇamya yantaṁ gantuṁ
kailāsaṁ giri-vāraṇam

More lecture text after the verse.
`;
const bb92Result = restoreVerses(bb92Md);
assert("BB92 NOT prayer-restore", !bb92Result.text.includes("(Guru-praṇāma)"), true);
assert("BB92 general restore fires", bb92Result.stats.substituted >= 1, true);

// Stats
assert("substituted >= 3", stats.substituted >= 3, true);

// ---- Summary ----
// ---- Śikṣāṣṭaka aliases + named-work tie-break (2026-07-28) ----------------
// Eight verses added as aliases of CC Antya-līlā 20.x (same text). Ties are
// exact, so without the NAMED_WORK preference the label would read
// "CC Antya-līlā 20.21" instead of "Śikṣāṣṭaka 3".
{
  const cases = [
    ["Śikṣāṣṭaka label wins tie",
     "English lead.\n\ntṛṇādapi sunīcena tarur iva sahiṣṇunam amānina mānadeya kīrtanīyaṁ sadā hariḥ\n\nAfter.",
     (r) => r.stats.identified_verses.some((v) => v.reference === "Śikṣāṣṭaka 3")],
    ["genuine CC verse keeps its CC label",
     "English lead.\n\nkṛṣṇa-varṇaṁ tviṣā kṛṣṇaṁ sāṅgopāṅgāstra-pārṣadaṁ yajñaiḥ saṅkīrtana-prāyair yajanti hi su-medhasaḥ\n\nAfter.",
     (r) => !r.stats.identified_verses.some((v) => /^Śikṣāṣṭaka/.test(v.reference))],
    ["spoken 'Śikṣāṣṭaka 3' is extracted",
     "Maharaja said, in Śikṣāṣṭaka 3, Mahāprabhu teaches humility.",
     () => extractReferences("in Śikṣāṣṭaka 3, Mahāprabhu").includes("Śikṣāṣṭaka 3")],
    ["spoken 'Siksastaka verse 8' variant",
     "x",
     () => extractReferences("Siksastaka verse 8 says").includes("Śikṣāṣṭaka 8")],
    ["'Shikshashtakam 1' variant",
     "x",
     () => extractReferences("Shikshashtakam 1 begins").includes("Śikṣāṣṭaka 1")],
    ["no false Śikṣāṣṭaka ref from prose",
     "x",
     () => extractReferences("he spoke about the eight verses").length === 0],
  ];
  for (const [name, md, assert] of cases) {
    let ok = false;
    try { ok = assert(restoreVerses(md)); } catch (e) { ok = false; }
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (ok) pass++; else fail++;
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
