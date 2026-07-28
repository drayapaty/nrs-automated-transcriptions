# Decisions Register — nrs-automated-transcriptions

**Summary**: Standing decisions for the NRS transcription service. Read before re-deciding anything. Append-only; newest first. Complements `README.md` / `PIPELINE.md`.

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
