# Architecture Review — What Here Is Actually Rare

**Question asked:** across everything built so far, what have we done that nobody else
has, and what could it turn into?

**Short verdict.** About 80% of this repo is a competent but ordinary
ASR → LLM-cleanup → embed → RAG pipeline. Dozens of companies ship that. The
remaining 20% — the verse-restoration layer and the measurement discipline
around it — is genuinely uncommon, and one property of it is close to unique
in the transcription market. That property is worth naming, generalizing, and
selling. The rest is table stakes.

---

## 1. What is commodity (say so plainly)

Not a criticism — this is the part that should be boring:

- Async job model: `POST /api/jobs` → `waitUntil()` → poll / callback. Standard.
- Presigned S3 upload, NextAuth magic-link admin, SES delivery, PDF export.
- Paragraph-aware 800-token chunking + `text-embedding-3-small` + OpenSearch.
- Sonnet-based cleanup and RU/UK translation.
- Multi-key rotation and provider failover.

None of this differentiates. Anyone with a month and an API budget rebuilds it.
Don't put any of it in a pitch.

---

## 2. The one property that is close to unique

### Canonical spans are structurally non-hallucinating

In `src/lib/pipeline/verse-restore.mjs`, on the highest-stakes spans of the
document — the quoted scripture — the output can only ever be one of:

- **(a)** a verbatim string from a 26,563-entry authoritative corpus, or
- **(b)** the unchanged input.

It can never be **(c)** text authored by a language model. There is no LLM call
in that module at all. The generative model is architecturally not permitted to
author a citation.

This matters because the entire rest of the industry answers "the ASR garbled
the quotation" with *"ask the LLM to fix it."* An LLM asked to repair a
half-heard scriptural verse will produce something fluent, metrically plausible,
correctly formatted — and wrong. And nobody catches it, because the reader
cannot tell a real verse from a well-formed fake one. That is the exact failure
mode this design forecloses by construction, not by prompt engineering.

The distinction is worth being precise about, because it is the pitch:

| Everyone else | Here |
|---|---|
| "We prompt carefully for citation accuracy" | The model has no path to emit a citation |
| Accuracy is an eval result that can regress | Non-authorship is a code property, provable by reading the file |
| Failure is silent and fluent | Failure is a refusal (span left as-heard) |

Evals here only need to establish *match precision*. The non-hallucination
property needs no eval — it holds by inspection.

**Second-order asset:** the audit trail already exists.
`stats.identified_verses` (reference + score) rides in the job result via
`orchestrator.ts:152`, and the restore log distinguishes `auto-restore` from
`prayer-restore`. Every restoration is attributable to a corpus key, a method,
and a score. That is the artifact an institutional buyer's compliance reviewer
asks for, and it is already being produced.

---

## 3. Four more things that are rare (ranked)

### 3.1 A measured negative result nobody else has: English ASR *deletes* liturgical content

Deepgram Nova-3: **0 IAST characters** across four test lectures.
Groq Whisper large-v3 on the same four: **84–981**.

The finding is not "Deepgram is worse at Sanskrit." It is that an English-only
model treats recited non-English scripture as non-speech and **drops it
silently** — no garble, no low-confidence marker, no gap. The customer never
knows the most sacred sixty seconds of the recording is missing.

Almost nobody has measured this, because almost nobody transcribes content where
the non-English portion is the *most valuable* portion. This is a positioning
claim with a number attached, and there is no competing published benchmark to
argue with it.

### 3.2 Killing our own feature on evidence (the tier-2 import)

This is the single most credibility-bearing artifact in the repo.

An importer was built to pull 1,352 verses out of ācārya commentaries. Before it
wrote anything, `scripts/test-acarya-import.py` was written to check it — and
found **1,520 reference mismatches**. Root cause, documented in `DECISIONS.md`:
a `verse_map` region records where a region *sits* in a book, not the identity of
the verse printed at its head, because commentaries quote verses from elsewhere.
Proof case: the importer wanted to file *karma-jaṁ buddhi-yuktā hi* as **BG
18.51**; it is **BG 2.51**, and already correctly in the corpus.

The feature was killed. The stated principle:

> A wrong key is worse than a missing verse: it asserts a false citation AND
> hides the correct entry from the matcher.

Same week, the wiki was measured as an alternative verse source and also
rejected — 4,568 pages, but only 113 refs were new, and nearly all turned out to
be commentary with embedded IAST, not verse text. Written down as a rejection
with the reasoning, so nobody re-derives it.

Most teams ship the importer and discover the corruption in production a year
later. This one has a documented habit of measuring before writing and
publishing its own negative results.

### 3.3 Precision discipline: knowingly refusing correct answers

`scripts/eval-metric.py`, `eval-gate.py`, `eval-threshold.py` plus a 32-case
regression suite. What is unusual is not that evals exist — it is what they were
used to *decline*:

- **Rejected a metric swap.** Compared Jaccard / Dice / containment / LCS on nine
  hand-labelled real garbles. Dice is Jaccard rescaled (identical ranking);
  containment scored 5/7, LCS 3/7 — LCS matched the English sentence *"And so
  the devotees were very much pleased"* to SB 12.2.12 at 0.79. Conclusion: the
  metric already ranks correct top-1 in 7/7. **The metric was never the problem;
  the gate was.**
- **Rejected a bare gate drop.** Harvested all 128 Sanskrit-looking blocks from
  17 transcripts to see exactly what each candidate gate admits. Dropping to
  0.25–0.30 admits six corruptions where Mahārāja simply says *"Hare Kṛṣṇa"* as
  a greeting — nine characters scoring 0.35 against the 68-character mahā-mantra.
- **Still refuses two known-correct matches.** SB 6.17.28 (0.27) and BB 91 (0.25)
  are correct top-1 and are *knowingly left unrestored*, because admitting them
  also admits a wrong-verse match of identical length. Documented as needing a
  detection classifier, not a lower gate.

Choosing to leave real recall on the table, in writing, with the reason — that is
the posture you sell into a high-trust vertical.

### 3.4 Three small techniques that are quietly novel

**Length-ratio guard on the match gate.** Gate is 0.40 normally, **0.35 when the
heard span is ≥40% of the verse's length**. Short-string-scores-high is the
classic fuzzy-match failure and most systems eat it; this fixes it with one cheap
signal, calibrated on real data (every correct band match measured 47–84% of its
verse length; the one false positive was 13%).

**Prompt-as-acoustic-primer.** Three sample verses in the Whisper `prompt` field
lift capture on *unrelated* verses — Whisper starts matching the acoustic pattern
of "verse being recited," not just the vocabulary. Using the prompt as a modality
prior rather than a glossary is a real finding.

**Sparse keyterms beat dense ones.** Boosting common chant words made Nova-3
*hallucinate a chant tail*. So the keyterm list is deliberately small and
distinctive. This is the exact opposite of what every integration guide tells you
to do (dump the whole glossary in), and it was found by measurement.

Also worth noting as craft: a hand-rolled MP3 frame-header parser
(`transcribe.ts:154–240`) that skips ID3v2 and the Xing/Info VBR frame to compute
byte offsets for 2-minute chunks — because ffmpeg is unavailable on Vercel, and
feeding Groq the Xing header makes it misread duration and hang. The 2-minute
figure is itself empirical: recovers 51% more content than a single call, and
1-minute chunks fail because Whisper needs ~90s of context.

---

## 4. Where the business is

The generalizable asset is **not** "Sanskrit transcription." It is:

> **Verifiable restoration of canonical quoted text in speech.**

The pattern applies wherever three conditions hold:

1. Speech contains verbatim quotations from a **closed, authoritative corpus**
2. Getting the quotation wrong is a **serious error**, not a typo
3. Generic ASR **mangles or drops** it

That is a much larger surface than one tradition:

| Market | Corpus | Why it hurts today |
|---|---|---|
| Sermon transcription (Christian) | Bible, multiple translations | Largest by volume; misquoted scripture is a real complaint |
| Khutbas / Islamic lectures | Qur'an + hadith | Recited Arabic inside English speech — the exact failure mode measured in §3.1 |
| Shiurim | Torah, Talmud | Hebrew/Aramaic inside English |
| Dharma talks | Pali canon | Pali inside English |
| **Legal** — hearings, depositions | Statutes, case citations | Closed corpus, high stakes, budget already exists |
| **Medical** dictation | Drug names, dosing protocols, ICD | Wrong drug name is a safety event |
| Earnings calls / compliance | Read-out disclosure language | Verbatim accuracy is regulated |

The repeatable product is: **"bring your canon, we build the matcher."** The
corpus is the customer's; the matcher, the gate calibration methodology, the
refusal semantics, and the audit trail are ours. That is a services-to-product
ladder, and the second deployment costs a fraction of the first because the hard
part — knowing that gates need length guards, that narrow matchers go *behind*
broad ones, that a wrong key is worse than a missing one — is already learned.

The legal and medical columns are where the money is. The religious columns are
where the credibility and the reference customers are, and where we already have
a working system and a corpus.

---

## 5. What is blocking commercialization

Concrete, in rough priority order.

**Live correctness drift — fix before demoing anything:**

1. `RUSSIAN_PROMPT` (`translate.ts:17`) says *"do NOT translate them into
   Cyrillic."* `DECISIONS.md` records the v3 devotee-edited rule (2026-07-16) as
   the opposite: **Cyrillicize all Sanskrit** including names and terms, Latin
   only for verse refs. Every Russian transcript produced since is in the wrong
   style. Same drift in `UKRAINIAN_PROMPT`.
2. `extractReferences()` is written, tested (4 cases), exported — and **never
   called** from `autoRestoreFromCorpus()`. Spoken-reference lookup is free
   accuracy sitting on the floor. Wiring it is non-trivial (deciding which garble
   a nearby reference belongs to) but it is the highest-value unshipped work here.
3. Stale docs that would embarrass a technical buyer: `PIPELINE.md:148` says
   verse-restore is "not currently wired into the prod orchestrator" — it *is*
   (`orchestrator.ts:19, 66`). `README.md` architecture diagram and
   `transcribe.ts:1` both still say Deepgram is primary; it is not, and
   `DECISIONS.md` calls both out as stale.

**Productization gaps:**

4. **The evals aren't reproducible by anyone else.** `eval-gate.py` and friends
   glob `/Users/divakar/Downloads/*_raw.md`. The measurement discipline is the
   asset — but it currently only runs on one laptop. Move the fixtures into the
   repo.
5. **No published benchmark.** The numbers in §3.1 and §3.3 are scattered through
   `DECISIONS.md`. Packaged as a named benchmark — *citation fidelity in
   liturgical speech* — with a reproducible harness, this is a marketing asset
   with no competitor to contest it.
6. **No review surface.** `stats.identified_verses` has everything needed to show
   an editor "4 verses restored at these scores, 2 refused — please check these
   two," but the admin UI and email don't render it. That review queue *is* the
   product surface a paying customer interacts with; right now the audit data is
   produced and thrown away.
7. **Single-tenant by construction.** One `ADMIN_BEARER_TOKEN`, one email
   allowlist, one `corpus.json` committed at repo root and loaded at module init.
   A second customer needs corpus-per-tenant loading before anything else.
8. **Corpus licensing is unexamined.** Entries carry `source: "vedabase.io/..."`.
   Fine for internal devotional use; needs an answer before it is sold. Note the
   matcher itself is corpus-agnostic — this blocks commercializing *this* corpus,
   not the technique.

---

## 6. Recommended next moves

If the goal is business rather than more pipeline:

1. **Fix the three drift items** (§5.1–5.3). Half a day. They are the difference
   between "measured, disciplined team" and "docs don't match code."
2. **Make the evals reproducible in-repo**, then publish the citation-fidelity
   benchmark. This is the cheapest credibility purchase available.
3. **Build the restoration review queue** in the admin UI from data already in
   the job result. Turns an internal tool into something demonstrable.
4. **Prove generality on one non-Sanskrit corpus** — Bible verses in a sermon is
   the easiest test and the biggest adjacent market. If the same gate + length
   guard + narrow-matcher-behind-broad architecture transfers with only a corpus
   swap, the "bring your canon" product is real. If it doesn't transfer, better
   to learn that on a weekend than in a sales cycle.
5. **Only then** consider legal or medical, where the corpora are closed, the
   stakes are documented, and budget already exists.

---

## Appendix: corpus composition (26,563 entries)

| Prefix | Count | Work |
|---|---:|---|
| `SB` | 13,559 | Śrīmad-Bhāgavatam |
| `CC` | 11,359 | Caitanya-caritāmṛta |
| `BG` | 682 | Bhagavad-gītā |
| `BB` | 486 | Bṛhad-bhāgavatāmṛta |
| `RRSN-c` | 267 | Rādhā-rasa-sudhā-nidhi |
| `VSN` | 133 | Vilāpa-kusumāñjali / related |
| `PdV` | 33 | — |
| `Śrī` | 19 | — |
| `NoI` | 11 | Nectar of Instruction |
| `Śikṣāṣṭaka` | 8 | aliases of CC Antya-līlā 20.x |
| prayers | 6 | praṇāmas, mahā-mantra, Pañca-tattva |

**Standing gap** (from `DECISIONS.md`): the previous ācāryas' own verses are not
in machine-readable, correctly-referenced form anywhere in the system. Absent
from the corpus; the wiki holds commentary, not verses; book regions give wrong
refs. Bhakti-rasāmṛta-sindhu (Rūpa Gosvāmī) is absent entirely and is the only
identified lead.

---

*Related: `DECISIONS.md` (standing decisions + evidence), `PIPELINE.md`
(stage-by-stage), `README.md` (service overview).*
