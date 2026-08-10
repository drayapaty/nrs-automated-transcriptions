# Session Handoff — 2026-08-02

Drop this file into the new chat so Claude has full context.

## Project

`nrs-automated-transcriptions` — transcription pipeline for H.H. Niranjana Swami's lectures. Groq Whisper → Claude Sonnet IAST cleanup → deterministic verse-restore. Runs locally via MCP server in Claude Desktop, or via Vercel serverless (sibling repo `ask-niranjana-swami`).

## What was done today (2026-08-02)

### Code changes (all committed + pushed, 3 commits on main)

1. **62 Brahma-saṁhitā Ch.5 verses** added to `corpus-seeds.json` (96 total seeds now). Built via `scratchpad/build-bs-seeds.mjs` using vedic-scriptures-library MCP.

2. **verse-restore.mjs fixes** (single home at `src/lib/pipeline/verse-restore.mjs`):
   - Removed `bhakta→devotee` from COMMON_SUBS (was corrupting Sanskrit compounds like "gaura-bhakta-vṛnda")
   - Fixed Pañca-tattva canonical text: added "jaya" prefix in `corpus.json`
   - CC_KEY tiebreaker: added Jaccard ≥ 0.80 alias guard at both sites (~line 272, ~line 361) so tiebreaker only fires for same-verse aliases
   - Length ratio upper bound ≤ 1.50 at line 416 — prevents multi-prayer closing chants from false-matching

3. **Commits**: `54bdfe0` (BS seeds + fixes 1-3), `55f7623` (DECISIONS.md), `346c1db` (Fix 4: closing-chant false positive)

### Pipeline run

- **35 BB files** re-run through verse-restore v4 with all fixes
- Output at `~/Downloads/bb-retranscribe/pipeline-v4-bs-fixes/` (35 `*_restored.md` files)
- Final stats: 241 restored, 8 canonical, 241 identified, 0 false positives

### Deployment package

- `~/Downloads/nrs-deploy-2026-08-02/` contains:
  - `nrs-automated-transcriptions.zip` (1.9MB, git archive of HEAD at `346c1db`)
  - `brihad bhagavatamrita-v2.epub` (1.5MB)
  - `DEPLOY-CHECKLIST.md` — full setup instructions + troubleshooting

### Reproducibility investigation (RESOLVED)

Why Maharaja's machine produced different output — 3 causes found:
1. **Old cleanup prompt** (Jul 30 tar.gz) had "FIRST 3 PARAGRAPHS ONLY" praṇāma rule. New code: "PRESERVE IN PLACE" + continuation-chunk guard.
2. **Stale `.env.local`** might have `CLAUDE_MODEL=claude-sonnet-4-5` (old .env.example default). New code defaults to `claude-sonnet-4-6`. Fix: recreate .env.local with ONLY `GROQ_API_KEY` + `ANTHROPIC_API_KEY`.
3. **Missing Claude Desktop Project Instructions** — without them, Claude Desktop summarizes/reformats output. Instructions: "When I ask you to transcribe or translate, use the nrs-transcribe tools. Return only the output file paths and timing. Do not summarize, interpret, or comment on the lecture content."

## Pending items

### Tomorrow (deploy day)
- [ ] Deploy zip + checklist to Maharaja's Mac Mini via Claude Desktop
- [ ] Verify transcription works correctly on Maharaja's machine
- [ ] Test with a known lecture, check IAST + verse restoration + praṇāma placement

### After deploy verification
- [ ] Index 35 restored transcripts from `pipeline-v4-bs-fixes/` into production (OpenSearch + DynamoDB) — these are the BB retranscriptions with all fixes applied
- [ ] Task #74: Awaiting Maharaja's email → add to ALLOWED_EMAILS in Vercel + redeploy ask-niranjana-swami
- [ ] Task #78: Sync cleanup prompt to sibling repo `ask-niranjana-swami/scripts/fetch-lectures.ts` (prod is correct via PR #20, but sibling's local copy may be stale)

### BB lecture processing workflow (not yet automated)
User's 4-step workflow for Bṛhad-bhāgavatāmṛta lectures:
1. **Transcribe** — NRS pipeline (done, `/transcribe` skill)
2. **Summarize** — create summary (spec at `scripts/SUMMARY_PROMPT.md`, not yet automated as skill)
3. **Comparative analysis** — feed Gopiparanadhana Prabhu's BB commentary (epub: `brihad bhagavatamrita-v2.epub`) + lecture summary into Claude → extract points NOT covered in Gopiparanadhana Prabhu's commentaries
4. **Write** — compose final output based on extracted unique insights

Steps 2-4 are candidates for skill/automation creation.

### Voice prints — not yet wired into pipeline
- 3 reference audio files at `~/Downloads/voice_prints/`: `niranjana_swami_ref.mp3`, `dhanurdhara_swami_ref.mp3`, `jagadish_ref.mp3`
- `~/Downloads/maharaja_voice_samples.txt` — text corpus samples from published books
- Need to: copy into repo (`data/voice-prints/`), wire into `src/lib/pipeline/diarize.ts` via Deepgram speaker enrollment API
- Purpose: automatic speaker identification in conversation transcriptions instead of manual `--speakers 0:Name,1:Name` mapping

### Known low-priority issues in verse-restore
- File 33 (1_2_81_88): mixed vāsudevāya/vyāsadevāya mantras collapsed
- File 8: BB 24-25 verse duplication from split garble
- 3 files: spurious [unverified citation] tags
- File 31: guru-praṇāma mis-restored as CC 17.80
- File 33: second praṇāma stanza fabricated

## Key files

| File | Purpose |
|------|---------|
| `src/lib/pipeline/verse-restore.mjs` | Deterministic verse restoration (single home) |
| `corpus-seeds.json` | 96 hand-curated verses (BS 62 + others), merged at load time |
| `corpus.json` | ~26,500 auto-generated corpus entries |
| `src/lib/pipeline/cleanup.ts` | Claude Sonnet IAST cleanup prompt |
| `src/lib/pipeline/transcribe.ts` | Groq Whisper with SANSKRIT_PROMPT (line 24-38) |
| `scripts/transcribe-cli.ts` | Standalone CLI runner for Mac / Claude Desktop |
| `mcp-server.mjs` | MCP server for Claude Desktop (delegates to transcribe-cli.ts) |
| `SETUP-CLAUDE-DESKTOP.md` | Install instructions for Maharaja's machine |
| `DECISIONS.md` | Standing decisions register — read before re-deciding anything |

## Uncommitted changes in working tree

These are WIP from prior sessions. Safe to leave as-is. Do NOT commit without reviewing each one. The deploy zip was built from `git archive` at `346c1db` — none of this is in the zip.

**Modified (small):**
- `DECISIONS.md` — +2 lines (Fix 4 closing-chant entry added this session)
- `CLAUDE.md` — 1-line tweak
- `transcribe.ts` — 1-line (`const` → `export const` for SANSKRIT_PROMPT, needed by test-gpt4o script)
- `orchestrator.ts` — +12 lines (strip-fabricated-pranama integration, WIP)
- `batch-reclean.ts` — +11 lines

**Untracked (new files from prior sessions):**
- `strip-fabricated-pranama.ts` — praṇāma fabrication detector (WIP)
- `ZOOM-PIPELINE.md` — Zoom pipeline spec (in-progress design doc)
- `test-gpt4o-transcribe.ts` — GPT-4o evaluation script (standalone, not wired into pipeline)
- `fix-review-findings.py` — one-off review fix script
- `corpus-pre-liturgy-*.json` — pre-liturgy corpus backup
- `SESSION-HANDOFF-2026-08-02.md` — this handoff doc

## Deploy results (2026-08-03, Maharaja's Mac Mini)

- Pipeline runs successfully. Verse-restore: 10 restorations on first real lecture (5 prayers + 5 verses).
- **yt-dlp 403 on YouTube tool** — YouTube bot detection blocks yt-dlp periodically. Not our bug. Workaround: download audio manually → use `transcribe_file`. Fix options if needed: `yt-dlp --update`, or `--cookies-from-browser safari` flag.

## Constraints (always active)

- Never modify existing files when generating output
- Never delete/move/rename files or purge data stores without explicit per-file permission
- Never commit credentials to git
- Back up datetime-stamped before any bulk change
- Do NOT loosen general scripture Jaccard threshold
- Corpus expansion requires explicit per-run permission
- Never fall back to OpenAI whisper-1 (kills Sanskrit ceiling)
- Lecture opening: always "Hare Kṛṣṇa. Good morning, dear devotees. All glories to Śrīla Prabhupāda."
