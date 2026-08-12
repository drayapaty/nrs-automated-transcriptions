#!/usr/bin/env node
/**
 * Adds all Bṛhad-bhāgavatāmṛta Vol.1 verse anchors (2320, from
 * Gopīparāṇadhana Dāsa's published translation) into corpus-seeds.json,
 * so verse-restore.mjs can tag canonical BB references during
 * transcription instead of only the ~493 BB entries corpus.json
 * currently has (an old, much sparser set — source unclear, not this
 * file). Per corpus-seeds.json's own documented convention: "Merged into
 * corpus at load time — these entries always win over auto-generated
 * ones. Add new entries here; never hand-edit corpus.json."
 *
 * Same reference/source format as the existing BB entries already in
 * corpus.json ("BB {part}.{chapter}.{verse}", source string matching
 * "Bṛhad-bhāgavatāmṛta by Śrīla Sanātana Gosvāmī, Volume 1, Chapter N,
 * Text M") — kept identical so nothing downstream has to special-case
 * seeds-vs-corpus BB entries.
 *
 * Usage: node scripts/update-corpus-seeds-bb.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOL1_PATH = join(
  process.env.HOME,
  "Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md"
);
const SEEDS_PATH = join(__dirname, "..", "corpus-seeds.json");

function buildVol1Entries() {
  const text = readFileSync(VOL1_PATH, "utf-8");
  const lines = text.split("\n");
  const entries = {};

  let currentPart = null;
  let currentChapter = null;
  let currentVStart = null;
  let currentVEnd = null;
  let verseLines = [];

  const flush = () => {
    if (currentPart && verseLines.length) {
      const ref = currentVEnd
        ? `BB ${currentPart}.${currentChapter}.${currentVStart}-${currentVEnd}`
        : `BB ${currentPart}.${currentChapter}.${currentVStart}`;
      const verseText = verseLines.join("\n");
      if (verseText.length >= 15) {
        entries[ref] = {
          reference: ref,
          text: verseText,
          source: `Bṛhad-bhāgavatāmṛta by Śrīla Sanātana Gosvāmī, Volume 1, Chapter ${currentChapter}, Text ${currentVStart}${
            currentVEnd ? `-${currentVEnd}` : ""
          }`,
        };
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
      [, currentPart, currentChapter, currentVStart, currentVEnd] = h;
      continue;
    }
    const v = verseLineRe.exec(line.trim());
    if (v && currentPart) {
      verseLines.push(v[1]);
    }
  }
  flush();

  return entries;
}

function main() {
  const seeds = JSON.parse(readFileSync(SEEDS_PATH, "utf-8"));
  const existingKeys = Object.keys(seeds).filter((k) => k !== "_meta");
  const existingBBKeys = existingKeys.filter((k) => k.startsWith("BB "));

  console.log(`corpus-seeds.json: ${existingKeys.length} entries before (${existingBBKeys.length} already BB)`);

  const vol1Entries = buildVol1Entries();
  const newKeys = Object.keys(vol1Entries);
  console.log(`Vol.1 source: ${newKeys.length} verse anchors extracted`);

  let added = 0;
  let updated = 0;
  for (const [ref, entry] of Object.entries(vol1Entries)) {
    if (seeds[ref]) {
      updated++;
    } else {
      added++;
    }
    seeds[ref] = entry;
  }

  writeFileSync(SEEDS_PATH, JSON.stringify(seeds, null, 2), "utf-8");

  const finalKeys = Object.keys(seeds).filter((k) => k !== "_meta");
  console.log(`\nDone. ${added} new BB entries added, ${updated} existing BB entries updated/overwritten.`);
  console.log(`corpus-seeds.json: ${finalKeys.length} entries after.`);
}

main();
