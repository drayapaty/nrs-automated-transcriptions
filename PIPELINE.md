# NRS Automated Transcription — Full Pipeline

End-to-end walkthrough of how a lecture audio file becomes a searchable multilingual transcript with canonical Sanskrit verses.

## Overview

Two repos, one pipeline:

- **`nrs-automated-transcriptions`** (this repo, prod service on Vercel) — audio in, cleaned transcript out, delivered by email and indexed for RAG.
- **`verse-restore`** (private, separate repo) — optional post-processor that patches any Sanskrit verses Whisper garbled or dropped.

```
[ Admin UI ]                                                    [ Ask NRS RAG ]
     │                                                                  ▲
     │ presigned S3 upload / YT fetch / URL POST                        │
     ▼                                                                  │
┌────────────────────────────────────────────────────────────────────┐  │
│  Vercel: nrs-automated-transcriptions                              │  │
│                                                                    │  │
│  POST /api/jobs   ─── writes DynamoDB row (nrs-transcribe-jobs)    │  │
│           │                                                        │  │
│           ▼   waitUntil( runPipeline(job) )                        │  │
│  ┌────────────────────────────────────────────────────────────┐   │  │
│  │ 1. download          presigned S3 URL → Buffer             │   │  │
│  │ 2. transcribe        Groq Whisper large-v3  (primary)      │   │  │
│  │                      Deepgram Nova-3 URL    (fallback)     │   │  │
│  │ 3. cleanup           Claude Sonnet 4.6 — IAST + paragraphs │   │  │
│  │ 4. persist EN        DynamoDB + OpenSearch                 │   │  │
│  │                      nrs-lectures-auto-transcribe          │   │  │
│  │ 5. translate         parallel RU / UK  (Sonnet, optional)  │   │  │
│  │ 6. chunk + embed     OpenAI text-embedding-3-small         │   │  │
│  │ 7. index RAG chunks  OpenSearch ask-nrs-lectures           │   │  │
│  │ 8. deliver           SES email + admin UI + PDF export     │   │  │
│  └────────────────────────────────────────────────────────────┘   │  │
│                                                                    │  │
└────────────────────────────────────────────────────────────────────┘  │
                                                                        │
                            (optional post-processing)                  │
                                                                        │
                          ┌────────────────────────────────┐            │
                          │  verse-restore (separate repo) │            │
                          │  detect-holes → restore        │────────────┘
                          │  fills any surviving           │
                          │  [unverified citation] blocks  │
                          │  from local 2 053-verse corpus │
                          └────────────────────────────────┘
```

## Stage-by-stage

### 0. Ingest

Three entry points, all end up posting to `/api/jobs`:

| Source | Endpoint | Notes |
|--------|----------|-------|
| Admin UI upload | `/api/ui/upload-init` → S3 presigned PUT → `/api/ui/upload-done` | Vercel-side presigned upload (no proxy through Node) |
| URL | `POST /api/jobs { s3_url, metadata }` | Direct submission by API consumers |
| YouTube | `POST /api/transcribe` → `resolveYt` (ytdl-core + cobalt.tools fallback) → S3 | Auto-resolves YT URL to MP3 |

`/api/jobs`:
1. Writes a row to DynamoDB `nrs-transcribe-jobs` with `status: "queued"`.
2. Kicks off `runPipeline(job)` via `waitUntil()` so the request returns immediately with `{ job_id }`.
3. Every subsequent stage updates the same row (`stage`, `pct`, `message`) — admin UI polls for live progress.

### 1. Download

`src/lib/pipeline/download.ts`

Fetches the presigned S3 URL into an in-memory Buffer. Cap 500 MB. Vercel functions have 3 GB memory + ephemeral disk; keeping audio in memory avoids disk I/O overhead.

### 2. Transcribe (`src/lib/pipeline/transcribe.ts`)

**Groq Whisper `large-v3` is PRIMARY.** This is non-negotiable for NRS content: the alternatives fail on Sanskrit.

| Provider | Sanskrit capture | Notes |
|----------|-------------------|-------|
| Groq Whisper `large-v3` | 84 – 981 IAST chars / 90-min lecture | Multilingual model, phonetic + diacritic output |
| Deepgram Nova-3 | **0 IAST chars** across the same 4 test lectures | English-only, silently drops verses |
| Gemini 3.x | ASCII phonetic (0 diacritics), but often blocked by RECITATION filter on scripture prompts | Not adopted — content-policy single point of failure |
| OpenAI `whisper-1` | 0 IAST when forced to `language=en` | Last-resort fallback only |

**Whisper prompt.** The `SANSKRIT_PROMPT` constant biases Whisper toward Vaiṣṇava vocabulary AND verse-shape audio:
- Noun bank (~40 proper nouns and concepts).
- Three sample verses primed in IAST (`nehābhikrama-nāśo…`, `namas te narasiṁhāya…`, mahā-mantra).

Verified: adding the sample verses lifts capture on unrelated verses too — Whisper matches the acoustic pattern of "verse being recited" once primed.

**Deepgram KEYTERMS.** Small, distinct list of proper nouns that boosts recognition on the Deepgram *fallback* path. Common chant words (Krishna, Hare, Rama) are deliberately excluded — boosting them makes Nova-3 hallucinate a chant tail.

**Failure modes we've hit:**
- Groq rate limit (7 200 seconds of audio per hour per org, all keys share the same quota). Falls through to Deepgram URL mode.
- File > 25 MB. Groq's Whisper endpoint refuses. `transcribe.ts` chunks the audio and streams chunks in parallel.

### 3. Cleanup (`src/lib/pipeline/cleanup.ts`)

Claude Sonnet 4.6 rewrites the raw transcript.

**What it does:**
1. **IAST diacritics** — the entire narrative, not just quoted verses. Sri Radha (the editor consuming the output) requires consistent IAST throughout.
2. **Preserve voice** — Maharaja's speech rhythm, no dedup / re-ordering / re-phrasing.
3. **Common-subs pre-pass** — deterministic fixes for known Whisper mishearings BEFORE Sonnet sees the text: `Rādhe Kṛṣṇa → Hare Kṛṣṇa` (ISKCON closing), bare `bhaktas → devotees` (Maharaja narrates in English; `bhakta-vatsala` and other compounds are preserved via negative lookahead).
4. **Verse blocks** — canonical opening prayer, mahā-mantra, guru-praṇāma get inserted verbatim in IAST when Whisper's phonetic garble matches the shape.
5. **Bilingual audio** — Russian / Ukrainian translator sections stripped from English output.
6. **Paragraphing** — natural paragraph breaks on topic shift; no wall-of-text.
7. **Speaker labels** — none (single-speaker lecture) except meetings, which use Deepgram diarize.

The prompt is a direct copy of `ask-niranjana-swami`'s `fetch-lectures.ts` prompt so the output style matches the existing 2 700+ transcript corpus.

### 4. Persist English immediately

Once cleanup finishes, `putLecture(uuid, "en", text)` writes to OpenSearch `nrs-lectures-auto-transcribe` with the doc `_id = {uuid}_en`. Idempotent — re-runs overwrite cleanly.

Doing this before translation means the English transcript is queryable even if a downstream stage fails.

### 5. Translate (optional, `src/lib/pipeline/translate.ts`)

Parallel fan-out. If the caller requested `translate: ["ru", "uk"]`, both language transcripts are produced by Sonnet in parallel — wall-clock is `max(per-language)`, not the sum. Essential for Vercel Hobby's 300 s function limit.

Rules:
- Sanskrit terms stay in their standard IAST forms — NOT Cyrillized.
- Verse references stay verbatim (`SB 1.2.6`, `BG 2.40`).
- Standard Russian Vaishnava conventions (`Господь` for Lord, `преданное служение` for devotional service).

### 6. Chunk + embed (optional)

Only for English. If the caller requested indexing:

1. **Chunk** (`src/lib/pipeline/chunk.ts`) — paragraph-aware, 800 tokens with 200-token overlap, 20 000-char hard cap. Mirrors `ask-niranjana-swami`'s `ingest-elasticsearch.ts`.
2. **Embed** (`src/lib/pipeline/embed.ts`) — OpenAI `text-embedding-3-small` (1 536 dims), batches of 50. Same model as the existing Ask NRS index for compatibility.

### 7. Index for RAG (`src/lib/pipeline/index-opensearch.ts`)

Bulk-writes chunks to OpenSearch `ask-nrs-lectures` with deterministic IDs `{uuid}_chunk_{N}`. The RAG app queries this index.

### 8. Deliver

Three parallel deliveries:

1. **SES email** — `sendCompletionEmail(job)` sends the full transcript to `job.notify_email` from `noreply@askacarya.com`. Attachments include a PDF export.
2. **Admin UI** — status polling picks up `state: "done"`, renders the inline transcript view with a copy button.
3. **Callback URL** — if the request included `callback_url`, POSTs the finished job JSON.

## Post-processing: verse restoration

For lectures where Whisper still garbled key verses, the `verse-restore` module (private repo) provides a manual fill.

**Not currently wired into the prod orchestrator** — runs offline against a downloaded transcript. Details in [github.com/drayapaty/verse-restore/PIPELINE.md](https://github.com/drayapaty/verse-restore/blob/main/PIPELINE.md).

Summary:
1. `detect-holes.ts` — Sonnet audits the transcript for spots where a verse was expected but not captured. Marks each with `[unverified citation]` + reference.
2. `restore.ts` — for each marker, look up the verse in the 2 053-entry local corpus. Three-pass lookup: exact key → maṅgalācaraṇa phonetic → **content-match RAG (n-gram Jaccard ≥ 0.35)**. Content-match handles corpus entries with flat keys (BB from askacarya).

Two blind tests on 8 BB lectures: ~75-78% verse recovery when Groq Whisper primary succeeds. Zero recovery when Deepgram or OpenAI `whisper-1` is used.

## Data stores

| Store | Purpose |
|-------|---------|
| DynamoDB `nrs-transcribe-jobs` | one row per job — status, stage, error, deliverables |
| DynamoDB `nrs-lectures-auto-transcribe` | one row per `(uuid, lang)` — full transcript + metadata |
| OpenSearch `nrs-lectures-auto-transcribe` | mirrors the DynamoDB rows for whole-transcript search |
| OpenSearch `ask-nrs-lectures` | chunked + embedded English transcripts for RAG |
| DynamoDB `nrs-auth` | NextAuth v5 magic-link + allowlist |
| S3 upload bucket | presigned PUT target for admin UI uploads |

## Environments

| Env var | Notes |
|---------|-------|
| `GROQ_API_KEY`, `GROQ_API_KEY_2..4` | rotation — all share org quota |
| `DEEPGRAM_API_KEY`, `DEEPGRAM_API_KEY_2..N` | fallback ASR |
| `OPENAI_API_KEY` | embeddings + last-resort ASR |
| `ANTHROPIC_API_KEY` | cleanup + translation |
| `OPENSEARCH_HOST`, `OPENSEARCH_USER`, `OPENSEARCH_PASS` | shared cluster |
| `OPENSEARCH_INDEX_LECTURES` (default `nrs-lectures-auto-transcribe`) | full-transcript index |
| `OPENSEARCH_INDEX` (default `ask-nrs-lectures`) | chunked RAG index |
| `SES_REGION=us-east-1` | prod SES access |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | DynamoDB + SES + S3 |
| `AUTH_SECRET`, `ALLOWED_EMAILS`, `AUTH_DYNAMODB_TABLE=nrs-auth` | admin auth |

## Cost profile (per 90-min lecture, ballpark)

| Stage | Provider | Cost |
|-------|----------|-----:|
| Transcribe (primary) | Groq Whisper large-v3 | free (within 7 200 s/hour) |
| Transcribe (fallback) | Deepgram Nova-3 URL | ~$0.30 |
| Cleanup | Claude Sonnet 4.6 | ~$0.15 |
| Translate ×2 (RU + UK) | Claude Sonnet 4.6 | ~$0.30 |
| Embed | OpenAI text-embedding-3-small | ~$0.01 |
| Total (English + 2 translations + indexing) | | **~$0.46 – $0.76** |

## Known limits / next work

- **Groq quota under load.** 4-lecture batch (~6 hours audio) trips the 7 200 s/hour ceiling. Options: serial submission (free, slower), Replicate `whisper-large-v3` (PAYG ~$0.01/min), or self-hosted GPU.
- **Verse restoration not wired.** `verse-restore` is offline post-processing. Wiring it into the orchestrator behind a `restore_verses` flag would be a natural next PR.
- **OpenAI `whisper-1` is a trap.** It's tempting as a "cheap English fallback" but produces 0 IAST — never use for NRS Sanskrit content. Documented in `verse-restore/PIPELINE.md`.
- **Transcribe.ts top comment is stale.** Says "Deepgram Nova-3 (primary) and Groq Whisper (fallback)" — actual code (line 154+) is the opposite. Fix in a small doc PR.

## Related docs

- [`README.md`](README.md) — service overview
- [`ENDPOINTS.md`](ENDPOINTS.md) — HTTP API surface
- [`STAGING.md`](STAGING.md) — preview deploys
- [`YT_FALLBACK.md`](YT_FALLBACK.md) — YouTube fetch layers
- [verse-restore/PIPELINE.md](https://github.com/drayapaty/verse-restore/blob/main/PIPELINE.md) — post-processing details
