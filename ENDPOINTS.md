# API Endpoints — `nrs-automated-transcriptions`

**Production base URL:**
```
https://nrs-automated-transcriptions.vercel.app
```

**Authentication:** All endpoints except `/api/health` require:
```
Authorization: Bearer <ADMIN_BEARER_TOKEN>
```

The token was generated during deploy and is stored locally at
`.vercel/.admin-bearer-token` (gitignored). Paste it into the admin page's
env as `NRS_ADMIN_TOKEN` (or whatever name you prefer) and include it on
every request.

---

## Endpoint summary

| Method | URL | Auth | Purpose |
|--------|-----|------|---------|
| `GET` | `/api/health` | no | Public health + config check |
| `POST` | `/api/jobs` | yes | Create a transcription job |
| `GET` | `/api/jobs/{job_id}` | yes | Poll job status / fetch result |
| `POST` | `/api/jobs/{job_id}/translate` | yes | Add translations to a completed job |
| `POST` | `/api/jobs/{job_id}/index` | yes | Index a completed job to OpenSearch |
| `GET` | `/api/lectures/{lecture_id}` | yes | List all language entries for a lecture |
| `GET` | `/api/lectures/{lecture_id}/{lang}` | yes | Fetch one transcript (lecture + language) |
| `POST` | `/api/lectures/{lecture_id}/{lang}` | yes | Manually upsert a transcript (bypass pipeline) |
| `DELETE` | `/api/lectures/{lecture_id}/{lang}` | yes | Delete a transcript row |

---

## `GET /api/health`

Public health check. No auth required.

```bash
curl https://nrs-automated-transcriptions.vercel.app/api/health
```

**Response:**
```json
{
  "ok": true,
  "service": "nrs-automated-transcriptions",
  "version": "d0944f9",
  "config": {
    "anthropic": true,
    "openai": true,
    "deepgram_keys": 7,
    "groq_keys": 4,
    "dynamodb": true,
    "opensearch": true,
    "auth": true
  }
}
```

---

## `POST /api/jobs` — create a transcription job

Returns immediately with a `job_id`. The pipeline runs in the background
(download → Deepgram → Claude cleanup → optional translate → optional index).

**Request body:**
```json
{
  "s3_url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Signature=...",

  "metadata": {
    "uuid": "f3d2a8e1-1234-5678-abcd-ef0123456789",
    "title": "2026-04-12 — Vilnius — Bhakti is for everyone",
    "date": "2026-04-12",
    "year": 2026,
    "duration": "01:12:33",
    "location": "Vilnius, Lithuania",
    "source_type": "lecture"
  },

  "translate": ["ru", "uk"],
  "index": true,
  "paragraph": true,
  "callback_url": "https://admin.niranjanaswami.net/api/transcription-done",
  "provider": "auto"
}
```

**Field reference:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `s3_url` | string (URL) | ✅ | — | Presigned S3 URL to the audio file |
| `metadata.uuid` | string | ⚠️ if `index: true` | — | Lecture UUID; used as PK for DynamoDB + OpenSearch |
| `metadata.title` | string | optional | `""` | |
| `metadata.date` | string (ISO date) | optional | `""` | `YYYY-MM-DD` |
| `metadata.year` | integer | optional | derived from `date` | |
| `metadata.duration` | string | optional | `""` | `HH:MM:SS` |
| `metadata.location` | string | optional | `""` | |
| `metadata.source_type` | string | optional | `"lecture"` | |
| `translate` | array of strings | optional | `[]` | Allowed: `"ru"`, `"uk"` |
| `index` | boolean | optional | `false` | If true, writes to `ask-nrs-lectures` (chunked EN) + `nrs-lectures-auto-transcribe` (whole docs per lang) |
| `paragraph` | boolean | optional | `true` | Run Claude cleanup + paragraphing pass |
| `callback_url` | string (URL) | optional | — | Service POSTs final job to this URL when done |
| `provider` | string | optional | `"auto"` | `"auto"` \| `"deepgram"` \| `"groq"` |

Optional enrichment fields passed through to OpenSearch:
`topic_en`, `topic_ru`, `location_en`, `location_ru`, `event_en`, `event_ru`,
`scripture_part`, `scripture_chapter`, `scripture_verse`, `play_count`,
`download_count`, `page_view_count`.

**Response (202 Accepted):**
```json
{
  "job_id": "a1b2c3d4e5f67890",
  "status": "queued",
  "poll_url": "/api/jobs/a1b2c3d4e5f67890"
}
```

**Example:**
```bash
curl -X POST https://nrs-automated-transcriptions.vercel.app/api/jobs \
  -H "Authorization: Bearer $NRS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "s3_url": "https://...presigned...",
    "metadata": { "uuid": "abc-123", "title": "Sample", "date": "2026-04-23" },
    "translate": ["ru", "uk"],
    "index": true
  }'
```

---

## `GET /api/jobs/{job_id}` — poll status / fetch result

Poll every 5–10 seconds until `status === "done"` or `"failed"`.

```bash
curl https://nrs-automated-transcriptions.vercel.app/api/jobs/a1b2c3d4e5f67890 \
  -H "Authorization: Bearer $NRS_ADMIN_TOKEN"
```

**Possible statuses:**

| Status | Meaning |
|---|---|
| `queued` | Job accepted, not yet started |
| `downloading` | Fetching audio from S3 |
| `transcribing` | Calling Deepgram / Groq |
| `cleaning` | Claude Sanskrit + paragraphing pass |
| `translating` | Translating to RU / UK |
| `indexing` | Writing to OpenSearch (chunked + whole-doc) |
| `done` | Complete; `result` populated |
| `failed` | See `error` field |

**Response while running:**
```json
{
  "job_id": "a1b2c3d4e5f67890",
  "status": "translating",
  "progress": { "stage": "translating", "pct": 65, "message": "→ uk" },
  "created_at": "2026-04-23T14:22:01.123Z",
  "updated_at": "2026-04-23T14:24:57.811Z"
}
```

**Response when done:**
```json
{
  "job_id": "a1b2c3d4e5f67890",
  "status": "done",
  "progress": { "stage": "done", "pct": 100 },
  "result": {
    "transcript_en": "...",
    "translations": {
      "ru": "...",
      "uk": "..."
    },
    "metadata": {
      "duration_s": 4380,
      "words": 9342,
      "chars": 56120,
      "deepgram_request_id": "...",
      "transcription_provider": "deepgram",
      "cleanup_model": "claude-sonnet-4-5",
      "translation_model": "claude-sonnet-4-5",
      "indexed_chunks": 11
    }
  },
  "created_at": "2026-04-23T14:22:01.123Z",
  "updated_at": "2026-04-23T14:28:14.002Z",
  "finished_at": "2026-04-23T14:28:14.002Z"
}
```

**Response on failure:**
```json
{
  "job_id": "a1b2c3d4e5f67890",
  "status": "failed",
  "error": "Deepgram: all keys exhausted (402)",
  "finished_at": "..."
}
```

---

## `POST /api/jobs/{job_id}/translate` — add translations to a completed job

Use when the original job was created without `translate`, or to add a
language later.

**Request body:**
```json
{
  "langs": ["ru", "uk"],
  "sync": false
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `langs` | array | required | `"ru"` / `"uk"` |
| `sync` | boolean | `false` | If true, response includes translations directly (may take 3–5 min). If false, returns 202; poll the job. |

**Response (async, default):**
```json
{
  "job_id": "a1b2c3d4e5f67890",
  "status": "translating",
  "langs": ["ru", "uk"],
  "poll_url": "/api/jobs/a1b2c3d4e5f67890"
}
```

**Response (sync):**
```json
{
  "job_id": "a1b2c3d4e5f67890",
  "translations": {
    "ru": "...",
    "uk": "..."
  }
}
```

Returns `409` if the job is not yet in `"done"` state.

---

## `POST /api/jobs/{job_id}/index` — index a completed job to OpenSearch

Use when the original job was created with `index: false` and you want to
push it to OpenSearch afterwards.

**Request body (all optional):**
```json
{
  "metadata": {
    "title": "override",
    "topic_en": "Bhakti",
    "location_en": "Vilnius, Lithuania"
  }
}
```

**Response (202):**
```json
{
  "job_id": "a1b2c3d4e5f67890",
  "status": "indexing",
  "poll_url": "/api/jobs/a1b2c3d4e5f67890"
}
```

Poll the job; `result.metadata.indexed_chunks` will reflect the chunk count
once indexing completes.

---

## `GET /api/lectures/{lecture_id}` — list languages for a lecture

Returns lightweight rows by default (no transcript text).

**Query params:**
- `?include_text=true` — bundle the full transcript text in the response

```bash
curl "https://nrs-automated-transcriptions.vercel.app/api/lectures/abc-123" \
  -H "Authorization: Bearer $NRS_ADMIN_TOKEN"
```

**Response (lightweight):**
```json
{
  "lecture_id": "abc-123",
  "languages": [
    {
      "lang": "en",
      "chars": 56120,
      "words": 9342,
      "metadata": { "title": "...", "date": "2026-04-12" },
      "created_at": "2026-04-23T14:28:14.002Z",
      "updated_at": "2026-04-23T14:28:14.002Z",
      "source_job_id": "a1b2c3d4e5f67890"
    },
    { "lang": "ru", "chars": 71400, "words": 8821, ... },
    { "lang": "uk", "chars": 73210, "words": 8945, ... }
  ]
}
```

**Response (with `?include_text=true`):** same shape, plus a `text` field on
each row containing the full transcript.

---

## `GET /api/lectures/{lecture_id}/{lang}` — fetch one transcript

```bash
curl https://nrs-automated-transcriptions.vercel.app/api/lectures/abc-123/en \
  -H "Authorization: Bearer $NRS_ADMIN_TOKEN"
```

**Response:**
```json
{
  "lecture_id": "abc-123",
  "lang": "en",
  "text": "...full transcript...",
  "chars": 56120,
  "words": 9342,
  "metadata": {
    "title": "...",
    "date": "2026-04-12",
    "year": 2026,
    "duration": "01:12:33",
    "location": "Vilnius, Lithuania",
    "source_type": "lecture",
    "transcription_provider": "deepgram",
    "cleanup_model": "claude-sonnet-4-5"
  },
  "source_job_id": "a1b2c3d4e5f67890",
  "created_at": "...",
  "updated_at": "..."
}
```

Returns `404` if not found.

---

## `POST /api/lectures/{lecture_id}/{lang}` — manual upsert

Replace a transcript entirely. Use for hand-edited corrections or to upload
transcripts generated outside this pipeline.

**Request body:**
```json
{
  "text": "...full transcript...",
  "metadata": {
    "title": "...",
    "date": "2026-04-12"
  },
  "source_job_id": "optional-reference"
}
```

Only `text` is required. Returns `201` with the stored row.

---

## `DELETE /api/lectures/{lecture_id}/{lang}` — remove a transcript

```bash
curl -X DELETE https://nrs-automated-transcriptions.vercel.app/api/lectures/abc-123/ru \
  -H "Authorization: Bearer $NRS_ADMIN_TOKEN"
```

**Response:**
```json
{ "ok": true, "lecture_id": "abc-123", "lang": "ru" }
```

---

## Typical admin-page integration flow

```typescript
const BASE = "https://nrs-automated-transcriptions.vercel.app";
const TOKEN = process.env.NRS_ADMIN_TOKEN!;

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};

// 1. Admin mints a presigned S3 URL
const presigned = await s3.getSignedUrl("getObject", {
  Bucket: "niranjanaswami-audio",
  Key: `lectures/${lecture.uuid}.mp3`,
  Expires: 3600,
});

// 2. Submit job
const { job_id } = await fetch(`${BASE}/api/jobs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    s3_url: presigned,
    metadata: {
      uuid: lecture.uuid,
      title: lecture.title,
      date: lecture.date,
      year: lecture.year,
      duration: lecture.duration,
      location: lecture.location,
    },
    translate: ["ru", "uk"],
    index: true,
  }),
}).then((r) => r.json());

// 3. Poll until done
while (true) {
  await new Promise((r) => setTimeout(r, 5000));
  const job = await fetch(`${BASE}/api/jobs/${job_id}`, { headers }).then((r) =>
    r.json()
  );
  setProgress(job.progress);
  if (job.status === "done") {
    showResult(job.result);
    break;
  }
  if (job.status === "failed") {
    showError(job.error);
    break;
  }
}

// 4. Or later, fetch a specific language
const ru = await fetch(`${BASE}/api/lectures/${lecture.uuid}/ru`, {
  headers,
}).then((r) => r.json());
```

Alternative to polling: pass `callback_url` in the `POST /api/jobs` body and
the service POSTs the final job payload to your URL when done (no polling
needed).

---

## Storage destinations (where the output lands)

A single job with `translate: ["ru", "uk"], index: true` writes to:

| Destination | Content | Key |
|---|---|---|
| **DynamoDB** `nrs-lectures-auto-transcribe` | full transcript per language (EN + RU + UK) | PK `lecture_id`, SK `lang` |
| **OpenSearch** `nrs-lectures-auto-transcribe` | whole-transcript docs per language (same shape as DynamoDB) | doc `_id = {lecture_id}_{lang}` |
| **OpenSearch** `ask-nrs-lectures` | **English only**, chunked (~800 tok) + embedded, feeds the RAG pipeline in `ask-niranjana-swami` | doc `_id = {lecture_id}_chunk_{n}` |
| **DynamoDB** `nrs-transcribe-jobs` | job-state tracking, 30-day TTL | PK `job_id` |

Translations are **never** written to the chunked `ask-nrs-lectures` index
(by design — the RAG app searches over English only for now).
