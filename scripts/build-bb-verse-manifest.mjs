#!/usr/bin/env node
/**
 * Manifest of which BB verses were formally read (i.e. the Sanskrit was
 * quoted and verse-restore tagged it canonically) in each of the 35
 * signed-off lectures. Deterministic — no LLM call, just extracts the
 * "(BB ...)" tags verse-restore.mjs already inserted into each
 * *_restored.md.
 *
 * Scope, per Divakar's explicit call: "verses formally read from BB" —
 * this does NOT catch verses he references from memory without
 * re-quoting the Sanskrit (see the topical-lecture verse-matching work,
 * 2026-08-12 — some lectures discuss a verse without restating it).
 *
 * Fixes a real corpus quality issue found while building this: some tags
 * come out malformed short-form ("(BB 77)" instead of "(BB 1.2.77)"),
 * traced to stale chapter-only entries ("BB 1".."BB 9") that predate this
 * session's corpus-seeds.json update and are still in the older
 * corpus.json — those can still win a given n-gram match. For the 19
 * lectures with a filename-derived verse range, the correct part/chapter
 * is inferable from context and used to repair the tag. For the 16
 * topical lectures (no filename range), any bare short-form tag is left
 * as-is and flagged, since there's no safe way to infer the chapter.
 *
 * Usage: node scripts/build-bb-verse-manifest.mjs
 * Output: scripts/bb-verse-manifest.json
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BB_DIR = "/Users/divakar/Downloads/bb-book-chapters-2026-08-05";

const TAG_RE = /\(BB (\d+(?:\.\d+){0,2})\)/g;

function parseFilenameRange(slug) {
  const m = /bb_(\d+)_(\d+)_(\d+)(?:_(\d+))?/.exec(slug);
  if (!m) return null;
  const [, part, chapter, vStart, vEnd] = m;
  return { part, chapter, vStart: Number(vStart), vEnd: vEnd ? Number(vEnd) : Number(vStart) };
}

function normalizeTag(raw, fallback) {
  const parts = raw.split(".");
  if (parts.length === 3) return { ref: `BB ${raw}`, ambiguous: false };
  if (parts.length === 1 && fallback) {
    return { ref: `BB ${fallback.part}.${fallback.chapter}.${parts[0]}`, ambiguous: false };
  }
  if (parts.length === 2 && fallback) {
    // "chapter.verse" with no part — rare, but handle it
    return { ref: `BB ${fallback.part}.${raw}`, ambiguous: false };
  }
  return { ref: `BB ${raw}`, ambiguous: true };
}

function main() {
  const slugs = readdirSync(BB_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const manifest = [];

  for (const slug of slugs) {
    const restoredPath = join(BB_DIR, slug, `${slug}_restored.md`);
    let text;
    try {
      text = readFileSync(restoredPath, "utf-8");
    } catch {
      continue;
    }

    const fallback = parseFilenameRange(slug);
    const seen = new Map(); // normalized ref -> ambiguous flag
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) {
      const { ref, ambiguous } = normalizeTag(m[1], fallback);
      if (!seen.has(ref)) seen.set(ref, ambiguous);
    }

    const verses = [...seen.entries()].map(([ref, ambiguous]) => (ambiguous ? { ref, ambiguous: true } : ref));

    manifest.push({
      slug,
      filenameRange: fallback ? `BB ${fallback.part}.${fallback.chapter}.${fallback.vStart}-${fallback.vEnd}` : null,
      versesRead: verses,
    });

    const ambiguousCount = [...seen.values()].filter(Boolean).length;
    console.log(
      `${slug.padEnd(45)} -> ${verses.length} verse(s)${ambiguousCount ? `  (${ambiguousCount} AMBIGUOUS, unresolved)` : ""}`
    );
  }

  const outPath = join(__dirname, "bb-verse-manifest.json");
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  const total = manifest.reduce((s, m) => s + m.versesRead.length, 0);
  const withVerses = manifest.filter((m) => m.versesRead.length > 0).length;
  console.log(`\n${total} verse-citations across ${withVerses}/${manifest.length} lectures`);
  console.log(`-> ${outPath}`);
}

main();
