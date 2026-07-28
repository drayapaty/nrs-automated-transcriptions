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

## 2026-07-28 — Match gate: 0.35 WITH a length guard, not a bare gate drop

**Rejected first**: swapping the metric. Compared jaccard / dice / containment / lcs_ratio on 9 hand-labelled real garbles (`scripts/eval-metric.py`). Dice is Jaccard rescaled (Dice = 2J/(1+J)) — identical ranking, adds nothing. Containment (5/7) and lcs_ratio (3/7) are WORSE: lcs matched the English sentence "And so the devotees were very much pleased" to SB 12.2.12 at 0.79. Current metric already ranks the correct verse top-1 in 7/7. **The metric was never the problem; the gate was.**

**Rejected second**: dropping the gate to 0.25-0.30. `scripts/eval-gate.py` harvested all 128 Sanskrit-looking blocks from 17 transcripts. A bare drop admits 6 corruptions where Mahārāja simply says **"Hare Kṛṣṇa."** as a greeting — 9 chars scoring 0.35 against the 68-char Mahā-mantra — plus the dvādaśākṣara mantra mislabelled as SB 1.5.37 at 0.30 (same length, different verse).

**Decision**: gate is **0.40 normally, 0.35 when the heard span is ≥40% of the verse's length**. Every correct band match measured 47-84% of its verse length; the false one was 13%. Containment-skip floor moved to 0.35 to match. Result: +4 correct BB verses across these lectures, zero known false positives.

**Still refused, knowingly**: SB 6.17.28 (0.27) and BB 91 (0.25) — correct top-1, too low for any safe scalar gate, because the wrong-verse SB 1.5.37 match sits at 0.30 with a 0.95 length ratio. Reaching those needs the detection classifier (local char n-gram model over corpus positives vs transcript English) or a margin rule — NOT a lower gate.

Tests: `scripts/test-verse-restore.mjs` 32/32 (was 29), incl. the greeting and dvādaśākṣara negatives.
