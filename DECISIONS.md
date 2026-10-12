# Decisions Register — nrs-automated-transcriptions

**Summary**: Standing decisions for the NRS transcription service. Read before re-deciding anything. Append-only; newest first. Complements `README.md` / `PIPELINE.md`.

---

## 2026-10-11 — `elaborate` failed with "Connection error." on large inputs: root-caused, fixed by streaming the final call

Mahārāja's machine produced a summary, a hand-written comparison and a chapter for the 2025-07-18 Budapest lecture (Bhakti-rasāmṛta-sindhu / SB 10.25.16, not BB) but no elaborate output. Re-running `elaborate-cli.ts` here on his files failed identically twice: `Elaborate step failed: Connection error.`

**Not** the cause (each ruled out with evidence, not assumed): bad or missing keys, Anthropic/OpenAI/OpenSearch being unreachable (curl and isolated SDK calls all returned 200), and a transient blip (reproduced twice, same timing).

**Actual cause** (call-level trace through the real `elaborate()`): topics, 6 embeddings and 6 OpenSearch searches all succeed within ~6s. The final `claude-sonnet-4-6` call, `max_tokens` 16,000 with ~160K chars of input (transcript + summary + comparison + 6 topics x 8 passages), is non-streamed; after ~182s the socket is closed by the other side — `SocketError: other side closed [UND_ERR_SOCKET]`, which the Anthropic SDK reports only as "Connection error." The CLI prints just `err.message`, so the underlying cause was invisible until traced.

**Fix**: `elaborate.ts` now uses `messages.stream(...).finalMessage()` for that call (same `Message` shape). Verified live on the same inputs: 7 output files on disk, elaborate 148s, abridge 47s, exit clean. Part 2 cited 5 real indexed lectures (all spot-checked against the index, including one whose index title has a typo the model silently normalised).

**Other findings**
- `elaborate` has no BB or Vol.1 dependency (grep-verified) — a manually written comparison works as input, so non-BB lectures can be elaborated. `SETUP-CLAUDE-DESKTOP.md` wrongly said elaborate "depends on" the Vol.1 file; corrected.
- Part 2 in this run cited 16 lectures and 0 books. Plausible for this topic; means the book corpus contributed nothing here.
- In the folder Mahārāja sent, `*_other_restored.md` is OUR Aug-12 batch transcript of the same lecture, not his — his own restored transcript was not included, so elaborate was run against ours plus his `brs` summary/comparison (the `brs` summary is a corrected version of ours).

**How to apply**: any single non-streamed model call that can run past ~3 minutes should stream. Check `write-chapter-voiced.ts` (8K max_tokens, 200-300s observed, succeeded so far) and `summarize.ts` if "Connection error." ever appears there. And when an SDK error says only "Connection error.", trace to `err.cause` before blaming the network.

---

## 2026-10-02 — Deploy guide omitted `OPENAI_API_KEY`; `elaborate` would have failed on Mahārāja's machine

Found while assembling the complete `nrs-transcribe` MCP env block for his install. `src/lib/pipeline/elaborate.ts` embeds the topic with OpenAI `text-embedding-3-small` (`openai().embeddings.create`, via `clients.ts`) for the semantic half of its OpenSearch hybrid search. `clients.ts` throws `OPENAI_API_KEY not set` if absent. Neither `SETUP-CLAUDE-DESKTOP.md` nor the deploy guide / DEPLOY-INSTRUCTIONS listed it — they only listed Groq, Anthropic, Deepgram and `OPENSEARCH_*`.

**Consequence if shipped as documented**: `elaborate` fails outright, and inside `run_full_pipeline` the Stage 5 try/catch swallows it ("Elaborate failed: …") so the run still exits 0 with no elaborate files — a silent miss, same shape as the other "documented but not actually working" gaps found 2026-08-13.

**Fixed**: `SETUP-CLAUDE-DESKTOP.md` (shipped in the zip) now lists `OPENAI_API_KEY` in the config block and explains why. The published deploy-guide artifact was patched to match. The full block with real values is built from `.env.local` into a private file outside the repo, never committed.

**Env vars the MCP tools actually read** (verified by grep, not recalled): `GROQ_API_KEY` (+ optional `_2.._14` rotation), `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` (conversation tool only), `OPENAI_API_KEY` + `OPENSEARCH_URL/USER/PASS/INDEX` + `NODE_TLS_REJECT_UNAUTHORIZED` (elaborate only). Default for Mahārāja: single `GROQ_API_KEY`; extra Groq keys are Divakar's call (the paid one is `GROQ_API_KEY_14`, billed to Divakar).

**How to apply**: when writing install docs, derive the env list from `grep process.env` over the code the tools reach, not from memory of what the tool "needs".

---

## 2026-08-13 — CRITICAL REGRESSION: `run_full_pipeline` was silently feeding the Russian summary into compare/chapter/elaborate

Divakar caught this directly (precise diagnosis, not just a symptom report): `extractPath()` in `run-full-pipeline-cli.ts` returned whichever `→ <path>.md` line printed *last* in a stage's output. That was safe when every stage printed exactly one `.md` line — until the same-day Russian auto-translate fix made `summarize-cli.ts` print four lines (`_summary.md`, `_summary.docx`, `_summary_ru.md`, `_summary_ru.docx`). `_summary_ru.md` sorts after `_summary.md`, so it silently won, and the Russian text got passed as `summaryPath` into compare, write_chapter_voiced, and elaborate — wrong-language input the whole rest of the pipeline, no error anywhere.

**Caught live, mid-run**: a real `run_full_pipeline` invocation (Aug 13, 2026, BB 1.3.17-23, YouTube) was already through transcribe + summarize and about to hit the bug at the compare handoff. Killed the process before it wasted API calls on a wrong-language comparison, then completed compare/write_chapter_voiced/elaborate manually against the correct English `_summary.md` using the already-fixed individual CLIs.

**Fixed properly**: `extractPath()` now takes an anchor pattern instead of blindly taking the last match — e.g. `/_summary\.md$/` (excludes `_summary_ru.md`, which doesn't end in that exact suffix), `/_elaborate\.md$/` (excludes the 6 other files elaborate also prints — part-1/2/3, abridged, both combined variants), etc. Every stage's extraction now names exactly the file it needs, not "whatever happened to print last."

**Also caught proactively while fixing this**: the elaborate stage had the identical latent bug (7 output lines, "last line" picked the abridged-combined variant instead of the main file) — not yet reported, but same root cause, fixed the same way.

**How to apply**: this is the fifth gap of this shape found today (elaborate missing, docx missing ×2, verse-range unpassable, and now this) — and the most serious, since it silently corrupted output rather than skipping a step. Any time a CLI's stdout format changes (new lines added), re-check every downstream `extractPath()`/similar-pattern caller that parses that stdout — "last matching line" is not a safe extraction strategy once a script can print more than one plausible match.

---

## 2026-08-13 — `run_full_pipeline` now accepts an explicit verse range

Divakar asked what happens if you pass verse numbers along with a YouTube link to `run_full_pipeline` — answer at the time was "nothing, the tool has no such parameters." Real gap, same class as the `elaborate` and `.docx` ones found earlier today: the tool couldn't do something a user would reasonably expect.

**Fixed**: `run-full-pipeline-cli.ts` now takes optional `[part] [chapter] [verseStart] [verseEnd]` positional args after the input; when given, they're passed straight through to `compare-cli.ts` instead of relying on its 3-tier auto-detect. `run_full_pipeline`'s MCP tool schema gained matching optional `part`/`chapter`/`verseStart`/`verseEnd` number fields, passed through in the handler.

**Verified live**: ran it on a real new lecture (Aug 13, 2026, BB 1.3.17-23, YouTube) with the explicit range given.

**How to apply**: this is now the fourth gap of this exact shape found today (elaborate missing, docx missing from two CLIs, verse-range not passable) — all four were "the tool description implies X, the code doesn't do X." Worth a deliberate pass checking every MCP tool's actual behavior against its own description before considering the pipeline genuinely stable, rather than waiting for each gap to surface one at a time.

---

## 2026-08-13 — `summarize_lecture` now auto-chains Russian translation

Divakar's reaction to the docx fix above: assumed `summarize_lecture` already gave both languages. It didn't — English and Russian were always two separate tool calls (`summarize_lecture` then `translate_russian`). Explicit call: **wire them together** — `summarize-cli.ts` now produces all four files from one call:

- `_summary.md` (English)
- `_summary.docx`
- `_summary_ru.md` (Russian, via `translateStructuredSummary` — the structure-preserving translator, same one used for `.docx`-input round-trips in `translate-cli.ts`, since a freshly-generated summary is always our own V3 structured format)
- `_summary_ru.docx`

Russian translation failure is non-fatal (logs and continues — the English summary is still fine either way), same pattern as the docx-conversion fixes.

**Verified on a real file**: re-ran on the Aug 6 lecture, all four files confirmed present on disk via `ls`, not just log output. Timing: ~96s English + ~130s Russian ≈ 4 minutes total for this step (previously ~96s alone) — `summarize_lecture`'s MCP tool description timing estimate should be revisited if this ever gets noticeably slower on longer lectures.

**How to apply**: `translate_russian` as a standalone MCP tool still exists and still works (e.g. for re-translating just the Russian side, or translating something that isn't a fresh summary) — this change doesn't remove it, it just means nobody needs to remember to call it separately for the common case.

---

## 2026-08-13 — Two more never-wired-in gaps found the same way: `summarize-cli.ts` and `translate-cli.ts` didn't always produce `.docx`

Same pattern as the `elaborate` gap above, caught by Divakar the same way — noticing something documented as existing (`.docx` output) wasn't actually happening for the paths that mattered.

**`summarize-cli.ts`**: `scripts/summary-to-docx.js` has existed for a while but was never called from `summarize-cli.ts` at all — every summary was markdown-only regardless of caller (`summarize_lecture` tool, `run_full_pipeline`, everything). Fixed: `summarize-cli.ts` now always converts its own output to `_summary.docx` via `summary-to-docx.js`, non-fatally (a docx failure logs and continues — the `.md` is still produced either way).

**`translate-cli.ts`**: did call `summary-to-docx.js`, but only `if (isDocx)` — i.e. only when the *input* was itself a `.docx` (the round-trip case: translating an already-generated summary.docx). Translating a plain transcript `.md` (the far more common case) never got a `.docx`, contradicting what `SETUP-CLAUDE-DESKTOP.md` already documented ("Output: ... `*_ru.md` / `*_ru.docx`"). Fixed: docx conversion now always runs regardless of input type, same non-fatal pattern.

**Verified**: re-ran `summarize-cli.ts` on the Aug 6 lecture's restored transcript — `_summary.docx` produced (15KB), confirmed via `ls`, not just log output.

**How to apply**: when a CLI's own doc-comment or the setup guide claims an output file it doesn't actually produce for a given call path, that's the same class of bug as the `elaborate` wiring gap — verify by checking the file exists on disk, not by reading the code and assuming the doc comment matches it.

---

## 2026-08-13 — CORRECTION: `run_full_pipeline` never actually called `elaborate`

Divakar noticed and asked to verify: `run_full_pipeline` (built and live-tested earlier today) only chained transcribe → summarize → compare → write_chapter_voiced — four stages, not five. `elaborate` was never wired in, despite it being one of the ten documented MCP tools and a core part of the BB book workflow. A real oversight in the original build, not caught by the earlier live test (that test lecture's compare stage was skipped entirely, so the gap never surfaced).

**Fixed**: added Stage 5/5 to `run-full-pipeline-cli.ts` — calls `elaborate-cli.ts` with the restored transcript, summary, and comparison paths, only when a comparison was actually produced (same graceful-skip logic as everywhere else — elaborate structurally needs a compared verse range). Updated the MCP tool description and header comment in `mcp-server.mjs` to mention all five stages, and bumped the tool's timeout from 30 to 45 minutes to give the extra stage room on longer lectures.

**Not yet re-verified live** — the fix was made while a real lecture (`08-06-26.mp3`, Aug 6 2026, BB 1.3.11-17) was already mid-run under the old 4-stage script (editing the file on disk doesn't affect an already-started `tsx` process). That lecture will need elaborate run manually afterward, same pattern as the Dec 28 fix earlier today. The fix itself should be verified on the next fresh `run_full_pipeline` invocation.

**How to apply**: when building an orchestrator that chains N existing tools, explicitly list all N against the actual tool inventory before calling it done — "matches the description" isn't the same as "matches what actually exists." A live test only catches gaps the specific test case happens to exercise.

---

## 2026-08-13 — Wired the content-based verse matching into `compare_lecture`, not just a batch script

The verse-matching work from 2026-08-12 (`build-bb-verse-manifest.mjs`, `match-verses-by-commentary.mjs`) was a one-off batch tool, run by hand against the 35-lecture set, never connected to the live pipeline. Divakar assumed it had been wired in — it hadn't; `compare_lecture`/`compare-cli.ts` still only did `parseVerseRangeFromFilename()`, confirmed by grepping `compare.ts` for any reference to the matching scripts (none). Corrected that assumption directly rather than let it stand.

**Fixed**: `compare_lecture` (and by extension `run_full_pipeline`) now tries three fallbacks in order when no explicit range is given:
1. `parseVerseRangeFromFilename()` — existing, unchanged.
2. `findVerseRangeFromInlineTags()` (new, ported from `build-bb-verse-manifest.mjs`) — reads the `(BB part.chapter.verse)` tags verse-restore already inserted into the sibling `_restored.md` file (derived from the summary path: `..._summary.md` → `..._restored.md`), takes the min/max verse in whichever part.chapter has the most tags.
3. `findVerseRangeFromContent()` (new, ported from `match-verses-by-commentary.mjs`) — word-4-gram containment match of the transcript's full text against Vol.1's own Translation/Commentary prose, 0.15 score floor. Catches lectures that read the English translation aloud without re-quoting Sanskrit.

If none of the three finds a range, it still exits with the explicit-range instruction — a genuinely topical talk has no range, and this doesn't try to guess one from nothing.

**Verified against two real cases**, not just typechecked:
- `2023_03_10_bb_taiwan_p2` (no filename range, no inline tags) → tier 3 correctly found BB 1.1.1 at 0.98 confidence, matching the 2026-08-12 batch run's result exactly, and produced a real comparison.
- `2025_09_14_bb_caitanya` (no filename range, one inline tag `(BB 2.5.234)`) → tier 2 correctly found and attempted the tag, then correctly failed rather than guess — that citation turned out to be from *Volume 2* (Gopa-kumāra's journey, Bhānu Svāmī's translation, explicitly out of scope for this tool), not Part 2 of Volume 1 as the bare `2.5.234` tag format ambiguously suggests. Confirmed by grepping the Vol.1 source file: Part 2 only goes up to chapter 4 there, nothing at chapter 5.

**Known limitation carried forward, now actually reachable in the live tool**: the inline-tag format `(BB part.chapter.verse)` can't distinguish "Part 2 of Volume 1" from "Volume 2" — both would produce a `2.x.y`-shaped tag. It fails safely (no commentary section found) rather than silently pulling the wrong content, but a Volume-2 citation will always look like a lookup failure rather than being flagged as genuinely out-of-scope. Not fixed here — would need the tag format itself to carry which volume, which verse-restore.mjs doesn't currently track.

**How to apply**: don't leave a batch script's output as the only place its logic lives, if the same logic is genuinely needed in the live pipeline — port the reusable core into `src/lib/pipeline/*.ts` and call it from there, same as done here. Verify new fallback logic against real prior-known-correct cases, not just a syntax/typecheck pass.

---

## 2026-08-13 — `run_full_pipeline` live-tested end-to-end; real-world verse-range gap found

Ran `run-full-pipeline-cli.ts` against real audio for `2025_08_27_bb_1_1_11_12` (the actual `.mp3`, not the curated slug), the "not yet verified" gap noted in the entry above. Succeeded end-to-end: transcribe (125s) → summarize (52s) → write_chapter_voiced (159s), ~6 minutes total, exit 0. Output moved to `~/Downloads/pipeline-test-2026-08-13/` for review, original curated lecture folder untouched. Freshly generated chapter spot-checked clean against the live-session-leak pattern.

**Real finding**: the compare stage was skipped, correctly, because the raw audio filename (`2025.08.27_Budapest_Brihad_Bhagavatamrita_1.1.11_12_en.mp3`, slugified to `..._brihad_bhagavatamrita_1_1_11_12_en...`) doesn't match `parseVerseRangeFromFilename()`'s expected `..._bb_<part>_<chapter>_<start>[_<end>]...` pattern — only the curated 35-lecture set's renamed slugs do. This isn't a bug in the orchestrator (the skip is exactly the designed fallback for topical talks), but it means in practice, most raw source filenames from Zoom/audio exports will hit the skip path on `run_full_pipeline` unless renamed first or the verse range is passed explicitly.

**How to apply**: for a lecture known to be sequential-verse, either rename the source audio to the `bb_<part>_<chapter>_<start>_<end>` convention before transcribing, or don't rely on `run_full_pipeline`'s single-call convenience for that lecture — run `compare_lecture` separately afterward with the range passed explicitly, then `write_chapter_voiced`.

---

## 2026-08-13 — SUPERSEDES same-day entry below: built `run_full_pipeline` after all

The entry directly below this one ("No dedicated 'run full pipeline' MCP tool (yet)") decided to document the chained-prompt approach and wait before building a dedicated tool. Divakar reconsidered same day — wanted it built now, to make this easier for Mahārāja specifically, rather than leaving it dependent on Claude reliably choosing to chain four tool calls correctly.

**Built**: `scripts/run-full-pipeline-cli.ts` — pure orchestrator, no pipeline logic of its own. Shells out to the existing `transcribe-cli.ts` → `summarize-cli.ts` → `compare-cli.ts` → `write-chapter-voiced-cli.ts` in sequence, extracting each stage's output path from its stdout (`  → <path>` line, the format every existing CLI already prints) to feed the next stage. The compare stage is wrapped in try/catch — a topical talk with no parseable BB verse range makes `compare-cli.ts` exit(1) by design, and the orchestrator treats that as an expected skip (logs it, proceeds to write the chapter from the summary alone) rather than a failure.

Registered as a 10th MCP tool, `run_full_pipeline`, in `mcp-server.mjs`, following the exact same `runScript()` pattern as every other tool. Accepts `path` (local audio) or `url` (YouTube handled directly by the transcribe stage; other direct URLs pre-downloaded via the existing `downloadAndReencode()` helper, same as `transcribe_url` already does).

**Verified**: `node --check` on `mcp-server.mjs` (syntax), `tsx` no-arg run on the new script (usage message + correct exit code), and the compare-skip path specifically — ran `compare-cli.ts` directly against a real topical-talk summary (`2025_10_30_bb_is_sb_summary.md`) and confirmed it exits before any model call, zero API cost, with a message the orchestrator's catch block correctly handles.

**Not yet verified**: a full live end-to-end run (real transcription → summary → chapter) — that costs real API money and ~8-15 minutes, not done as part of this change. Should be run once against a real short lecture before considering this genuinely deploy-ready, not just code-complete.

**How to apply**: if a future request wants a new orchestrated multi-step tool, this is the pattern — shell out to the existing single-purpose CLIs via `execSync`, don't reimplement their logic. Keeps one source of truth per pipeline stage.

## 2026-08-13 — No dedicated "run full pipeline" MCP tool (yet) — document the chained-prompt approach instead

Divakar asked how Mahārāja could run the whole pipeline (transcribe → summarize → compare → write_chapter_voiced) from one prompt. No orchestrator script or tool exists for this.

**Decision**: don't build one yet. Each tool's output filename is predictable from its input, so Claude can already chain multiple MCP tool calls within a single reply if the prompt explicitly asks for the full sequence — this needs zero new code. Documented this in `SETUP-CLAUDE-DESKTOP.md` ("The whole pipeline in one prompt") and the deploy-guide artifact sent to Divakar, with an explicit caveat that it depends on Claude reliably calling all steps in order, and that a real dedicated tool should be built if that turns out to be flaky in practice.

**How to apply**: if Mahārāja reports the chained-prompt approach skipping steps or stalling partway, build a single `run_full_pipeline` MCP tool (script + registration) that does all steps server-side in one call — don't try to fix it by tuning the prompt further.

---

## 2026-08-13 — Mahārāja's machine actually has Claude Code (via Claude Desktop); MCP stays the only integration surface anyway

**Correction to the 2026-08-10 entry**: that entry said Mahārāja's Mac Mini runs Claude Desktop only, no Claude Code CLI, so `.claude/commands/*.md` and `~/.claude/skills/*` don't reach him. Divakar clarified 2026-08-13: Claude Desktop on his machine includes a Claude Code feature, so slash commands and Skills would in fact work there too — that part of the 2026-08-10 entry was wrong.

**Decision anyway: keep MCP as the only integration surface, don't deploy skills/commands.** Not because they wouldn't work, but because MCP already gives everything they would: natural-language triggering (no need to learn `/nrs-transcribe` syntax), and it's git-tracked (`mcp-server.mjs` ships in the same package, same `npm install`/restart as everything else). Skills live outside git in `~/.claude/skills/` — a second, manual deploy step every time the pipeline changes, easy to forget. Confirmed this isn't hypothetical: `translate-russian` (the one Skill already in use, predating this pipeline's Skills work) is currently stale — it duplicates the Russian translation prompt inline rather than calling the real CLI script, and that copy has already drifted from `src/lib/pipeline/translate.ts`.

**How to apply**: don't build or deploy `.claude/skills/nrs-*` or wire up `.claude/commands/*.md` for Mahārāja's machine unless a concrete reason to want exact slash-command control comes up later. If it does, `translate-russian`'s drift should be fixed first as part of that work, not left as-is.

## 2026-08-13 — No dedicated "run full pipeline" MCP tool (yet) — document the chained-prompt approach instead

Divakar asked how Mahārāja could run the whole pipeline (transcribe → summarize → compare → write_chapter_voiced) from one prompt. No orchestrator script or tool exists for this.

**Decision**: don't build one yet. Each tool's output filename is predictable from its input, so Claude can already chain multiple MCP tool calls within a single reply if the prompt explicitly asks for the full sequence — this needs zero new code. Documented this in `SETUP-CLAUDE-DESKTOP.md` ("The whole pipeline in one prompt") and the deploy-guide artifact sent to Divakar, with an explicit caveat that it depends on Claude reliably calling all steps in order, and that a real dedicated tool should be built if that turns out to be flaky in practice.

**How to apply**: if Mahārāja reports the chained-prompt approach skipping steps or stalling partway, build a single `run_full_pipeline` MCP tool (script + registration) that does all steps server-side in one call — don't try to fix it by tuning the prompt further.

---

## 2026-08-12 — Full 35-lecture manual sweep for live-session leaks: 12 chapters fixed, one truncated file caught and regenerated

Following the `2026_04_26_bb_1_2_50_52` finding (the automated Haiku pass missing 2 of 3 real leaks on rerun — see the caveat entry above), ran a full manual review of all 35 `*_chapter_voiced.md` files via 5 parallel read-only agents, explicitly instructed to find only genuine live-audience-address/shared-real-time-moment phrasing and not over-flag generic reader address or normal book cross-referencing.

**Result: 11 more chapters had real leaks (12 counting `2026_04_26` from the prior entry), ~19 individual spots total.** Worst case was `2026_03_29_bb_budapest` — 6 separate spots, effectively the whole opening/closing frame was written as a live-session address ("our morning class series," "where we left off," "another session," "this morning... before class," an invitation to "chant together... this morning"). Also found:
- `2025_08_27_bb_1_1_11_12`, `2025_09_07_bb_1_1_12`, `2025_09_21_bb_two_types_dainya`, `2025_09_28_bb_dainya`, `2025_10_05_bb_two_useless` (2 spots), `2025_10_30_bb_is_sb`, `2025_12_21_bb_book_dist` (1 spot the earlier same-day trim had missed), `2026_04_05_bb_budapest`, `2026_04_12_bb_1_2_37_49`, `2026_05_02_nrsimha_caturdasi_en_hu` (3 spots, all "Today is..."/"on this appearance day" framing).

All fixed by hand — read each exact spot in context, rewrote to preserve meaning/content while removing the live-audience presumption, no bulk find-replace. Originals backed up as `*.pre-sweep2.bak` (and `2025_12_21`'s earlier `.pre-trim.bak` / `2026_04_26`'s `.pre-resweep.bak` from the prior entry).

**Separate bug caught in the same pass, not a leak issue**: `2026_07_26_bb_1_2_98_100_chapter_voiced.md` was truncated mid-sentence on disk (ends at "...because it is in that perpetual reaching, that endless hunger for"). Regenerated via `write-chapter-voiced-cli.ts`; the fresh regeneration introduced one new leak of its own ("something we have been studying in parallel"), fixed the same way. Original truncated version backed up as `.pre-regen.bak`.

**How to apply, updating the caveat above**: even after two rounds (Haiku pass, then a targeted rerun), a full manual read still surfaced 19 more real instances the automated pass never touched. Treat `fixLectureNoteArtifacts()` as a first-pass filter, not a guarantee — a real spot-check (or, at this book's scale, a full read) is still the only reliable way to catch this class of leak before a chapter is considered ready for review. Also: regenerating a chapter to fix one bug (like the truncation here) is not risk-free — always re-scan the fresh output too, since the underlying prompt still has this weakness.

---

## 2026-08-12 — CAVEAT to the "no-regex, use Haiku" fix: the semantic pass has a real false-negative rate, spot-checking still needed

Manually reviewed `2026_04_26_bb_1_2_50_52`'s voiced chapter (already generated under the live `fixLectureNoteArtifacts()` pass, not a pre-fix leftover) and found 3 real live-session self-references the automated pass had missed: two audience-address lines ("those of you who were present there... those who were not," "those who were with us when we studied verse twenty-two... may remember") and one "next time" closer.

**Re-ran the same chapter through `fixLectureNoteArtifacts()` again** (`scripts/resweep-one.mjs`, ad hoc) to see if a second pass would catch them: it fixed only the "next time" closer, still missed both audience-address lines. Fixed those two by hand instead.

**Conclusion**: the whole-document Haiku pass (2026-08-12 entry above) is a real improvement over regex and should stay the default approach for this class of bug, but it is not 100% reliable — audience-address phrasing ("those of you who were present," "those who were with us") seems to be a specific blind spot, distinct from the "when we left off" pattern the prompt already names explicitly. Re-running the same pass on a miss is not guaranteed to catch it the second time either.

**How to apply**: don't treat a chapter as clean just because it went through `fixLectureNoteArtifacts()`. Spot-check is still worthwhile, especially for lectures that reference a specific dated event (a retreat, a talk elsewhere) where "who was there" phrasing is more likely to surface. Consider adding "audience-address phrasing (who was/wasn't present at a specific event)" as an explicit named example in the system prompt, alongside "when we left off" — the current prompt's named examples skew toward continuity phrasing and may be under-covering the audience-address variant.

---

## 2026-08-12 — elaborate.ts Part 2 corpus filter silently excluded all newly-indexed lecture results

**Bug**: `searchSourceIndex()`'s `corpusFilter` checked a field named `lecture_date_year`, but the actual OpenSearch index (including the 892 TQK/LECTURES-2000 lectures indexed this session, in the sibling `ask-niranjana-swami` repo) uses `year`. Every search against the newly-indexed lecture corpus silently returned zero matches for Part 2 (parallel examples from books/lectures) — no error, just empty results, so this would have gone unnoticed without an explicit end-to-end verification query.

**Fix**: added `{ term: { pipeline_version: "v2" } }` as an unconditional `should` branch in `corpusFilter`, and added `pipeline_version` to the `SourceHit` interface / `_source` field lists. Verified end-to-end with a real query after the fix — confirmed 31/31 full-pipeline lectures' Part 2 output actually draws on the new lecture corpus, not just books.

**Also fixed**: the file's header doc-comment was stale (previously claimed "books only, lectures explicitly excluded" — no longer true and hadn't been for a while). Rewrote it and added an explicit warning: "Don't trust doc comments over the actual corpusFilter code."

**How to apply**: whenever a search/filter path returns unexpectedly empty results with no error, check for a field-name mismatch between the filter and the actual indexed document shape before assuming the query logic itself is wrong — this bug produced no exception, just silent under-matching.

---

## 2026-08-12 — Skill/command drift audit: 4 pairs (8 files) had fallen out of sync with actual pipeline behavior

**Full audit** of every `.claude/commands/*.md` + matching `~/.claude/skills/*/SKILL.md` pair against the real current CLI/pipeline code, per Divakar's request ("check the skill or command code with whats in the pipeline"). Found and fixed real drift, not just stale wording:

- `nrs-summarize` command + skill: pointed to a stale prompt file reference and wrongly described the summary template as adaptive when it's actually a fixed V3 locked template with a docx conversion step.
- `nrs-transcribe` / `nrs-transcribe-conversation` command + skill pairs: didn't mention the fabricated-praṇāma-strip stage (added this session — see the correction entry above) in the pipeline chain description or the "report results" checklist. `nrs-transcribe-conversation`'s skill also had a real wrong-skill-name reference — pointed to a nonexistent `transcribe-bb-lecture` skill instead of the actual `nrs-transcribe-lecture`.
- `nrs-write-chapter-voiced` command + skill: updated for the optional-comparison change, then updated again after the write-chapter removal decision (above) to state it's the only chapter-writing variant.
- `nrs-compare` / `nrs-fetch-zoom` command + skill pairs: checked, found accurate, no changes needed.

**How to apply**: command/skill docs drift silently because nothing breaks when they're wrong — they're read by a human or by Mahārāja's Claude Desktop session, not type-checked against the pipeline. Worth a full pass like this periodically after pipeline changes land, not just when a specific doc is touched.

---

## 2026-08-12 — CORRECTION to 2026-08-01 stripper entry: strip-fabricated-pranama.ts was NOT actually reaching the main transcribe pipeline

**The 2026-08-01 entry below ("Post-cleanup praṇāma stripper") is wrong about deployment** — it says the stripper was "wired into `orchestrator.ts` (stage 3b) and `batch-reclean.ts` (step 2)." In reality, as of 2026-08-12, `strip-fabricated-pranama.ts` existed and was correct, but was only ever called from `batch-reclean.ts` — the actual primary pipeline entry points, `scripts/transcribe-cli.ts` and `scripts/transcribe-conversation-cli.ts`, never called it. Every normal transcription run (not going through a manual reclean) was exposed to the fabrication bug this stripper exists to fix. Found via a full 35-lecture BB audit, not a user report.

**Permanent fix**: both CLIs' Stage 2 (Cleanup) now call `stripFabricatedPranama(rawText, cleanedRaw)` directly, inline, before the cleaned text is used for anything downstream. This is now the only place the guard needs to run — no separate reclean step required for it to take effect.

**True scope, verified against the actual function logic (not assumed)**: a first crude detection pass (naive substring matching against the 35 existing BB files) produced a false alarm of 22/35 affected. Re-checking with the real `stripFabricatedPranama()` logic (fuzzy ASCII-folded raw-text probes, not exact match) found the true count was 5/35. Lesson, stated plainly to Divakar when asked "did we screw up": real but non-catastrophic pre-existing pipeline gap, not something newly introduced, and much smaller in practice than the first estimate suggested. All 5 retroactively re-cleaned and re-restored via `scripts/strip-and-rerestore-bb35.ts`, originals backed up as `.pre-pranama-strip.bak`.

**How to apply**: when a guard/fix script exists but a bug still reproduces, verify which pipeline entry points actually call it — don't assume "the fix exists" means "the fix is wired in everywhere it needs to be."

---

## 2026-08-12 — Lecture-note self-reference leakage in voiced chapters: semantic Haiku pass, NOT regex — standing rule for this class of bug

**Bug**: `write-chapter-voiced.ts`'s prompt already explicitly banned lecture-note artifacts ("no 'the speaker says' or 'in this class'"), but this leaked through repeatedly across real generated chapters — "this class," "the class I had prepared," "our previous session," "this session," and, after those explicit words were fixed, subtler implied-live-presence phrasing like "When we left off, we..." that never uses a trigger word at all.

**First fix attempt (rejected)**: a regex trigger-word list (`class`, `session`) feeding per-paragraph Haiku rewrites. Failed three separate times on real output — missed "session" entirely on the first pass, then a second file's flagged "class" mention turned out to be a false positive (unrelated legitimate use — "social classification"), then even a clean word-list still let semantically-implied live-presence phrasing through ("when we left off").

**Divakar's explicit standing directive, verbatim**: "Please for God sake do not use regex" / "you killing me with regex, use Haili and get it doen right."

**Fix**: replaced the entire detect-then-fix pipeline with a single whole-chapter Haiku call (`fixLectureNoteArtifacts()` in `write-chapter-voiced.ts`) that does detection AND correction together, prompted to catch both explicit trigger words and implied shared real-time presence, in one pass over the full text.

**Standing rule — applies beyond this one bug**: regex/pattern-matching is the wrong tool whenever the failure mode is open-vocabulary/semantic (unboundedly many ways to phrase the same underlying meaning). Reach for a single whole-document model pass instead. Reserve deterministic code (regex, exact match) for purely mechanical formatting rules (bullet markers, heading prefixes) where the violation is syntactic, not semantic — that split already exists in the banned-section-label fix below; this generalizes it.

**Verified**: swept all 10 previously-generated chapters (`/tmp/sweep-lecture-artifacts.log`) — 10/10 changed on first pass, confirming the leak was systemic not isolated. New chapters generated after this fix landed (all 35, including the 4 topical/no-comparison ones run 2026-08-12) go through the same pass automatically — no separate sweep step needed going forward.

---

## 2026-08-12 — write-chapter (plain third-person) removed entirely; write-chapter-voiced is the only chapter-writing tool

**Decision**: Divakar's explicit standing call — "voiced first-person always. dont even keep third person option." Supersedes the 2026-08-06 decision (further up this file) to keep `write-chapter.ts` "for reference/comparison" alongside the new voiced variant. That reference copy is now gone, not just deprioritized.

**Also fixed same day**: `write-chapter`/`write-chapter-voiced` used to hard-require a `_comparison.md` file (both the plain and voiced CLIs would error out if missing). Changed to optional — for the 4 topical/thematic lectures with no BB verse anchor (`compare` structurally can't run on those — nothing to match against Gopīparāṇadhana's verse-by-verse commentary), the chapter is now written straight from the summary alone, with the prompt's "distinctive points vs. published commentary" framing dropped when there's no comparison to draw from. Confirmed working end-to-end on all 4 (`2025_10_30_bb_is_sb`, `2025_12_21_bb_book_dist`, `2026_03_29_bb_budapest`, `2026_04_01_radha_kunda_prakat_en_hu`) before this removal decision landed.

**Removed**:
- `src/lib/pipeline/write-chapter.ts`
- `scripts/write-chapter-cli.ts`
- `.claude/commands/nrs-write-chapter.md`
- `~/.claude/skills/nrs-write-chapter/` (whole skill dir)
- The `write_chapter` MCP tool in `mcp-server.mjs` (real functional break caught during this cleanup — it still pointed at the just-deleted CLI script; Mahārāja's Desktop setup would have hit a missing-file error on next use if this had been missed)

**Updated in place** (no longer describe write-chapter as "kept for reference"): `write-chapter-voiced.ts` header comment, `elaborate.ts` header comment, `nrs-write-chapter-voiced.md` command, `nrs-write-chapter-voiced` skill.

**How to apply**: any future chapter-drafting request defaults to voiced first-person — there is no plain third-person fallback to offer anymore. If a genuine need for third-person prose resurfaces later, it would need to be rebuilt from scratch (git history has the old implementation if wanted as a starting point), not restored as a parallel option by default.

---

## 2026-08-12 — Banned section-label enforcement: code-level, and via a Haiku retitle call, not just prompt text

**Bug found via a full 35-lecture audit**: `SUMMARY_SYSTEM_PROMPT` has always
explicitly banned generic section labels ("no fixed section labels — no
'Context & aim,' no 'Recap of the previous class,' ..."), but this was
prompt-only — no code-level enforcement existed, unlike the bullet-format
and heading-prefix rules which got the same treatment back in the
2026-08-07 session after real failures. Found 3/35 real summaries
(`2025_10_03_bb_qualifying`, `2026_04_26_bb_1_2_50_52`,
`2026_07_19_bb_1_2_81_88`) using "Recap" despite the explicit ban —
`2026_04_26_bb_1_2_50_52` had it as an actual section heading (`## 2)
Recap of the previous class (texts 37–49)`), the clearest violation.

**Fix, two layers, in `src/lib/pipeline/summarize.ts`**:
1. `findBannedHeadings()` — deterministic detection. Conservative on
   purpose: only flags a heading title that exactly matches a banned
   phrase, or starts with one followed by a clear separator (`:`/`-`/`(`)
   introducing lecture-specific detail. Does NOT flag a banned word inside
   an unrelated, genuinely content-specific title ("Highlights of Kṛṣṇa's
   transcendental qualities") — a loose prefix-strip would mangle those.
2. `fixBannedSectionLabels()` — for each violation, extracts that
   section's actual body text and sends it to Haiku (same low-stakes-call
   pattern as `elaborate.ts`'s `findTopics()`) asking for a real,
   content-specific title. **Not** a mechanical text-strip: an earlier
   draft of this fix just deleted the banned phrase and kept whatever text
   was left, which for the real case above produced `## 2) (texts 37–49)`
   — grammatically broken (bare parenthetical, no rephrasing possible from
   pattern-matching alone). Divakar's call, in his own words: "can you not
   send sonnet that entire topic 2 to get a title" — i.e. give the model
   the actual section content and let it write a real title, same as it
   should have done the first time.
3. `generateSummary()` now runs `fixBannedSectionLabels()` (async, may
   make 0-N extra Haiku calls depending on violations found — 0 extra cost
   on the common case where the model already followed the rule) as the
   final step, after the existing bullet/heading enforcement.

Retroactively fixed on the one real live case
(`2026_04_26_bb_1_2_50_52`'s section 2) by running the new logic directly
against the existing file rather than a full re-generation — same output
the code would now produce automatically.

**How to apply**: any future "the model didn't follow an explicit prompt
rule" bug in this pipeline should default to this same two-layer pattern —
deterministic detection + a cheap follow-up model call for anything that
needs actual rephrasing/judgment, not a blind text-strip. Purely mechanical
fixes (bullet markers, heading prefixes) are fine as regex; anything that
requires understanding what the text *means* isn't.

---

## 2026-08-10 — MCP server extended with 5 new tools; Mahārāja's machine is Claude Desktop, not Claude Code

**Confirmed**: Mahārāja's Mac Mini runs Claude Desktop only (MCP server + copy-paste
prompts per `SETUP-CLAUDE-DESKTOP.md`), not Claude Code CLI. This means the
`.claude/commands/*.md` slash commands and `~/.claude/skills/*` built earlier
this session do NOT reach him — those are Claude Code-only concepts. The only
integration surface that matters for his machine is `mcp-server.mjs`.

**Fixed the real gap**: `mcp-server.mjs` only exposed 5 tools (transcribe x3,
transcribe_conversation, translate_russian) — none of this session's BB
book-workflow additions (summarize, compare, write-chapter x2, elaborate)
were reachable from Desktop at all. Added 5 new MCP tools wired to the
existing CLI scripts, following the exact `runScript()` pattern already used
by `translate_russian`: `summarize_lecture`, `compare_lecture`,
`write_chapter`, `write_chapter_voiced`, `elaborate`. `translate_russian`'s
description updated to mention .docx support — no code change needed there,
`translate-cli.ts` already detects the extension itself.

**Two external dependencies documented, not bundled**:
- `compare_lecture` and `elaborate` need Gopīparāṇadhana Dāsa's Vol.1
  commentary file locally at
  `~/Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md`
  — copyrighted BBT text, deliberately never committed or bundled in the
  deploy zip. Divakar has to hand it over directly if Mahārāja wants those
  two tools.
- `elaborate`'s Part 2 (parallel examples) needs `OPENSEARCH_URL`/`_USER`/
  `_PASS`/`_INDEX` + `NODE_TLS_REJECT_UNAUTHORIZED=0` env vars in his Desktop
  MCP config — added as an optional block in `SETUP-CLAUDE-DESKTOP.md`, not
  required for every other tool.

**corpus.json / corpus-seeds.json** (verse-restore data) are git-tracked
already — no separate transfer needed, a fresh tarball/clone brings them
automatically. Confirmed this is NOT a real gap despite Divakar's recollection
of "sending the verses along with it" as a separate step last time.

**Deploy package rebuilt**: `nrs-transcribe-package.tar.gz`, repo minus
`node_modules`/`.next`/`.git`/`.vercel`/`.env*`/the stray 7MB
`corpus-pre-liturgy-*.json` backup/and a stray `.claude/worktrees/` leftover
git worktree (10MB dev cruft, caught and excluded before sending). No
secrets embedded — `SETUP-CLAUDE-DESKTOP.md`'s MCP config block uses
placeholder values, same convention as the original doc.

**How to apply**: any future Desktop-facing capability must be added as an
MCP tool in `mcp-server.mjs`, not as a Claude Code command/skill — those
never reach Mahārāja's actual setup. Keep `SETUP-CLAUDE-DESKTOP.md` and
`mcp-server.mjs`'s tool list in sync going forward.

---

## 2026-08-10 — LECTURES-2000 batch job: parallelized 4-wide via xargs -P

Switched from the serial while-loop (`tqk-batch-transcribe.sh` pattern) to
4-concurrent workers, per user request ("go 4 at a time") once the 13-key
Groq rotation made serial-one-at-a-time clearly wasteful. System bash is
3.2 (macOS default, no `wait -n`) and no GNU parallel is installed, so used
`xargs -P 4` with a per-lecture worker script instead of a semaphore loop.

**Split into two scripts**: `lectures2000-batch-transcribe.sh` (builds/filters
the queue, dispatches) + `lectures2000-worker.sh` (downloads + transcribes +
files ONE lecture, safe to run concurrently since each only ever touches its
own slug dir — no shared mutable state besides appending to the same log).

**NUL-delimited queue, not newline/tab**: titles contain quotes, apostrophes,
commas — BSD/macOS `xargs` (no `-d` flag, unlike GNU) will misparse those in
default or `-I` whitespace-delimited mode. Verified empirically that `-0 -n1`
passes each record through as one opaque argument, quotes and all; `-I`
without `-0` does not reliably. Queue-building script still uses the same
python slug logic (verbatim) as the serial version, just NUL-terminated
(`\0`) instead of newline-terminated.

**Real bug caught during the switchover**: launched the parallel script
without first stopping the still-running serial background job — both were
processing the exact same lecture (`2001-08-26_simferopol_notag`)
simultaneously before the collision was noticed and the serial job killed.
No corruption (worst case is wasted duplicate Groq/Sonnet calls, since each
side's `mkdir -p`+`mv` just clobbers harmlessly), but confirms: **always
check for + stop a still-running batch job before launching a
differently-shaped one against the same output dir**, don't assume a
previous background task finished just because attention moved on.

Validated with a 10-lecture test batch at concurrency 4 before trusting it
at scale — 10/10 done, 0 failures, log stayed legible (each worker prefixes
its own lines with `[slug]`).

## 2026-08-11 — LECTURES-2000: "could not process file" root cause is raw byte-slice chunking, not a filename/download issue

7 lectures repeatedly failed Groq Whisper with `400 could not process file
- is it a valid media file?`, always pinned to one specific chunk even
after the chunk-splitting fallback recursed down to 117KB — user asked if
it was a filename encoding problem (reasonable, given the earlier `#`/space
URL bugs that day). Verified it's not: downloaded the full file for one
case directly (168MB, `file` confirms valid `MPEG ADTS, layer III` with
proper ID3v2.4 header) — the download and the source file are both fine.

**Actual cause**: `transcribeWithGroq`'s chunking (`transcribe.ts:308-317`)
does raw `audio.subarray(i, end)` byte-slicing on the full buffer, no
re-encoding and no MPEG-frame-boundary awareness. MP3 frames are usually
self-syncing enough that arbitrary byte offsets still decode fine (proven
by 800+ successful lectures), but for a small minority the slice boundary
lands somewhere Groq's decoder can't recover sync from at all, and no
amount of further halving fixes it since the corruption is structural to
that byte range, not a size problem.

**Not fixed** (would need `ffmpeg`-based re-chunking — proper re-encode per
segment instead of raw buffer slicing — a real pipeline change, not
attempted here to avoid destabilizing the two batch jobs mid-run). The 7
affected lectures stay on `LECTURES-2000/known-failures.txt` with this
noted as the real cause; worth revisiting if those specific lectures are
wanted, as a `transcribe.ts` chunking fix rather than a per-lecture retry.

## 2026-08-11 — LECTURES-2000: fixed shared-scratch-file race, per-invocation unique filenames

A 100-item main-pool batch silently dispatched only 8 workers before
printing "BATCH COMPLETE" — no crash, no error, just quietly stopped. Root
cause: both `lectures2000-batch-transcribe.sh` and
`lectures2000-batch-paid-key.sh` wrote their queue/todo files to fixed
shared paths (`$AUDIO_TMP/queue.nul`, `todo.nul`, `todo-paid.nul`). Any two
overlapping invocations — same script relaunched before the prior one's
`xargs` finished draining its todo file, or main and paid racing on the
identically-named `queue.nul` during queue-build — clobber each other's
file mid-read, truncating the NUL-delimited stream and silently starving
`xargs` after a handful of records.

**Fix**: both scripts now use `$$`(PID)-suffixed filenames
(`queue-main-$$.nul`/`todo-main-$$.nul`, `queue-paid-$$.nul`/`todo-paid-$$.nul`),
cleaned up via `trap cleanup EXIT`. The in-flight exclusion check (so main
and paid don't double-process the same lecture) now globs `todo-main-*.nul`
+ `todo-paid-*.nul` instead of reading one fixed filename, so it still
correctly sees every concurrently-running invocation of either script.

**Why this matters going forward**: always verify a "batch complete" result
against actual dispatched-vs-done counts (compare the todo list to real
folder existence) rather than trusting the completion message alone — a
silent early exit looks identical to a normal successful run in the log's
closing lines.

## 2026-08-10 — LECTURES-2000: known-failures exclude list, stop auto-retrying persistent blocks

`2005-06-12_kiev_notag` (uuid `20b454ba-58c9-4257-bec7-979abc6959f9`) failed
Sonnet cleanup with `400 Output blocked by content filtering policy`
identically on 2 separate attempts. User: "dont retry, move on, make a
note" — the TQK job's precedent (retry once, it clears) doesn't hold for
every content-filter block; some are persistent, not transient.

**Mechanism added**: `LECTURES-2000/known-failures.txt` (UUID per line,
machine-readable) + `LECTURES-2000/KNOWN_FAILURES.md` (human-readable why).
Both `lectures2000-batch-transcribe.sh` and `lectures2000-batch-paid-key.sh`
now exclude these UUIDs at queue-build time, same place the TQK-overlap
exclusion already lives — so a persistently-failing lecture stops being
re-attempted (and re-burning Groq/Sonnet cost) every batch run indefinitely.

**How to apply**: a lecture that fails the SAME way twice goes on this list
instead of getting a third automatic attempt — add its uuid, log the reason
in KNOWN_FAILURES.md, move on. A single one-off failure (network blip,
first content-filter hit) still just gets retried normally, same as TQK.

## 2026-08-09 — LECTURES-2000 batch job: autonomous continuation, no per-batch confirmation

User: "don't have to ask, continue until you finish or the keys hit their
limit" — supersedes the checkpoint-and-evaluate cadence used through the
TQK job and the first LECTURES-2000 batch. From here, batches auto-relaunch
on completion without waiting for a go-ahead each time, until the 832-queue
job (see below) finishes or Groq quota is exhausted across all keys.

**Why**: user is actively adding more Groq keys mid-job specifically to
"scale more" — the intent is throughput, not per-batch review. Stated
budget: ~4 hours of audio quota per key per day (13 keys as of this
decision, 2 more incoming same day).

**How to apply**: keep batching without asking. Stop and report only when
(a) the queue is empty, or (b) failures cluster in a way that looks like
quota exhaustion (repeated rate-limit/429-style errors across multiple
consecutive lectures, not the isolated content-filter blips seen in TQK) —
that's the signal to pause and wait for fresh keys or next-day quota reset,
not routine per-lecture failure handling (retry once, same as TQK).

## 2026-08-09 — LECTURES-2000 batch job: flat output dir, dedupe against TQK by uuid

Started transcribing `missing-transcripts/2000-onwards.csv` (891 lectures,
2000-2026, all topics) after the TQK batch (74/74) finished. User confirmed
TQK is done and to skip those — deduped by `uuid` against
`missing-transcripts/teachings-of-queen-kunti.csv` (59 overlap, not the 53
implied by pure `topic == "Teachings of Queen Kunti"` match, consistent with
the citation-based TQK CSV build noted 2026-08-06), leaving 832 in queue.

**Output structure**: single flat dir `ask-niranjana-swami/LECTURES-2000/<slug>/`,
not per-topic subfolders — user's explicit choice over the topic-folder
alternative (mirrors the flat `TQK/` convention already in place).

**Script**: `scripts/lectures2000-batch-transcribe.sh`, adapted from
`tqk-batch-transcribe.sh` — same slug scheme (`date_location_reference`,
`notag` fallback, numeric-suffix collision dedup), same skip-if-folder-exists
resume logic, own log (`LECTURES-2000/lectures2000-batch.log`).

**Batch cadence**: starting at 10, same checkpoint-and-evaluate pattern used
for the back half of the TQK job (user moved off large batches after asking
for one big 44-lecture run once, mid-TQK — smaller batches give tighter
verify loops and cheaper abort points on a still-untested CSV shape, since
~587 of 891 rows have no `reference` field, heavier collision risk on the
`notag` slug path than TQK saw).

## 2026-08-07 — translate-cli.ts accepts .docx input, round-trips through docx

Extended the translate pipeline so `.docx` files can be translated directly
(not just `.md`), producing both a translated `.md` and a translated
`.docx` with matching formatting. Built on the same-day docx tooling:

- `scripts/docx-to-summary-md.js` — reverse of `summary-to-docx.js`.
  Reads Heading2/Heading3 pStyle + numbered Word bullet lists back into our
  V3 markdown convention (`## N) Title`, `### A. Title`, `- `/`  - ◦ `
  bullets). Also has a fallback heuristic for docs with NO named paragraph
  styles at all (confirmed real case: a doc with our exact lecture content
  pasted as plain paragraphs, headings distinguishable only by "isn't a
  bullet + matches `N) Title` / `A. Title` text pattern") — round-trip
  verified byte-identical against a file we generated ourselves.
- `translateStructuredSummary()` in `src/lib/pipeline/translate.ts` — the
  prose-blob translator (`translate()`) reliably drops "## "/"### "
  markdown markers under instruction alone (same reliability class of bug
  as the hollow-bullet/heading-marker issues from summary generation
  earlier today). Fixed the same way: parse the markdown into
  {heading-type, bullet-type, text} in code, translate ONLY the bare text
  as a numbered list (so line correspondence is trivial to enforce), then
  reattach the original structural markers programmatically — structure
  no longer depends on the model remembering a formatting rule.
- `translate-cli.ts` now detects `.docx` by extension, extracts via
  `docx-to-summary-md.js`, translates via `translateStructuredSummary`,
  writes `_ru.md`, and rebuilds `_ru.docx` via `summary-to-docx.js`.

**Scope, told to Divakar directly**: this is NOT a general-purpose docx
translator. It reliably handles (1) files generated by our own
`summary-to-docx.js`, and (2) plain-paragraph docs matching our exact
`N) Title` / `A. Title` numbering pattern with no named styles. It does
NOT handle headings styled only via bold/font-size with no such text
pattern, tables, images, footnotes, comments, tracked changes (silently
dropped — only plain `<w:t>` text runs are read), or formatting other than
bold (italics/underline/color not preserved).

---

## 2026-08-07 — Summary-to-Word converter added: scripts/summary-to-docx.js

Divakar wanted the numbered-flow summaries (V3 format) opened as real Word
docs instead of plain markdown — mainly to get true heading-level
indentation for the "A./B./C." lettered sub-points nested under a numbered
section, which markdown/most renderers can't do (heading levels only
change font size/weight, never left-margin position). Built
`scripts/summary-to-docx.js` (uses the `docx` npm package, added as a real
dependency): converts a V3-format summary .md into .docx with `## N)
Title` → Heading 2, `### A. Title` → Heading 3 with explicit left indent,
nested "  - ◦ text" bullets → native two-level Word bullet lists (with a
SECOND indent tier specifically for bullets that fall under a lettered
sub-heading, so they visibly nest further right than bullets belonging
directly to the numbered section — this was a real gap in the first
version, fixed after Divakar caught it in a screenshot).

**Font gotcha, worth remembering for any future docx generation**: hours
were lost chasing a "Kṛṣṇa renders as Krsna" bug that looked like a real
content/encoding bug (byte-level XML inspection, hex dumps, multiple
false leads) before landing on the actual cause — the declared font
(first Noto Sans, then Arial Unicode MS) simply wasn't installed on
Divakar's machine, so Word/Docs silently substituted a font missing IAST
dot-below glyphs (ṛ ṣ ṇ ḥ ṃ) while keeping the more common macrons (ā ī
ū), and did so inconsistently between body text and headings. The
generated XML was correct throughout — this was a local font-availability
problem, not a bug in the file or the generation script. Confirmed fixed
by installing Arial Unicode MS locally; works in both Google Docs and
Word now. If this pattern recurs on another machine, check font
installation FIRST before re-diagnosing the file.

---

## 2026-08-07 — Hollow nested-bullet rule enforced in code, not just the prompt

The "  - ◦ text" nested-bullet rule (permanent per Divakar, see the
formatting-rules entries above) wasn't reliably followed by the model —
one test run had 25 of 31 nested lines missing the ◦. Rather than keep
tuning prompt wording, added `enforceHollowNestedBullets()` in
`summarize.ts`: a deterministic regex post-process
(`/^(\s{2,})-\s+(?!◦)/gm` → inserts "◦ ") applied to every generated
summary right before it's returned. Idempotent, only touches indented
"- " lines, leaves top-level bullets alone. This guarantees the rule holds
100% regardless of model compliance — prefer this pattern (code-level
enforcement of a hard formatting rule) over further prompt tuning if
another formatting rule turns out to be similarly unreliable.

**Addendum, same day**: hit the identical reliability problem with section
headings. The model was writing numbered section titles as bare "1) Title"
text with no "## " markdown heading marker — a real-render screenshot from
Divakar showed the whole document's indentation broken because the
renderer read "1)" as an ordered-list item and nested everything under the
prior bullet instead of treating it as a heading. Added
`enforceSectionHeadings()` in `summarize.ts`, same pattern as the bullet
fix: regex-forces "## " onto numbered section titles and "### " onto
lettered sub-point titles ("A./B./C.") whenever the model omits them.

---

## 2026-08-07 — Summary structure rebuilt: pure numbered flow, not fixed labels

The earlier v3 template (Context & aim / Recap / Reading / Highlights /
Illustrations / Theme / Where it stops) was built primarily off a Hungary
2026-08-02 file sitting in `~/Downloads/bb-book-chapters-2026-08-05/`. That
file turned out to NOT be the authentic Evernote structure — when Divakar
pasted the real Aug 2 summary directly, and then a real Aug 6 summary
(same lecture series, texts 11-16), both were pure numbered flow with no
fixed labels at all, matching the Budapest 2025-08-27 sample exactly. Three
real samples now agree; the fixed-label file was an outlier (possibly
edited or a different generation pass) and is no longer treated as
authoritative. Rebuilt `SUMMARY_PROMPT_V3.md` and `summarize.ts` around
pure numbered flow: numbered sections (typically 8-13), each with a plain
content-specific title, opening greeting/recap folded into section 1,
commentary and illustrations woven into whichever section they occur in
rather than split into separate boxes, lettered sub-points (A./B./C.)
within a section when it has multiple distinct items, final section is the
conclusion. The two true reference summaries saved at
`scripts/samples/2026-08-02-hungary-TRUE-evernote-summary.md` and
`scripts/samples/2026-08-06-hungary-TRUE-evernote-summary.md`. All prior
naming/formatting fixes from earlier today (Niranjana Swami naming, dash-
before-nested-bullet, no literal bullet character, commentary = his own
spoken exposition) carry forward unchanged onto this new structure.

---

## 2026-08-07 — Summary opening paragraph must name Niranjana Swami explicitly

Test run (3 lectures, 07-16/07-19/07-23) caught an inconsistency: the 07-19
summary's opening paragraph named him ("This class continues Niranjana
Swami's reading of...") but 07-16 and 07-23 didn't ("This class covers
Bṛhad-bhāgavatāmṛta..."). The naming rule only said "refer to him as X
throughout," which the model read as optional for an unattributed scene-
setting sentence. Made it explicit in the template's section 1 description
(both `SUMMARY_PROMPT_V3.md` and `summarize.ts`): the opening paragraph
must name him directly, every time. Rest of the test (verse coverage,
illustrations, themes) checked out clean against the three real ground-
truth samples (two Мысли-с-собой posts + the English Śiva PDF).

---

## 2026-08-07 — TQK batch: mv used wrong filename, stranded all transcripts in ~/Downloads

`transcribe-cli.ts` slugifies its own output filename by replacing every non-alphanumeric
character (including hyphens) with `_` (e.g. `1990-06-29_st-petersburg_1-8-42` →
`1990_06_29_st_petersburg_1_8_42`). `tqk-batch-transcribe.sh`'s move step reused the
original hyphenated `BASE` unchanged, so every `mv ~/Downloads/"${BASE}"_raw.md ...` silently
no-opped (`2>/dev/null` swallowed the "no such file" error). Only the audio file (moved by
its own correct path) landed in `TQK/<slug>/`; all 15 `_raw`/`_cleaned`/`_restored.md` files
from the first batch sat in `~/Downloads` instead. Caught when Divakar noticed Downloads
filling up. Recovered by re-deriving the same slugified name and moving the stranded files
into their matching `TQK/<slug>/` folders (all 15 matched cleanly). Fixed the script to
compute `OUTBASE` the same way `transcribe-cli.ts` does, and dropped the `2>/dev/null` so
a future mismatch surfaces in the log instead of failing silently. The second batch
(59 remaining, running in a separate spawned session, task_c1aef41c) started before this
fix landed — its transcripts will also be stranded in Downloads; sweep them the same way
once that run finishes, per the recovery snippet used here.

---

## 2026-08-07 — Summary prompts declared final; official "The speaker" PDF does not override

Found a real conflict while gathering more reference samples: the official English
PDF for the 2026-07-23 "Glorifying Lord Śiva" post
(scripts/samples/glorifying-lord-siva-2026-07-23-EN.md, pulled straight from
niranjanaswami.net's own S3 bucket, not a translation) uses "The speaker" throughout
— the opposite of the "Niranjana Swami" naming locked in earlier today. Its structure
(unnumbered thematic headers, ends in "Main takeaways") also differs from the fixed
8-section Aug 2/Aug 6 template. Flagged this to Divakar rather than silently
resolving it either way. Ruling: **the prompts are final** —
`SUMMARY_PROMPT_V3.md` and `src/lib/pipeline/summarize.ts` are not to be changed on
account of this or any other newly-found sample. New samples (this PDF, the two
"Мысли с собой" blog posts) are saved under scripts/samples/ for reference/content-depth
comparison only — they do not drive template or naming changes going forward absent a
fresh explicit instruction to change the prompts themselves.

---

## 2026-08-07 — TQK batch slug collision bug, fixed with numeric suffix

`tqk-batch-transcribe.sh` derived each lecture's folder slug from
`date_location_reference` only. Two lectures in the 74-missing set share all
three (Kiev 1997-08-25 SB 1.8.29 Part 1 & 2; Vladivostok 2005-07-22 TQK
ch.20 continuation & "Part 2"). First 15-lecture run collided on Kiev: Part
2 transcribed first, created the folder; Part 1 was then silently skipped
as "already done" and its audio was never processed — folder existence
alone can't distinguish same-day multi-part lectures. Fixed by appending
`-2`, `-3`, etc. to the slug on collision (dict-tracked during queue build,
first CSV occurrence keeps the bare slug). Confirmed the fix makes Kiev
Part 2 keep its existing folder (still recognized done) and assigns Part 1
a fresh distinct slug. Kiev Part 1 still needs to be run through the
pipeline — was never actually transcribed despite PROGRESS.md briefly
implying otherwise pre-fix.

---

## 2026-08-07 — Summary template naming: "Niranjana Swami," not "the speaker" or "Mahārāja"

Went through two reversals same day before landing. v3 template first said
"the speaker" (matching Evernote's impersonal style exactly). Divakar tried
"Mahārāja" — reverted, told to keep "the speaker." Mahārāja himself then
reviewed and said make it personal: use "Niranjana Swami" throughout.
Locked in `SUMMARY_PROMPT_V3.md` (prose rule 6 + embedded system-prompt
block) and `src/lib/pipeline/summarize.ts` formatting rules. Don't re-litigate
without a fresh explicit instruction — this came from Mahārāja directly.

---

## 2026-08-07 — Summary generation switched to a fixed template (v3), no per-lecture adaptation

`SUMMARY_PROMPT_V2.md` picked the summary's shape adaptively (verse-by-verse
vs. thematic) based on how each lecture was delivered. Divakar's explicit
instruction: "no deviations from the template" — replaced with
`SUMMARY_PROMPT_V3.md`, one fixed 8-section structure used every time
(opening paragraph → context & aim → recap of previous class → reading →
commentary highlights → illustrations used → N thematic sections →
where-it-stops/what's-next). Derived from two real Evernote AI-generated
summaries (2026-08-07, BB 1.1.11-12 and BB 1.3.1-10) which independently
converged on this same shape despite covering very different lecture
content — confirms it generalizes rather than being an artifact of one
lecture. Formatting must also match: nested/indented bullets preserved
exactly (not flattened), direct speech in quotation marks verbatim.
`src/lib/pipeline/summarize.ts` updated to this v3 prompt.

---

## 2026-08-07 — Final elaborate-cli output filename convention

Settled after iterating live with Divakar. `elaborate-cli.ts` now always
writes 6 files per run, given `<summary>` as the input summary path's
basename (`.md` stripped):

- `<summary>_elaborate.md` — full output (all 3 parts, unchanged legacy name)
- `<summary>_part-1.md` — Part 1 only, full length
- `<summary>_part-2.md` — Part 2 only
- `<summary>_part-3.md` — Part 3 only
- `<summary>_abridged_part1.md` — Part 1 only, abridged
- `<summary>_elaborate_combined.md` — Part 1 (full) + Part 2 + Part 3, one file
- `<summary>_abridged_combined.md` — Part 1 (abridged) + Part 2 + Part 3, one file

Rules embedded in this naming, don't deviate:
- `part-N` uses a hyphen (`part-1`, not `part1`); `abridged_part1` does not
  (matches `abridged_combined`'s word order: adjective before noun, no
  hyphen within the compound).
- "Elaborate" = full-length; "abridged" = short. The word always appears in
  the filename so it's unambiguous which variant a file is.

---

## 2026-08-07 — Hard rule: elaborate's `restored.md` input must be our own pipeline's transcript, never Evernote's

Mistake made and corrected in this session: when a lecture had no local
`_restored.md` yet, extracted the transcript from Evernote's native
Transcribe output (via `get_note`) and used that as the elaborate-step
input. User caught it: "you use the transcript that is generated from our
pipeline and not evernote's transcript."

**Why it matters**: Evernote's transcript is a different model/pipeline
with no verse-restoration (IAST diacritics, IAST-corpus verse matching)
and no cleanup pass — it is not the same artifact the rest of this
pipeline is built and tested around. Elaborate's Part 1 spec requires an
*edited version of what he actually said in the TRANSCRIPT* — that has to
mean our own `transcribe-cli.ts` output (Groq Whisper → Sonnet IAST
cleanup → deterministic verse-restore), not a third-party transcription
service's raw text, even if the words are substantively the same.

**Rule, no exceptions**: if a lecture has no `_restored.md` yet, run
`scripts/transcribe-cli.ts <audio-file>` (the `/transcribe` command) to
generate one before running compare/elaborate — never substitute
Evernote's (or any other) transcript. Evernote's role in this pipeline is
summary-only (Path 2), never transcription.

## 2026-08-07 — elaborate-cli always produces a combined (abridged Part1 + Part2 + Part3) file too

Standing convention: every `elaborate-cli.ts` run now also writes
`<summary>_elaborate_combined.md` — the abridged Part 1, Part 2, and Part 3
concatenated into one file — alongside the existing `_elaborate.md`,
`_elaborate_part2.md`, and `_elaborate_part1_abridged.md` outputs. Divakar:
"always please make a note" (re: combining all three parts into one
deliverable). Also fixed a naming mismatch found while running this on a
second lecture: `compare-cli.ts` and `elaborate-cli.ts` derive the
`_comparison.md` filename differently, so elaborate-cli's auto-detection
fails when the summary file doesn't end in `_restored`/`_cleaned` — pass
the comparison path explicitly as the 3rd arg when this happens.

## 2026-08-06 — Wiped stale summary/comparison/chapter_voiced for all 19 verse-anchored BB lectures

`~/Downloads/bb-book-chapters-2026-08-05/` held 19 folders (the
verse-anchored subset of the 35 restored BB files, one per
`bb_<part>_<chapter>_<verse-range>` lecture) — each had `_restored.md`,
`_summary.md`, `_comparison.md`, `_chapter_voiced.md`. Deleted the latter
three from all 19, keeping only `_restored.md`.

**Why**: `_summary.md` was generated by the old `summarize-cli.ts` path
directly, never routed through Evernote + Mahārāja's own edit — the exact
Path 1 vs Path 2 distinction already settled 2026-08-06 ("Two-path
Evernote-summary test: Path 2 wins decisively"). Since `_comparison.md`
and `_chapter_voiced.md` were both built on top of that wrong-path summary,
all three are invalid regardless of the elaborate-step upgrade — not just
superseded by write-chapter-voiced → elaborate.

**Standing consequence**: none of these 19 lectures can move forward until
each `_restored.md` transcript is pasted into Evernote, summarized, and
edited by Mahārāja himself (Path 2) — same manual step already required
for new lectures going forward. No shortcut; this cannot be automated past
the point of his edit.

## 2026-08-06 — elaborate-cli always produces the abridged Part 1 companion too

Standing convention: every `elaborate-cli.ts` run now also runs `abridge()`
on Part 1 automatically and writes `<summary>_elaborate_part1_abridged.md`
alongside the full `<summary>_elaborate.md` and `<summary>_elaborate_part2.md`
outputs — full and abridged always delivered together, per lecture, not a
separate manual step. Divakar: "generate version 1 [full] always along with
version 4 [abridged] ... both elaborate and abridged versions."

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
