# nrs-automated-transcriptions

Vercel-hosted internal API service that takes a presigned S3 URL of a lecture
audio file and runs the full pipeline:

```
download → Deepgram Nova-3 → Claude cleanup + paragraphing
       → (optional) RU/UK translation
       → (optional) chunk + embed + index to OpenSearch
       → persist transcripts to DynamoDB
```

Consumed by the niranjanaswami.net admin page. Operates independently from
the existing `ask-niranjana-swami` RAG app — separate Vercel project,
separate env vars, separate deployment. Reuses the same AWS account,
Anthropic key, Deepgram keys, and OpenSearch cluster.

---

## Architecture

```
Admin Page                 Vercel: nrs-automated-transcriptions     External
    │                              │                                       │
    │  POST /api/jobs              │                                       │
    │  { s3_url, metadata,         │                                       │
    │    translate?, index? }      │                                       │
    ├─────────────────────────────►│ insert row in nrs-transcribe-jobs     │
    │  ◄─── { job_id }             │ kick off background via waitUntil()   │
    │                              │                                       │
    │                              │ background pipeline:                  │
    │                              │  1. fetch audio  ───────────────────► S3
    │                              │  2. Deepgram Nova-3  ───────────────► Deepgram
    │                              │  3. Claude cleanup  ────────────────► Anthropic
    │                              │  4. write EN to nrs-lectures-...     ─► DynamoDB
    │                              │  5. translate RU/UK (if asked)  ────► Anthropic
    │                              │  6. write RU/UK to nrs-lectures-... ─► DynamoDB
    │                              │  7. upsert whole-transcript docs    ─► OpenSearch nrs-lectures-auto-transcribe
    │                              │     (one doc per lecture_id+lang)     │
    │                              │  8. chunk EN + embed + index (if asked) ► OpenAI / OpenSearch ask-nrs-lectures
    │                              │  9. mark job done; fire callback_url  │
    │                              │                                       │
    │  GET /api/jobs/:id           │                                       │
    ├─────────────────────────────►│  read job row from DynamoDB           │
    │  ◄─── { status, result }     │                                       │
```

**Why async (job-based) instead of synchronous:**
- A 60-min lecture takes ~2–3 min for transcribe + cleanup; with both
  translations adds another ~3–5 min. Total: 5–8 min.
- Vercel Pro hard limits: 5 min sync default, 13 min with Fluid Compute.
- Async lets the admin show progress, survives browser refresh, and is retry-safe.

---

## API reference

All endpoints (except `/api/health`) require:

```
Authorization: Bearer <ADMIN_BEARER_TOKEN>
```

### Jobs (transcription pipeline)

#### `POST /api/jobs` — create a job
Returns `202` with `{ job_id, status: "queued", poll_url }`.

```jsonc
{
  "s3_url": "https://niranjanaswami.s3.eu-central-1.amazonaws.com/...?X-Amz-Signature=...",
  "metadata": {
    "uuid": "f3d2a8e1-1234-...",        // required if you want persistence/indexing
    "title": "2026-04-12 — Vilnius — Bhakti is for everyone",
    "date":  "2026-04-12",
    "year":  2026,
    "duration": "01:12:33",
    "location": "Vilnius, Lithuania",
    "source_type": "lecture"
  },
  "translate": ["ru", "uk"],            // optional
  "index": true,                        // optional — index to OpenSearch
  "paragraph": true,                    // optional, default true
  "callback_url": "https://...",        // optional — POST result here when done
  "provider": "auto"                    // optional — "auto" | "deepgram" | "groq"
}
```

#### `GET /api/jobs/:id` — poll status
```jsonc
{
  "job_id": "...",
  "status": "translating",
  "progress": { "stage": "translating", "pct": 65, "message": "→ uk" },
  "result": null,                       // present once status === "done"
  "created_at": "...", "updated_at": "..."
}
```

When `status === "done"`:
```jsonc
{
  "job_id": "...",
  "status": "done",
  "result": {
    "transcript_en": "...",
    "translations": { "ru": "...", "uk": "..." },
    "metadata": {
      "duration_s": 4380,
      "words": 9342,
      "chars": 56_120,
      "deepgram_request_id": "...",
      "transcription_provider": "deepgram",
      "cleanup_model": "claude-sonnet-4-5",
      "translation_model": "claude-sonnet-4-5",
      "indexed_chunks": 11
    }
  }
}
```

#### `POST /api/jobs/:id/translate` — add translations to a completed job
```jsonc
{ "langs": ["ru", "uk"], "sync": false }
```
- `sync: true` → response includes the translations directly (5–10 min for both langs).
- `sync: false` (default) → returns `202` immediately; poll the job for updates.

#### `POST /api/jobs/:id/index` — index a completed job into OpenSearch
```jsonc
{ "metadata": { /* optional override */ } }
```
Returns `202`; poll job for `indexed_chunks`.

---

### Lectures (transcript storage — `nrs-lectures-auto-transcribe`)

The pipeline writes English/RU/UK transcripts here automatically when
`metadata.uuid` is provided. These endpoints let the admin page read them
back, manually upload corrections, or list available languages per lecture.

Table schema:
- **PK** `lecture_id` (S) — UUID of the lecture
- **SK** `lang` (S) — `"en"`, `"ru"`, `"uk"`, or any future ISO 639-1 code

#### `GET /api/lectures/:id` — list all language entries for a lecture
```
GET /api/lectures/abc-123
GET /api/lectures/abc-123?include_text=true
```
Response (lightweight):
```jsonc
{
  "lecture_id": "abc-123",
  "languages": [
    { "lang": "en", "chars": 56120, "words": 9342, "metadata": {...},
      "created_at": "...", "updated_at": "...", "source_job_id": "..." },
    { "lang": "ru", "chars": 71400, "words": 8821, ... },
    { "lang": "uk", "chars": 73210, "words": 8945, ... }
  ]
}
```

#### `GET /api/lectures/:id/:lang` — fetch one transcript
```
GET /api/lectures/abc-123/en
```
Returns the row including full `text`. `404` if not found.

#### `POST /api/lectures/:id/:lang` — manual upsert (replaces existing row)
```jsonc
{
  "text": "...",
  "metadata": { "title": "...", "date": "...", ... },
  "source_job_id": "optional"
}
```
Use for manual corrections / hand-edited transcripts that should bypass
the pipeline. Returns `201` with the stored row.

#### `DELETE /api/lectures/:id/:lang` — remove a transcript

---

### Health
#### `GET /api/health` — public, no auth
Reports which env vars are configured (boolean only — no values leaked).

---

## Cost per lecture

Assuming a typical 60-min lecture (~9k English words):

| Stage | Cost |
|---|---|
| Deepgram Nova-3 transcription | $0.00 (drawing from existing prepaid credits) |
| Claude Sonnet 4 cleanup + paragraphing | ~$0.04 |
| Vercel function compute (~3 min Fluid) | ~$0.01–0.02 |
| DynamoDB writes (jobs + lectures) | <$0.001 |
| **Subtotal: transcribe only** | **~$0.05** |
| Russian translation (when requested) | ~$0.24 |
| Ukrainian translation (when requested) | ~$0.26 |
| OpenSearch indexing (chunk + embed + write) | ~$0.01 |
| **Subtotal: transcribe + RU + UK + index** | **~$0.56** |

At expected admin volume (~5–10 lectures/week):
- Transcribe only: **$1–2/month**
- Full pipeline (RU + UK + index): **$11–22/month**
- Vercel platform fee: **$0 incremental** (Pro tier already paid for `ask-niranjana-swami`)

---

## Setup

### 1. Local install
```bash
npm install
```

### 2. Configure env vars
```bash
cp .env.example .env.local
# Fill in all keys — see comments inside .env.example
```

The Anthropic / Deepgram / Groq / OpenAI / OpenSearch / DynamoDB credentials
are the same ones used by `ask-niranjana-swami`. `ADMIN_BEARER_TOKEN` is new
to this service:
```bash
openssl rand -hex 32
```

### 3. Create DynamoDB tables + OpenSearch index (one-time)
```bash
npm run create-tables
npm run create-opensearch-index
```
Creates:
- DynamoDB `nrs-transcribe-jobs` (PK `job_id`, TTL on `ttl` for 30-day expiry)
- DynamoDB `nrs-lectures-auto-transcribe` (PK `lecture_id`, SK `lang`)
- OpenSearch `nrs-lectures-auto-transcribe` (mirrors the DynamoDB table, one
  doc per `(lecture_id, lang)` pair, doc _id `{lecture_id}_{lang}`)

### 4. Local dev
```bash
npm run dev
# → http://localhost:3000
```

Smoke test:
```bash
curl http://localhost:3000/api/health
```

### 5. Deploy to Vercel
```bash
# First-time: link project
npx vercel link

# Add env vars to Vercel (or via dashboard)
npx vercel env add ANTHROPIC_API_KEY production
# ... etc for every var in .env.example

# Deploy
npx vercel --prod
```

`vercel.json` already configures function timeouts:
- `/api/jobs` (POST) and `/api/jobs/:id/translate` (POST) → 800 s, 3 GB memory (Fluid Compute)
- `/api/jobs/:id/index` → 300 s, 1 GB
- `/api/jobs/:id` (GET) and `/api/health` → short, low memory

---

## Integration: admin page

Typical admin flow:

```ts
// 1. Admin generates presigned URL on their server (or via an existing API).
const presignedUrl = await s3.getSignedUrl("getObject", { Bucket, Key, Expires: 3600 });

// 2. Submit job
const { job_id } = await fetch("https://nrs-automated-transcriptions.vercel.app/api/jobs", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.NRS_ADMIN_TOKEN}`,
  },
  body: JSON.stringify({
    s3_url: presignedUrl,
    metadata: { uuid: lecture.uuid, title: lecture.title, date: lecture.date, ... },
    translate: ["ru", "uk"],
    index: true,
  }),
}).then(r => r.json());

// 3. Poll until done
while (true) {
  await new Promise(r => setTimeout(r, 5000));
  const job = await fetch(`https://.../api/jobs/${job_id}`, { headers: ... }).then(r => r.json());
  setProgress(job.progress);
  if (job.status === "done") { showResult(job.result); break; }
  if (job.status === "failed") { showError(job.error); break; }
}

// 4. Or fetch a transcript later, by lecture+lang
const en = await fetch(`https://.../api/lectures/${uuid}/en`, { headers: ... }).then(r => r.json());
```

Or use `callback_url` to skip polling — service POSTs the final job to your URL.

---

## OpenSearch indexes

This service writes to two distinct OpenSearch indexes:

| Index | Shape | Content | Written when |
|---|---|---|---|
| `nrs-lectures-auto-transcribe` | one doc per `(lecture_id, lang)` | full transcript in every language (EN + RU + UK + any future lang) | always, when `metadata.uuid` is set and `index: true` |
| `ask-nrs-lectures` | chunked (~800 tokens/chunk), embedded | **English only** — feeds the RAG pipeline in ask-niranjana-swami | when `index: true` |

Doc IDs are deterministic so re-runs are idempotent:
- `nrs-lectures-auto-transcribe`: `{lecture_id}_{lang}`
- `ask-nrs-lectures`: `{uuid}_chunk_{index}`

---

## What this service does NOT touch

- `ask-niranjana-swami` repo — zero changes
- Existing DynamoDB tables (`ask-ns-conversations`, `ask-ns-messages`, etc.)
- Existing OpenSearch documents (only adds new docs to `ask-nrs-lectures`,
  using deterministic IDs `{uuid}_chunk_{n}` so re-runs are idempotent)
- Existing Vercel deployment (this is a separate Vercel project)
- Source S3 bucket (read-only via presigned URLs; never writes back)

---

## Files

```
src/
├── app/
│   ├── api/
│   │   ├── health/route.ts                       # GET (public)
│   │   ├── jobs/
│   │   │   ├── route.ts                          # POST — create job
│   │   │   └── [id]/
│   │   │       ├── route.ts                      # GET — poll
│   │   │       ├── translate/route.ts            # POST — add translations
│   │   │       └── index/route.ts                # POST — index to OpenSearch
│   │   └── lectures/
│   │       ├── [id]/
│   │       │   ├── route.ts                      # GET — list languages
│   │       │   └── [lang]/route.ts               # GET / POST / DELETE
│   ├── layout.tsx, page.tsx                      # minimal shell
├── lib/
│   ├── auth.ts                                   # bearer-token check
│   ├── clients.ts                                # anthropic / openai / groq / dynamo / etc.
│   ├── jobs.ts                                   # job-state DynamoDB ops
│   ├── lectures.ts                               # transcript-storage DynamoDB ops
│   ├── orchestrator.ts                           # full-pipeline runner
│   ├── types.ts                                  # shared types
│   └── pipeline/
│       ├── download.ts                           # presigned URL → Buffer
│       ├── transcribe.ts                         # Deepgram + Groq fallback
│       ├── cleanup.ts                            # Claude Sanskrit + paragraph cleanup
│       ├── translate.ts                          # Claude RU / UK translation
│       ├── chunk.ts                              # paragraph-aware chunker (~800 tok)
│       ├── embed.ts                              # OpenAI text-embedding-3-small
│       └── index-opensearch.ts                   # bulk-index to ask-nrs-lectures
scripts/
└── create-tables.ts                              # DynamoDB setup (one-time)
```
