# Decisions Register — nrs-automated-transcriptions

**Summary**: Standing decisions for the NRS transcription service. Read before re-deciding anything. Append-only; newest first. Complements `README.md` / `PIPELINE.md`.

---

## 2026-08-06 — Elaborate step (step 4 proper) built and fixed end-to-end

New tool implementing Mahārāja's own verbatim 4-point spec for step 4
(see `scripts/ELABORATE_REQUIREMENTS.md`) — distinct from `write-chapter`/
`write-chapter-voiced`. `src/lib/pipeline/elaborate.ts` +
`scripts/elaborate-cli.ts`. Output: Part 1 (edited transcript excerpt, not
a summary), Part 2 (genuine parallels from his own books/lectures), Part 3
(suggested elaboration angle per topic).

Bugs found and fixed while getting this working, in order:

1. **Env-var load order.** Top-level `const OPENSEARCH_URL = process.env...`
   captured `undefined` because static ES module imports evaluate before
   the importing CLI's `dotenv.config()` runs, regardless of source-line
   order. Fixed: read `process.env.*` lazily inside a function
   (`openSearchConfig()`), matching the existing `clients.ts` pattern.
2. **TLS on self-signed cert.** OpenSearch host `148.251.70.122:9200` uses
   a self-signed cert; fetch() failed with a bare "fetch failed" until
   `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` was set before the
   request (matches `ask-niranjana-swami/src/lib/opensearch.ts`'s existing
   handling of the same server).
3. **max_tokens too low.** `8_000` truncated Opus 5/Haiku 4.5 mid-Part-1
   (confirmed via `stop_reason`/content-block debug logging) — raised to
   `16_000`.
4. **Lecture-note artifacts leaking into book text.** Output said "in our
   last class," "we will begin our next class" — copied straight from the
   transcript's spoken framing. This is book text, not a lecture transcript.
   Added an explicit CONTENT RULES line banning "class"/"the speaker says"
   phrasing.

**Search corpus expanded to books + lectures + Queen Kunti series**,
per Mahārāja's explicit request (his point 3 spec already said "lectures
or books," an earlier books-only restriction was a session simplification,
not his spec). Index `ask-nrs-lectures` has `source_type: book|lecture`,
`lecture_date_year`, `topic_en`. New pool: all books, all lectures from
2000 onward, plus a dedicated always-run mini-search against lectures that
cite the "Teachings of Queen Kunti" book.

**Queen Kunti retrieval bug**: `topic_en == "Teachings of Queen Kunti"`
only tags the ONE lecture literally titled after that book (Sept 1, 2013,
Almaty) — not the ~12 other lectures that cite/quote the book while tagged
under their own topic (an SB 1.8.21 class, a BG 12.9 class, etc). Confirmed
against askniranjanaswami.com's own citation search (2026-08-06 screenshot,
15 lectures + 2 books found). Filtering on `topic_en` alone missed nearly
all of them. Fixed: filter on the phrase itself (`match_phrase` on
content/title for "Teachings of Queen Kunti" / "Queen Kunti's prayers"),
`topic_en` term kept as one more `should` clause, not the sole filter.

**Part 2 also written to its own file** (`*_elaborate_part2.md`), split
from the main `*_elaborate.md` output, per Mahārāja's request — main file
unchanged, still has all 3 parts.

## 2026-08-06 — Hard rule: never abridge/edit book-voice text by hand, always regenerate through the model

Mahārāja's own feedback on a hand-abridged Part 1: "he does not carry his
voice." Root cause: manually cutting his first-person prose for length
strips the personal reflective transitions first ("I find it worth pausing
here," "I am reminded here of," "I hold this close to heart") since they
read as compressible filler — but those transitions ARE the voice; without
them the text degrades into a third-person digest, exactly the failure mode
his point 2 (elaborate spec) warns against.

**Rule, no exceptions**: any shortening, editing, or reformatting of text
written in Mahārāja's first-person book voice — abridging, trimming,
tightening — must go back through the model with the full VOICE calibration
(see `elaborate.ts` / `write-chapter-voiced.ts` VOICE sections) as an
explicit instruction to preserve, not through manual/mechanical editing.
User confirmed 2026-08-06: "Always maintain his voice please, do not
deviate, we established rule, no compromise."

## 2026-08-06 — Fixed stale CLAUDE_MODEL override in .env.local

`.env.local` had `CLAUDE_MODEL="claude-sonnet-4-5"`, overriding the code's
correct default of `claude-sonnet-4-6`. This exact bug was already flagged
in `SESSION-HANDOFF-2026-08-02.md` ("do NOT set CLAUDE_MODEL... if a
previous .env.local exists with CLAUDE_MODEL=claude-sonnet-4-5, that is a
bug — delete it") but had crept back in and gone unnoticed. Every
summarize/compare/write-chapter/write-chapter-voiced/elaborate call this
session (2026-08-06) ran on the wrong, lower-quality model as a result.

**Decision**: removed the line entirely from `.env.local`. Do not re-add a
`CLAUDE_MODEL` override — the code default is correct.

## 2026-08-06 — Two-path Evernote-summary test: Path 2 wins decisively

Tested both candidate paths from the "Evernote summary input" open item
(see `scripts/ELABORATE_REQUIREMENTS.md`) on the same real lecture
(2026-08-06 class, clean/no-japa source from Mahārāja's manual edit,
`~/Downloads/08-06-26.mp3`):

- **Path 1** (raw Zoom audio attached directly, Evernote's own native
  Transcribe): **failed badly**. Evernote auto-detected the spoken-language
  as Russian (`wasLanguageAutoDetected:true, transcribedLanguages:["ru"]`)
  despite the lecture being almost entirely English — produced a garbled,
  largely unusable phonetic Russian transcript of English/Sanskrit speech
  ("Hare Kṛṣṇa" → "Бхарати Гришна!"). Confirmed via `get_note`'s
  `--en-transcription` JSON blob.
- **Path 2** (our own pipeline's already-cleaned/verse-restored transcript
  pasted as the note body, Evernote's AI Assistant asked to summarize only
  — no native Transcribe involved): **succeeded**. Produced a draft good
  enough that Mahārāja edited it into a finished, well-structured summary
  (thematic sections, correct verse citations, no garbling) — the pasted
  final version is his edit, not raw AI output, but the draft was
  clearly usable as a starting point, unlike Path 1's output which wasn't
  salvageable at all.

**Decision**: Path 2 is the standing approach — feed Evernote our own
pipeline's transcript text, never the raw audio, for the Evernote-summary
leg of the BB workflow. Path 1 (native audio transcribe) is not viable for
this pipeline given the language-misdetection failure mode observed here.

**UI note for the `evernote-audio-note` skill**: the AI Assistant chat input
is an `<openai-chatkit>` custom element with a shadow root that browser
automation (Chrome MCP) could not reliably click/type into across many
attempts — confirmed via JS (`document.activeElement` inspection) that
clicks were landing on the right visual spot but not focusing the real
input inside the shadow DOM. The reliable trigger is the **floating
bottom-right sparkle/diamond button** (opens the panel fresh, bound to the
current note) — clicking the top-bar "Ask AI Assistant" chip on an
already-open but stale panel (e.g. left over from viewing a different note)
does not reliably work via automation. Even after finding the right button,
typing into the chat input itself remained unreliable via automation in
this session — ended up needing the user to type the summary request
manually. Worth revisiting with a fresh approach (e.g. `key`-by-key input
instead of bulk `type`) before relying on this automated end-to-end.

## 2026-08-06 — Zoom fetch formalized as a real pipeline step

Following the manual curl-based fetch earlier today, formalized into
`src/lib/pipeline/fetch-zoom.ts` + `scripts/fetch-zoom-cli.ts` +
`.claude/commands/fetch-zoom.md` + `~/.claude/skills/fetch-zoom-lecture/`
— same 4-piece pattern as every other pipeline step (transcribe, summarize,
compare, write-chapter[-voiced]).

**Implementation choices:**
- `ZOOM_LECTURE_EMAIL` defaults to `nrs@niranjanaswami.com` (the only Zoom
  user-scoped email that worked — `swami@niranjanaswami.{org,com}` both
  returned "User does not exist") via env var with that hardcoded fallback,
  not required in `.env.local`.
- Lists recordings over a 7-day trailing window (Zoom's API requires a
  bounded date range), sorts newest-first, takes the top result's
  `audio_only` file only — matches the "default to latest, no confirmation"
  rule from earlier today.
- If more than one meeting shares the latest meeting's calendar day, returns
  `ambiguous: true` + a count rather than silently guessing — CLI surfaces
  this as a warning instead of blocking.
- Output convention: `~/Downloads/<date>_zoom_<sanitized-topic>.m4a`.
- Video recording files (`active_speaker`/`gallery_view` MP4, ~2.8 GB for a
  3-hour class) are never fetched by this step — separate Google Drive
  backup plan noted in `ZOOM-PIPELINE.md` TODO, not built yet.

Verified: re-running the CLI reproduced the same file/result as the earlier
manual fetch (Japa Session Final, 2026-08-06), 4.9s, no ambiguity warning.

## 2026-08-06 — Zoom fetch: default to latest recording, no confirmation needed

First successful fetch (`nrs@niranjanaswami.com`, "Japa Session Final",
2026-08-06) required back-and-forth to identify the right meeting and file
type. Divakar clarified: once Zoom has finished processing, whenever
Mahārāja asks to grab the file, default to the **latest recording** on the
account automatically — no need to list/confirm which meeting or ask
permission first.

**Decision**: future fetches should query recordings sorted by most recent
`start_time` and take the top result's `audio_only` (M4A) file directly,
skip the discussion step for meeting identity. Still worth a quick sanity
check if there are multiple recordings on the same day (ambiguous "latest"),
but the single-recording-per-day case (the common one) should just execute.

## 2026-08-06 — Zoom pipeline scope change: auto-fetch via API, not manual hand-off

`ZOOM-PIPELINE.md` (design doc, not yet built) explicitly scoped "getting the
audio file itself... out of scope," assuming a person manually exports the
Zoom recording and hands off a local file. Divakar provided Zoom Server-to-
Server OAuth app credentials (Account ID, Client ID, Client Secret) —
confirmed intent: auto-fetch recordings via Zoom's API instead of manual
export.

**Decision**: credentials stored in `.env.local` (gitignored, not committed)
as `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET`. `ZOOM-
PIPELINE.md` itself not yet updated to reflect this scope change — still
describes the old manual-hand-off architecture. Needs a rewrite before the
fetch leg is implemented, so the doc doesn't mislead about what's in/out of
scope.

---

## 2026-08-03 — Book chapter writing (step 4): first-person voiced variant added alongside plain version

`write-chapter.ts` (first build) wrote third-person book-author prose ("Śrīla Sanātana Gosvāmī shows us..."). User corrected: **the book is authored BY Niranjana Swami himself — must be first person**, not a description of his teaching from outside.

**Decision**: added `write-chapter-voiced.ts` / `write-chapter-voiced-cli.ts` / `/write-chapter-voiced` as a separate variant rather than replacing the original — kept `write-chapter.ts` for reference/comparison per explicit request ("keep the current version for reference and give me one with his actual voice").

Voice calibrated against `ask-niranjana-swami/content/ebooks/Niranjana-Swami-Letters-Tone-and-Delivery-Notes.md` (sibling repo, built from his 5-volume Collected Letters) — but that profile is letters-voice (fixed salutations/sign-offs, restate-the-question format), not book-chapter voice. Adapted the underlying signatures (humility, Prabhupāda-anchored authority rather than independent assertion, gentle qualifiers, reasoned patience, prayer-closing) into first-person chapter prose rather than copying letter conventions literally. First test output (`2025_09_07_bb_1_1_12_chapter_voiced.md`) reads consistently first-person throughout, no third-person slippage.

Still **unverified against real book material** — same caveat as the plain version, no sample manuscript pages exist to check against.

## 2026-08-03 — Comparative analysis (step 3 of BB workflow): verse-anchored extraction, Vol.1-only

Built `src/lib/pipeline/compare.ts` + `scripts/compare-cli.ts` + `.claude/commands/compare.md` to find lecture content not covered in Gopīparāṇadhana Dāsa's published Bṛhad-bhāgavatāmṛta commentary.

**Decisions:**
- **Vol.1 only.** The extracted library at `~/Downloads/FFF/SanatanaGoswami-extracted/md/` has two BB volumes, but Vol.2 there is Bhānu Svāmī's translation, not Gopīparāṇadhana's — different translator, out of scope for this specific comparison per the user's original spec (which names Gopīparāṇadhana specifically).
- **Verse-anchored, not full-file.** Source file is 75,258 lines / ~2,500 verses. Extraction uses the file's own `## BB {part}.{chapter}.{verse}` headers (verse may be a range like "15-17") to slice just the matching section — full-file context per call would be wasteful and unnecessary.
- **Filename-driven verse range, with explicit override.** Of the 35 restored BB files, only 18 have a parseable `bb_<part>_<chapter>_<start>[_<end>]` verse range in the filename; the rest are topical talks with no sequential verse anchor and are out of scope for this step. CLI accepts explicit part/chapter/verse args as a fallback for files that don't follow the naming convention.
- **Source file never committed** — BBT copyrighted text, referenced by absolute path outside the repo.

## 2026-08-03 — Lecture summary spec: new file, don't overwrite old one; structure follows the lecture

Old `scripts/SUMMARY_PROMPT.md` (rigid verse-by-verse "Text N" template with
fixed metadata header) does not match the user's real hand-written Evernote
summaries. Compared 4 real samples (BB Vol.1 Ch.2-3, Śiva-tattva lectures).

**Decision**: wrote `scripts/SUMMARY_PROMPT_V2.md` as a new file rather than
overwriting `SUMMARY_PROMPT.md` — user explicitly asked not to overwrite if a
summary spec already exists. Old file kept as stale reference.

**Structural finding**: real summaries do NOT share one rigid skeleton. Some
organize by theme (numbered sections, each pulling in cross-references); one
organizes strictly by verse number (Text 81, Text 82, ...). Which shape fits
depends on how the lecture was delivered (sequential verse-by-verse vs. a
topic ranging across multiple verses/pastimes) — the generation prompt must
decide shape from the transcript itself, not force a fixed template. Common
across all 4: no fixed metadata header block, recap-of-previous-class near the
top, and a final takeaways section whose heading wording varies per lecture
(not a fixed label).

## 2026-08-02 — Zoom-class distribution pipeline: architecture (in progress)

New pipeline for Mahārāja's Zoom classes: given the raw audio file (however it's obtained — out of scope), fan it out to two destinations automatically.

**Decisions so far:**
- **Evernote delivery = email, not API.** Evernote's public API dev-token program has been closed to new developers for years; the pragmatic path is Evernote's per-account "email this note" address (`username.xxxxx@m.evernote.com`) — mailing to it auto-creates a note.
- **Evernote email = a LINK, not an attachment.** Superseded the original "attach the raw audio" plan same day: SES hard-caps raw messages at 10 MB, and a real class recording is 40-100+ MB (measured: 61.2 MB for a 67-min mp3 @128kbps during the gpt-4o-transcribe test). Most mail gateways cap attachments around 25 MB regardless. Fix: upload audio to S3 first (reuse the presigned-URL flow already used for `/api/jobs`), email Evernote a note body containing a download link. `src/lib/email.ts`'s raw-MIME SES sender is still reused, just for a text/HTML body instead of a binary attachment.
- **Evernote generates its own summary** — not our concern. We only need to deliver the raw audio there.
- **Transcription leg calls the LOCAL pipeline already installed on Mahārāja's Mac** (the Claude Desktop MCP server, `mcp-server.mjs`, per `SETUP-CLAUDE-DESKTOP.md`) — NOT the remote `/api/jobs` Vercel endpoint. Reuse the same local functions `transcribe-cli.ts` already calls (`transcribeWithGroqChunked` → `cleanupTranscript` → `restoreVerses`).
- **Trigger**: a person hands off the local audio file (manual/CLI, matching the existing "paste a file path into Claude Desktop" pattern) — not a fully-automatic webhook. Not revisited unless asked.

**Blocked on**: Mahārāja's Evernote note-email address (need to ask him). No code written yet — architecture only.

## 2026-08-01 — corpus-seeds.json for non-auto-generated verses

`corpus-seeds.json` at repo root holds hand-curated verses NOT covered by the auto-generated corpus (non-BBT sources like Padma Purāṇa, plus BB verses whose flat-key mapping misses them). Merged at load time in verse-restore.mjs — seed entries always win over auto-generated ones. Add new non-BBT/non-standard verses here; never hand-edit corpus.json.

## 2026-08-01 — Post-cleanup praṇāma stripper (deterministic, no LLM)

New pipeline stage between cleanup and verse-restore: `strip-fabricated-pranama.ts`.

**Problem**: Sonnet sees garbled Sanskrit in raw Whisper output (often BB verse fragments) and "helpfully" reconstitutes them as full guru-praṇāma sets. This is non-deterministic — sometimes it fabricates, sometimes not.

**Solution**: Deterministic post-pass compares ASCII-folded raw Whisper text against cleaned output using fuzzy regex probes. If raw has NO guru-praṇāma markers → strip ALL guru-praṇāma from cleaned. If raw has markers → keep first merged block, strip duplicates.

**Key design decisions**:
- `asciiFold()` normalizes IAST diacritics (ā→a, ṣ→s, ṇ→n) before probe matching — Whisper sometimes outputs partial IAST that breaks ASCII-only probes
- `isContinuationLine()` treats `[bracketed tags]` and `(parentheticals)` as transparent within praṇāma blocks — Sonnet inserts `[unverified citation]` between prayer lines
- `MERGE_GAP = 8` merges guru blocks within 8 lines of each other — garbled praṇāma (not matching GURU_MARKERS) between recognized prayer lines was splitting one opening set into multiple blocks
- Wired into `orchestrator.ts` (stage 3b) and `batch-reclean.ts` (step 2)

**Validation**: 35-file test suite. 1/35 correctly stripped (truly fabricated, raw=NO after folding). 34/35 correctly kept. Zero false positives. `tsc --noEmit` clean.

**Known separate issue**: verse-restore can duplicate a verse when Sonnet splits one garbled verse across two `[unverified citation]` blocks (1/35 files affected). Not a stripper issue — verse-restore dedup needed.

---

## 2026-08-01 — Pipeline repeatability: 4 fixes from BB retranscription audit

Manual quality review of 35 BB lecture transcripts revealed 4 pipeline gaps where human intervention was needed. All 4 fixed so the pipeline produces the same quality automatically.

**Fix 1 — Cleanup prompt Rule 2: preserve prayers IN PLACE, don't hoist** (`cleanup.ts`)
Root cause of prayer-positioning bug across 16 files. Old prompt said "Always preserve them as the very first paragraphs." Now says: preserve prayers WHERE they appear, do NOT move or fabricate. Speaker's actual order (greeting → prayers) is preserved.

**Fix 2 — Liturgy corpus expansion** (`corpus.json`, `verse-restore.mjs`)
Added Rādhā-praṇāma, Bhagavat-namaskāra (`oṁ namo bhagavate vāsudevāya`), Vyāsa-namaskāra (`oṁ namo bhagavate vyāsadevāya`) to corpus + exact-string probes in `looksLikeMangalacarana()`. NAMED_WORK regex updated. Corpus 26,585 → 26,588.

**Fix 3 — Auto-tag unmatched verse blocks** (`verse-restore.mjs`)
When `isVerseLine()` detects a verse block but no corpus or prayer match, insert `[unverified citation]` above it. Guard against `isVerseLine` false positives (greetings with IAST names): only tags multi-line blocks OR single-line with corpus score ≥ 0.20.

**Fix 4 — Cleanup prompt: expanded prayer reference list** (`cleanup.ts`)
Added Rādhā-praṇāma, Bhagavat-namaskāra, Vyāsa-namaskāra to the prompt's canonical prayer list so Sonnet can recognise and restore them.

Tests: `scripts/test-verse-restore.mjs` 32/32. `tsc --noEmit` clean.

**Standing gap**: BB-specific verses manually restored via MCP (23 of 35 blocks) are NOT yet in the corpus. The corpus has 493 BB entries but not every verse Maharaja quotes in these lectures. A targeted corpus import from the vedic-scriptures MCP for the specific BB verses referenced in these 35 lectures would close this gap.

---

## 2026-07-30 — conversation pipeline + cleanup fix

**Conversation/diarization pipeline** — productionized as MCP tool `transcribe_conversation`. Architecture: Groq Whisper (word-level timestamps, IAST quality) + Deepgram nova-2 (speaker labels) run in parallel, merged by timestamp alignment, then Sonnet IAST cleanup + verse-restore. Requires `DEEPGRAM_API_KEY`.

**Praṇāma restoration restricted to opening only** — cleanup prompt rule #2 was over-applying, inserting Prabhupāda-praṇāma mid-transcript when Sonnet encountered garbled Sanskrit. Fixed: rule now explicitly scoped to first 2-3 paragraphs only; mid-lecture garble handled by rules 4/8 instead.

**Default model updated** — `clients.ts` default changed from `claude-sonnet-4-5` (deprecated) to `claude-sonnet-4-6`.

---

## 2026-07-23 — seeded from README.md, PIPELINE.md + memory

**Scope**
- Separate Vercel project / env / deployment from `ask-niranjana-swami`; reuses the same AWS account, Anthropic key, Deepgram keys, OpenSearch cluster.
- Async job-based by design (Vercel sync limits vs 5–8 min pipeline). `POST /api/jobs` is async — poll `GET /api/jobs/{id}`; `sync:true` is not honored.
- Does NOT touch: the ask-niranjana-swami repo, existing `ask-ns-*` DynamoDB tables, existing OpenSearch docs (only adds with deterministic IDs), or the source S3 bucket (read-only presigned).
- All endpoints except `/api/health` require `Authorization: Bearer <ADMIN_BEARER_TOKEN>`.

**Data governance**
- Writes two indexes with deterministic/idempotent IDs: `nrs-lectures-auto-transcribe` (`{uuid}_{lang}`, all languages, whole text) and `ask-nrs-lectures` (`{uuid}_chunk_{index}`, English only, chunked+embedded).
- English persisted to OpenSearch immediately after cleanup, BEFORE translation — EN stays queryable if a later stage fails.
- Honors the sibling repo's skiplist (`../ask-niranjana-swami/scripts/lib/transcript-skiplist.txt`) — skiplisted UUIDs never written, even when explicitly requested.
- Transcript store is OpenSearch-only since PR #3 (DynamoDB dual-write collapsed; `nrs-transcribe-jobs` stays for ephemeral job state).

**Architecture**
- **Transcription: Groq Whisper large-v3 PRIMARY, Deepgram Nova-3 fallback — non-negotiable for NRS Sanskrit content.** Empirical: Deepgram nova-3 outputs 0 IAST and silently erases Sanskrit verses; Whisper outputs 84–981 diacritics per lecture. The README architecture diagram and the `transcribe.ts` top comment saying "Deepgram primary" are STALE — the code and this ruling are Groq-first. Deepgram acceptable only for pure-English content.
- **Never fall back to OpenAI `whisper-1`** — English-only mode strips all diacritics and kills the verse-restore ceiling. Groq rate-limit fallbacks: serial submission (stay under 7,200 s/hr) or Replicate (paid).
- Gemini not adopted: RECITATION filter blocks scripture-aware prompts (a content-policy single point of failure) and neutral prompts output 0 IAST.
- Cleanup = Claude Sonnet; prompt is a copy of ask-niranjana-swami's `fetch-lectures.ts` prompt so style matches the 2,700+ transcript corpus. Anti-refusal contract for short clips shipped in PR #5 (2026-06-22) — the sibling `fetch-lectures.ts` copy is NOT yet synced.
- **Lecture opening rule**: NRS lectures open "Hare Kṛṣṇa. Good morning, dear devotees. All glories to Śrīla Prabhupāda." Whisper often drops/garbles it — restore it in post-cleanup review ("All glories…" comes AFTER "dear devotees").
- Pipeline order (fixed): download → transcribe → Sonnet cleanup → persist EN → verse-restore (offline, see sibling repo) → summary → RU/UK translate → chunk/embed → index → deliver.
- **Summary generation**: read `scripts/SUMMARY_PROMPT.md` (hybrid Evernote/deep-citation format, 2026-07-19) before generating any lecture summary.
- **Russian translation style (v3, devotee-edited 2026-07-16)**: Cyrillicize ALL Sanskrit incl. names and terms (Кришна, лила, джива — Latin only for verse refs like SB 1.2.6); "обрел милость" not "получатель милости"; always "святая дхама"; «мысли с собой» for takeaways; devotional register. The prod `RUSSIAN_PROMPT` in `src/lib/pipeline/translate.ts` still says "keep IAST / don't Cyrillicize" — it is OUTDATED and needs updating to this rule.
- 2-minute audio chunking in the transcription pipeline, per empirical testing. (2026-07-16)
- Deepgram KEYTERMS deliberately exclude common chant words (Krishna, Hare, Rama) — boosting them makes Nova-3 hallucinate chant tails.
- Delivery: SES email (from `noreply@askacarya.com`, DKIM-verified domain — never a gmail sender, it spam-filters) + admin UI polling + optional callback.

**Cost policy**
- ~$0.05/lecture transcribe-only; ~$0.46–0.76 full (EN + RU/UK + index). Groq primary is free within quota.

**Parked items**
- Wire verse-restore into the prod orchestrator behind a `restore_verses` flag (currently offline post-processing).
- Update `RUSSIAN_PROMPT` to the v3 devotee-edited style (above).
- Sync the anti-refusal cleanup prompt back into sibling `fetch-lectures.ts`.
- Fix the stale "Deepgram primary" comment in `transcribe.ts` + README diagram.
- Groq quota strategy for multi-lecture batches (serial vs Replicate vs self-hosted).

## Related
- `PIPELINE.md` — stage-by-stage detail
- `../ask-niranjana-swami/DECISIONS.md` — sibling app register (two-index contract lives there too)
- `../verse-restore/DECISIONS.md` — verse restoration module

## 2026-07-28 — verse-restore lives HERE (single home)

**Decision** (Dina Gauranga Prabhu): verse-restore belongs in this repo. `src/lib/pipeline/verse-restore.mjs` is the one implementation; `corpus.json` is the one corpus. The standalone `../verse-restore/` repo and `../nrs-pipeline-lambda/src/verse-restore.mjs` are legacy copies — do not fix logic there.

**Why**: three diverging copies caused a silent production failure. Today's measurement: production restored ZERO verses on the 2026-07-23 Hungary lecture while finding the correct match in 5 of 6 cases and discarding each — because the port came from the old lambda copy, missing the prayer-matching table, and its threshold (0.40) is stricter than the standalone's (0.35).

**To port in (from ../verse-restore/, do not re-derive)**:
1. Fuzzy maṅgalācaraṇa matcher — `looksLikeMangalacarana()` in restore.ts (commit d183935): exact probes, then n-gram Jaccard scoped to prayer-keyed corpus entries only (`/praṇāma|mantra|namaskāra/`), accept at ≥0.15 with ≥0.05 lead over runner-up, ≥8 trigrams. Bypasses the general threshold; safe because the pool is 6 known prayers and a real scripture verse scores 0.05 against it.
2. Spoken-reference extraction — `extractReferences()` ("Volume 1, Chapter 4, Text 24" → BB 1.4.24).
3. Corpus builder + harnesses: import-from-askacarya.py, test-pranama-fuzzy.mjs, test-corpus-ab.py, eval-threshold.py.

**Do NOT**: loosen the general scripture Jaccard threshold — swept over 7 real lectures, precision peaked ~57% near 0.25 and the gains in the 0.20–0.35 band were almost entirely these same opening prayers. Fix prayers deterministically instead.

**Open**: `isVerseLine()` is too strict (≥3 IAST chars AND ≥0.4/word) — badly-mangled verses like BB 91 are never examined. Raw Whisper output puts entire prayers on one line mixed with English (e.g., line 11 of `bb_hungary_jul23_raw.md` — all 6 prayers + lecture text on a single line), so `isVerseLine()` never fires. In production this is masked: Sonnet cleanup splits prayers onto separate lines before verse-restore runs. Loosen only with the harness measuring precision.

## 2026-07-28 — Prayer matcher wired as FALLBACK, not primary

**Decision**: `looksLikeMangalacarana()` fires only when the general corpus Jaccard score is below 0.40. Prevents false positives where a scripture verse weakly matches a prayer (BB 92 partial text scored 0.1574 against Guru-praṇāma due to shared trigrams `guruṁ`/`girim`).

**Flow in autoRestoreFromCorpus**:
1. General corpus match (all 26k+ entries)
2. Score ≥ 0.85 → already_canonical, skip
3. Score ≥ 0.40 → containment check → auto-restore (general path)
4. Score < 0.40 → try `looksLikeMangalacarana()` → prayer-restore if matched; else skip

**Why**: BB 92's general score is 0.46 — correct match. If prayer ran first, it would replace BB 92 with Guru-praṇāma (wrong). As a fallback, prayer only fires for genuinely unmatched garbles like the Pañca-tattva mantra garble (general score 0.24 → falls through to prayer match).

**Measured on cleaned file**: 4 substituted (BB 89-90 general, Pañca-tattva prayer, BB 92 general, BB 95 general) + 6 already_canonical. Zero false positives. Regression test: 23/23.

**Evidence note (2026-07-28)**: the live Jul 09 pipeline run validated the pipeline end-to-end but did NOT exercise the prayer fallback — that guru-praṇāma garble scored 0.48, above 0.40, so it took the general path. The fallback's evidence is the Jul 23 cleaned file (Pañca-tattva 0.24 → recovered via fallback; BB 92 0.46 → correctly stayed general) plus the 23/23 regression suite. Do not read "verified on a live lecture" as covering the fallback path.

**Observed (2026-07-28)**: Sonnet cleanup fixed 11 of 12 verses on Jul 09 before verse-restore ran. Verse-restore is the safety net for what cleanup misses, not the primary restorer — weigh future tuning effort accordingly.

## 2026-07-28 — Corpus writes require explicit per-run permission

**Decision** (Dina Gauranga Prabhu): no script writes to `corpus.json` until (a) all tests pass and (b) he gives permission for that specific run. Dry-run + test output is presented for review first; the write is a separate, explicitly-approved step. Applies to `import-acarya-books.py`, `import-from-askacarya.py`, and any future corpus builder.

**Why**: the 2026-07-28 tier-2 import wrote 11,753 duplicate entries before being tested, and had to be reverted from backup.

## 2026-07-28 — Tier-2 ācārya-book import: BLOCKED, approach is unsound

**Finding**: verse_map regions record where a region SITS in a book, not the identity of the verse printed at its head — because ācārya commentaries quote verses from elsewhere. So "region location = verse ref" is invalid. Proof: the importer wanted to file *karma-jaṁ buddhi-yuktā hi phalaṁ tyaktvā manīṣiṇaḥ* as **BG 18.51**; that text is already in the corpus as **BG 2.51**, where it belongs. Test battery (`scripts/test-acarya-import.py`, T6) detected **1,520 such ref-mismatches** out of 1,352 proposed entries — SB 1,305, BB 187, BG 28. The remaining ~627 are merely unverifiable, not verified.

**Decision**: `import-acarya-books.py` must NOT write to the corpus using region-derived refs. Ever. A wrong key is worse than a missing verse: it asserts a false citation AND hides the correct entry from the matcher — the same damage class cleaned out of production earlier today.

**What IS sound**: the text extraction itself (T5 passed on all 1,352 — verse-shaped, IAST-dense, no English bleed) and the verse-shape gate (rejects commentary-only regions).

**Two defensible paths if this is revisited**:
1. Ref-free entries — store with `source` and a synthetic key, asserting no scripture citation; verse-restore's content-match fallback finds them by similarity anyway.
2. A book's OWN verses only — where a work prints "Text N" within its own numbering (Caitanya-bhāgavata's verses, Bṛhad-bhāgavatāmṛta's verses), not verses it quotes. Smaller yield, defensible refs.

**Also fixed on the way** (kept for whichever path is taken): key formatter now emits the corpus's real shapes — `SB 1 3.28` (canto SPACE chapter.verse), `CC Madhya-līlā 8.128` (līlā NAME), `BG 2.13`, `BB 91` — instead of the invented `SB 1.3.28` that caused the 11,753-duplicate revert. CB/HBV/sandarbhas are skipped: no established key shape exists yet, and guessing one is how this went wrong.

**Wiki as a verse source — measured and rejected (2026-07-28)**: the vault's 4,568 verse pages carry trustworthy refs (`section_ref`), which is exactly what the region-derived approach lacked — but only 1,246 contain any Sanskrit, and 1,133 of those are verses already held from Prabhupāda's BBT files. Of the 113 "new" refs, nearly all turned out to be ācārya COMMENTARY quotes with embedded IAST terms, not verse text (e.g. SB 9.24.53 → "Svayam means Kṛṣṇa is not an aṁśa."). The wiki is a commentary index built on top of verse refs, not a verse repository. Only genuine lead: BRS (Bhakti-rasāmṛta-sindhu, 46 pages, Rūpa Gosvāmī — absent from the corpus entirely) — check whether those pages hold verse text before counting on it.

**Standing gap**: the previous ācāryas' own verses are not in machine-readable, correctly-referenced form anywhere in our system. Absent from corpus; wiki holds commentary not verses; book regions give wrong refs. Cheapest real win = Śikṣāṣṭaka (8 verses, quoted in nearly every lecture, absent everywhere) — hand-entered and cross-checked against the corpus's CC copies.

## 2026-07-28 — Śikṣāṣṭaka: aliases + named-work labelling

**Done**: Mahāprabhu's eight verses now exist as corpus keys `Śikṣāṣṭaka 1..8` — ALIASES copying the exact text of CC Antya-līlā 20.12/16/21/29/32/36/39/47 (Prabhupāda's BBT edition). Nothing typed from memory; `scripts/add-siksastaka.py` verifies each source opens with the expected words and refuses to overwrite. Corpus 26,555 → 26,563. Backup: ~/backups/verse-restore/corpus-pre-siksastaka-*.json.

**Tie-break added**: aliased verses score IDENTICALLY, so iteration order decided the label — a Śikṣāṣṭaka quote was being cited as "CC Antya-līlā 20.21". `NAMED_WORK` now wins exact ties (Śikṣāṣṭaka + the praṇāmas/mantras). A strictly better score still wins outright; a genuine CC verse keeps its CC label (tested).

**Spoken references**: `extractReferences()` recognises "Śikṣāṣṭaka 3", "Siksastaka verse 8", "Shikshashtakam 1". Matching is done on a folded copy — JS `\b` does not treat "Ś" as a word char, and the anglicised spelling uses `sh` digraphs, so both forms failed a naive regex.

**Known inert**: `extractReferences()` is exported but NEVER CALLED inside the deterministic module — spoken-reference lookup is not wired into `autoRestoreFromCorpus()`. The function is correct and tested; wiring it (deciding which garble a nearby reference belongs to) is a separate, riskier change.

**Honest scope note**: the aliases add no matching power — the identical CC text already matched (mangled v3 → 0.71 both before and after). What they add is the correct LABEL and a key for spoken references.

Tests: `scripts/test-verse-restore.mjs` 29/29 (was 23).

## 2026-07-31 — corpus.json: BB 1.2.30-36 + Padma Purāṇa + Śruti verse added

BB 1.2.30-36 (7 verses) were missing due to flat-key collision — "BB 30" matched Chapter 1 verse 30 not Chapter 2. Added with explicit "BB 1.2.N" keys. Also added Padma Purāṇa nāmāparādha verse (score 0.66) and Śruti "brahmaṇā saha" verse (score 0.78). Total corpus: 26,564 entries.

## 2026-07-31 — verse-restore.mjs: `[unverified citation]` tag path + isVerseLine fix

Two improvements from BB retranscription batch:

1. **`isVerseLine` word-boundary fix**: `\b` in JS matches inside hyphenated Sanskrit compounds (`jñāna-karmādy-anāvṛtam` → false `\ban\b` hit). Switched to whitespace-split + Set lookup. Eliminates false English detection on compound Sanskrit lines.

2. **`[unverified citation]` tag matching**: new secondary entry in `autoRestoreFromCorpus()` — when Sonnet's cleanup stage already flagged a garbled verse with `[unverified citation]`, gather lines below the tag as a verse block (even if `isVerseLine` fails) and try corpus matching at 0.30 threshold (lower than the 0.40 general gate, justified because the tag is high-confidence signal that a verse IS present).

## 2026-07-31 — Transcript tagging: Bengali songs + Whisper artifacts

Garbled Bengali songs/kīrtana that cannot be corpus-matched get `[Bengali kīrtana — audio unclear]` or `[Bengali bhajan — Gaurāṅga prayer, audio unclear]` instead of `[unverified citation]`. Whisper hallucination loops (repetitive syllable artifacts) get `[closing kīrtana — Whisper transcription artifact]`. Speaker's own admission of mis-recollection gets `[speaker's incomplete recollection]`. These tags are more informative than generic `[unverified citation]` and don't imply a fixable verse.

---

## 2026-07-28 — Match gate: 0.35 WITH a length guard, not a bare gate drop

**Rejected first**: swapping the metric. Compared jaccard / dice / containment / lcs_ratio on 9 hand-labelled real garbles (`scripts/eval-metric.py`). Dice is Jaccard rescaled (Dice = 2J/(1+J)) — identical ranking, adds nothing. Containment (5/7) and lcs_ratio (3/7) are WORSE: lcs matched the English sentence "And so the devotees were very much pleased" to SB 12.2.12 at 0.79. Current metric already ranks the correct verse top-1 in 7/7. **The metric was never the problem; the gate was.**

**Rejected second**: dropping the gate to 0.25-0.30. `scripts/eval-gate.py` harvested all 128 Sanskrit-looking blocks from 17 transcripts. A bare drop admits 6 corruptions where Mahārāja simply says **"Hare Kṛṣṇa."** as a greeting — 9 chars scoring 0.35 against the 68-char Mahā-mantra — plus the dvādaśākṣara mantra mislabelled as SB 1.5.37 at 0.30 (same length, different verse).

**Decision**: gate is **0.40 normally, 0.35 when the heard span is ≥40% of the verse's length**. Every correct band match measured 47-84% of its verse length; the false one was 13%. Containment-skip floor moved to 0.35 to match. Result: +4 correct BB verses across these lectures, zero known false positives.

**Still refused, knowingly**: SB 6.17.28 (0.27) and BB 91 (0.25) — correct top-1, too low for any safe scalar gate, because the wrong-verse SB 1.5.37 match sits at 0.30 with a 0.95 length ratio. Reaching those needs the detection classifier (local char n-gram model over corpus positives vs transcript English) or a margin rule — NOT a lower gate.

Tests: `scripts/test-verse-restore.mjs` 32/32 (was 29), incl. the greeting and dvādaśākṣara negatives.

## 2026-08-01 — Cleanup chunking: praṇāma hallucination root cause + fix

**Root cause**: `cleanupTranscript()` splits raw text into ~12K-char chunks at sentence boundaries and sends each independently to Claude. The cleanup prompt's Rule 2 ("restore canonical praṇāma at transcript opening") fires on EVERY chunk because each looks like a standalone transcript. Result: fabricated praṇāma prayer blocks at every chunk boundary mid-lecture. 15 of 35 BB files affected (all files > 12K raw chars). Raw Whisper output contains ZERO praṇāma text — 100% LLM fabrication.

**Fix**: pass chunk index to the prompt. Chunks 2+ get a continuation preamble telling the LLM NOT to apply Rule 2. Only chunk 1 (actual transcript start) gets the opening-prayer restoration.

**Decision**: fix the pipeline first, then re-run all affected files through the corrected pipeline. Do NOT manually patch existing transcripts — full re-run preferred for consistency.

## 2026-08-02 — Brahma-saṁhitā Ch.5 corpus + 3 verse-restore fixes

**corpus-seeds.json**: all 62 BS 5.x verses added (transliteration + translation from vedic-scriptures-library MCP, vedarama/BSST edition). MCP reference format = bare verse number (no chapter prefix). Transliterations cleaned: blank lines between verse lines collapsed to `\n`. Total seeds: 96 entries (BS 62 + Padma Purāṇa + Nārada-pancarātra + CC + SB + Caitanya-candrāmṛta + BB flat-key mismatches).

**Fix 1 — bhakta→devotee COMMON_SUBS removed**: was corrupting Sanskrit compounds. "gaura-bhakta-vṛnda" → "gaura-devotee-vṛnda" in Pañca-tattva mantra. Removed entirely — no safe regex boundary for Sanskrit compounds.

**Fix 2 — Pañca-tattva "jaya" prefix restored**: corpus.json canonical text was missing "jaya" prefix → verse-restore stripped it from 3 files. Fixed canonical to: "jaya śrī-kṛṣṇa-caitanya prabhu-nityānanda…"

**Fix 3 — CC_KEY tiebreaker**: within 0.02 Jaccard, prefer non-CC match over CC. Prevents BS verses from being labelled as their CC alias. Also added PRAYER_ALIAS exclusion for CC Ādi-līlā 12.2 (duplicate of Pañca-tattva-mantra keyed under CC).

**Other**: displayReference citation format fix (SB 1 2 → SB 1.2), lecture opening restoration handles split header lines.

Commit: `54bdfe0`, pushed to main.

**Fix 4 — Closing-chant false positive** (commit `346c1db`): multi-prayer closing lines (e.g. "Jaya Śrī Kṛṣṇa Caitanya…Hare Kṛṣṇa…Jaya Śrīla Prabhupāda kī jaya") were falsely matched to Pañca-tattva mantra or CC Antya 9.2 in the 0.35–0.40 Jaccard band. Root cause: length ratio guard only had lower bound (≥ 0.40). Added upper bound ≤ 1.50 — heard text 60% longer than canonical = not a garble of that verse. Also hardened CC_KEY tiebreaker to only fire for same-verse aliases (Jaccard between candidate texts ≥ 0.80). Final stats: 241 restored, 8 canonical, 241 identified across 35 BB files.

## 2026-08-02 — Evaluating gpt-4o-transcribe: standalone test script, not a pipeline swap

User wants to try OpenAI's `gpt-4o-transcribe` as a possible alternative/addition to Groq Whisper-large-v3 (current primary) / Deepgram nova-3 (fallback).

**Decision**: build `scripts/test-gpt4o-transcribe.ts` as an isolated comparison script (runs both providers on the same audio, saves outputs side by side to `~/Downloads`). Do NOT wire into `transcribe.ts`'s provider enum or change pipeline defaults until results are reviewed — this is an evaluation step, not a swap.

**Supporting change**: exported `SANSKRIT_PROMPT` from `src/lib/pipeline/transcribe.ts` (was module-private) so the test script reuses the same Vaiṣṇava term/verse list instead of duplicating it. Zero behavior change to the production pipeline.
