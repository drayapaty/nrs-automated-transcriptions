/**
 * One-time backfill: load the ~2,586 historical English transcripts from
 * ask-niranjana-swami's on-disk `content/transcripts/` directory into the
 * OpenSearch `nrs-lectures-auto-transcribe` index.
 *
 * Why: enables the "Read full lecture" drawer in Ask NRS for lectures that
 * were transcribed before the new Vercel service came online. New lectures
 * going through the service already write here automatically — this fills
 * the gap for historical data.
 *
 * Source:  ../ask-niranjana-swami/content/transcripts/{uuid}.txt + {uuid}.json
 * Target:  OpenSearch index `nrs-lectures-auto-transcribe`, doc _id `{uuid}_en`
 *
 * Safe to re-run (idempotent — uses PUT _doc with deterministic ID).
 *
 * Usage:
 *   npx tsx scripts/backfill-historical-transcripts.ts
 *   npx tsx scripts/backfill-historical-transcripts.ts --limit 10    # test with 10
 *   npx tsx scripts/backfill-historical-transcripts.ts --year 2025   # only 2025
 *   npx tsx scripts/backfill-historical-transcripts.ts --uuid a,b,c  # only these UUIDs
 *   npx tsx scripts/backfill-historical-transcripts.ts --dry-run     # just count/preview
 *   npx tsx scripts/backfill-historical-transcripts.ts --concurrency 20
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import fs from "fs";
import path from "path";
import { putLecture } from "../src/lib/lectures";

// ---- Args ----
const args = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    if (key === "dry-run") {
      flags[key] = "true";
    } else {
      flags[key] = args[i + 1] || "";
      i++;
    }
  }
}

const DRY_RUN = flags["dry-run"] === "true";
const LIMIT = flags.limit ? parseInt(flags.limit) : undefined;
const YEAR_FILTER = flags.year;
const CONCURRENCY = parseInt(flags.concurrency || "10");
// --uuid <a,b,c> — comma-separated allowlist; precedes year/limit.
// Lets batch transcription pipelines surgically backfill just-produced
// lectures instead of re-scanning the whole corpus.
const UUID_ALLOWLIST = flags.uuid
  ? new Set(
      flags.uuid
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
    )
  : null;

// ---- Source dir ----
// Resolve relative to this script's project dir so it works from anywhere
const SOURCE_DIR = path.resolve(
  __dirname,
  "../../ask-niranjana-swami/content/transcripts"
);

// Persistent skiplist: lectures the corpus owner never wants indexed.
// Authoritative copy lives in ask-niranjana-swami (so both writers share
// the same list). Honored by ask-niranjana-swami's ingest-elasticsearch.ts
// AND this backfill.
const SKIPLIST_PATH = path.resolve(
  __dirname,
  "../../ask-niranjana-swami/scripts/lib/transcript-skiplist.txt"
);
function loadSkipList(): Set<string> {
  const set = new Set<string>();
  if (!fs.existsSync(SKIPLIST_PATH)) return set;
  for (const line of fs.readFileSync(SKIPLIST_PATH, "utf-8").split("\n")) {
    const u = line.split("#")[0].trim();
    if (u) set.add(u);
  }
  return set;
}
const SKIPLIST = loadSkipList();
if (SKIPLIST.size > 0) {
  console.log(`Skiplist: ${SKIPLIST.size} UUIDs will be ignored (${SKIPLIST_PATH})`);
}

interface Meta {
  uuid: string;
  title?: string;
  date?: string; // YYYY-MM-DD
  year?: string | number;
  duration?: string;
  location?: string;
}

interface Entry {
  uuid: string;
  txtPath: string;
  meta: Meta;
}

// ---- Discover entries ----
function discoverEntries(): Entry[] {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Transcript dir not found: ${SOURCE_DIR}`);
  }
  const files = fs.readdirSync(SOURCE_DIR);
  const uuids = new Set<string>();
  for (const f of files) {
    if (f.endsWith(".txt")) uuids.add(f.slice(0, -4));
  }

  const entries: Entry[] = [];
  for (const uuid of uuids) {
    const txtPath = path.join(SOURCE_DIR, `${uuid}.txt`);
    const jsonPath = path.join(SOURCE_DIR, `${uuid}.json`);

    let meta: Meta = { uuid };
    if (fs.existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        const year = parsed.date ? String(parsed.date).substring(0, 4) : undefined;
        meta = {
          uuid,
          title: parsed.title || parsed.en?.title || "",
          date: parsed.date || "",
          year: year ? parseInt(year) : undefined,
          duration: parsed.duration || "",
          location: parsed.location || "",
        };
      } catch {
        /* fall through with minimal meta */
      }
    }

    if (UUID_ALLOWLIST && !UUID_ALLOWLIST.has(uuid)) continue;
    if (SKIPLIST.has(uuid)) continue;
    if (YEAR_FILTER && String(meta.year) !== YEAR_FILTER) continue;
    entries.push({ uuid, txtPath, meta });
  }

  // Sort by date descending so newest lectures land first (nice for spot-checking)
  entries.sort((a, b) => (b.meta.date || "").localeCompare(a.meta.date || ""));

  return LIMIT ? entries.slice(0, LIMIT) : entries;
}

// ---- Worker pool ----
async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      try {
        await fn(items[idx], idx);
      } catch (err) {
        console.error(`[worker] item ${idx} failed: ${(err as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
}

// ---- Main ----
async function main() {
  console.log(`Source:      ${SOURCE_DIR}`);
  console.log(`Target:      OpenSearch index ${process.env.OPENSEARCH_INDEX_LECTURES || "nrs-lectures-auto-transcribe"}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Dry run:     ${DRY_RUN}`);
  console.log(`Year filter: ${YEAR_FILTER || "(none)"}`);
  console.log(`Limit:       ${LIMIT ?? "(none)"}`);
  console.log();

  const entries = discoverEntries();
  console.log(`Discovered ${entries.length} transcripts on disk.\n`);
  if (entries.length === 0) return;

  if (DRY_RUN) {
    console.log("=== DRY RUN — first 5 entries that would be loaded ===");
    for (const e of entries.slice(0, 5)) {
      const sz = fs.statSync(e.txtPath).size;
      console.log(
        `  ${e.uuid}  ${sz.toString().padStart(7)} bytes  ${e.meta.date || "(no date)"}  ${(e.meta.title || "").substring(0, 60)}`
      );
    }
    console.log("\n(re-run without --dry-run to execute)");
    return;
  }

  const startedAt = Date.now();
  let ok = 0;
  let fail = 0;
  let totalBytes = 0;

  await runPool(entries, CONCURRENCY, async (entry, idx) => {
    const text = fs.readFileSync(entry.txtPath, "utf-8");
    if (!text.trim()) {
      console.warn(`[skip] ${entry.uuid} — empty file`);
      fail++;
      return;
    }

    try {
      await putLecture(entry.uuid, "en", text, {
        metadata: {
          title: entry.meta.title,
          date: entry.meta.date,
          year:
            typeof entry.meta.year === "number"
              ? entry.meta.year
              : entry.meta.year
                ? parseInt(String(entry.meta.year))
                : undefined,
          duration: entry.meta.duration,
          location: entry.meta.location,
          source_type: "lecture",
          transcription_provider: "deepgram", // best-effort — historical batch used Deepgram primary
          cleanup_model: "claude-sonnet-4-20250514", // historical model
        },
        source_job_id: "backfill-historical",
      });

      ok++;
      totalBytes += text.length;
      if (ok % 50 === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = ok / Math.max(elapsed, 0.1);
        const remaining = entries.length - idx - 1;
        const eta = Math.round(remaining / Math.max(rate, 0.1));
        console.log(
          `  [${ok}/${entries.length}] ~${rate.toFixed(1)} docs/s  eta ${eta}s`
        );
      }
    } catch (err) {
      fail++;
      console.error(`[fail] ${entry.uuid}: ${(err as Error).message.substring(0, 150)}`);
    }
  });

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log();
  console.log("=== Backfill complete ===");
  console.log(`  ok:         ${ok}`);
  console.log(`  failed:     ${fail}`);
  console.log(`  total MB:   ${(totalBytes / 1024 / 1024).toFixed(1)}`);
  console.log(`  elapsed:    ${elapsed.toFixed(1)}s`);
  console.log(`  throughput: ${(ok / Math.max(elapsed, 0.1)).toFixed(1)} docs/s`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
