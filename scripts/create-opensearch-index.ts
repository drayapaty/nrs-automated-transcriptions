/**
 * One-time (idempotent) creation of the OpenSearch index that mirrors the
 * DynamoDB `nrs-lectures-auto-transcribe` table.
 *
 * Doc shape:  one document per (lecture_id, lang).
 * Doc _id:    `{lecture_id}_{lang}` — deterministic upsert.
 *
 * Usage:
 *   npx tsx scripts/create-opensearch-index.ts
 *   npx tsx scripts/create-opensearch-index.ts --force   # delete & recreate (DESTRUCTIVE)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

const INDEX =
  process.env.OPENSEARCH_INDEX_LECTURES || "nrs-lectures-auto-transcribe";
const URL = (process.env.OPENSEARCH_URL || "").replace(/\/$/, "");
const USER = process.env.OPENSEARCH_USER || "admin";
const PASS = process.env.OPENSEARCH_PASS || "";

if (!URL || !PASS) {
  console.error("OPENSEARCH_URL / OPENSEARCH_PASS not set");
  process.exit(1);
}

// Self-signed cert on Hetzner cluster
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
const force = process.argv.includes("--force");

const MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1,
  },
  mappings: {
    properties: {
      // Keys (mirror DynamoDB PK + SK)
      lecture_id: { type: "keyword" },
      lang:       { type: "keyword" },

      // Full transcript (multilingual — standard analyzer handles EN/RU/UK reasonably)
      text:  { type: "text", analyzer: "standard" },
      chars: { type: "integer" },
      words: { type: "integer" },

      // Lecture-level metadata
      title:       { type: "text", analyzer: "english" },
      date:        { type: "date" },
      year:        { type: "integer" },
      duration:    { type: "keyword" },
      location:    { type: "keyword" },
      source_type: { type: "keyword" },

      // Canonical enrichment (optional, passed in by admin)
      topic_en:          { type: "keyword" },
      topic_ru:          { type: "keyword" },
      location_en:       { type: "keyword" },
      location_ru:       { type: "keyword" },
      event_en:          { type: "keyword" },
      event_ru:          { type: "keyword" },
      scripture_part:    { type: "keyword" },
      scripture_chapter: { type: "keyword" },
      scripture_verse:   { type: "keyword" },

      // Engagement stats (from backend API)
      play_count:      { type: "integer" },
      download_count:  { type: "integer" },
      page_view_count: { type: "integer" },

      // Pipeline provenance
      transcription_provider: { type: "keyword" },
      cleanup_model:          { type: "keyword" },
      translation_model:      { type: "keyword" },
      source_job_id:          { type: "keyword" },
      created_at:             { type: "date" },
      updated_at:             { type: "date" },
    },
  },
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

async function exists(): Promise<boolean> {
  const r = await api("HEAD", `/${INDEX}`);
  return r.status === 200;
}

async function main() {
  console.log(`Cluster: ${URL}`);
  console.log(`Index:   ${INDEX}\n`);

  const already = await exists();
  if (already && force) {
    console.log(`--force specified. Deleting existing index...`);
    const del = await api("DELETE", `/${INDEX}`);
    if (del.status !== 200) {
      console.error(`Delete failed (${del.status}): ${del.body}`);
      process.exit(1);
    }
    console.log(`✓ Deleted.\n`);
  } else if (already) {
    console.log(`✓ Index already exists — nothing to do. (Use --force to recreate.)`);
    return;
  }

  console.log(`Creating index with mapping...`);
  const create = await api("PUT", `/${INDEX}`, MAPPING);
  if (create.status !== 200 && create.status !== 201) {
    console.error(`Create failed (${create.status}): ${create.body}`);
    process.exit(1);
  }
  console.log(`✓ Index ${INDEX} created.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
