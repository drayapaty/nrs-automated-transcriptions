/**
 * Step 3 of the BB lecture workflow: comparative analysis.
 *
 * Extracts the matching chapter/verse section from Gopīparāṇadhana Dāsa's
 * published Bṛhad-bhāgavatāmṛta Vol.1 translation+commentary, then asks
 * Claude to find points covered in NRS's lecture that are NOT covered in
 * that commentary.
 *
 * Source file lives OUTSIDE the repo (BBT copyrighted text, not committed):
 *   ~/Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md
 *
 * Only Vol.1 is available in Gopīparāṇadhana's own translation (Vol.2 in this
 * library is Bhānu Svāmī's translation — a different translator, out of scope
 * for this comparison per the user's spec).
 *
 * Section anchors in the source file: `## BB {part}.{chapter}.{verse}` headers
 * (verse may be a range like "15-17"), and `Thus ends the ... chapter ...`
 * chapter-end markers.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { anthropic, CLAUDE_MODEL } from "../clients";

export const GOPIPARANADHANA_VOL1_PATH = join(
  homedir(),
  "Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md"
);

interface VerseAnchor {
  lineIdx: number;
  part: number;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}

const HEADER_RE = /^## BB (\d+)\.(\d+)\.(\d+)(?:-(\d+))?/;

function parseAnchors(lines: string[]): VerseAnchor[] {
  const anchors: VerseAnchor[] = [];
  lines.forEach((line, lineIdx) => {
    const m = HEADER_RE.exec(line);
    if (!m) return;
    anchors.push({
      lineIdx,
      part: Number(m[1]),
      chapter: Number(m[2]),
      verseStart: Number(m[3]),
      verseEnd: m[4] ? Number(m[4]) : Number(m[3]),
    });
  });
  return anchors;
}

/**
 * Slice the Gopīparāṇadhana Vol.1 file down to the section covering
 * [verseStart, verseEnd] of a given part/chapter. Returns null if the
 * requested range isn't found (e.g. a topical/non-sequential lecture).
 */
export function extractCommentarySection(
  part: number,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  filePath: string = GOPIPARANADHANA_VOL1_PATH
): string | null {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const anchors = parseAnchors(lines);

  const inChapter = anchors
    .map((a, idx) => ({ ...a, globalIdx: idx }))
    .filter((a) => a.part === part && a.chapter === chapter);

  if (inChapter.length === 0) return null;

  const startAnchor = inChapter.find((a) => a.verseEnd >= verseStart);
  const candidatesBeforeEnd = inChapter.filter((a) => a.verseStart <= verseEnd);
  const endAnchor = candidatesBeforeEnd[candidatesBeforeEnd.length - 1];

  if (!startAnchor || !endAnchor || startAnchor.globalIdx > endAnchor.globalIdx) {
    return null;
  }

  const nextGlobal = anchors[endAnchor.globalIdx + 1];
  const sliceEndLine = nextGlobal ? nextGlobal.lineIdx : lines.length;

  return lines.slice(startAnchor.lineIdx, sliceEndLine).join("\n").trim();
}

/** Parses "bb_1_2_14_18" / "bb_1_2_14" style filename fragments. */
export function parseVerseRangeFromFilename(
  filename: string
): { part: number; chapter: number; verseStart: number; verseEnd: number } | null {
  const m = /bb_(\d+)_(\d+)_(\d+)(?:_(\d+))?/.exec(filename);
  if (!m) return null;
  return {
    part: Number(m[1]),
    chapter: Number(m[2]),
    verseStart: Number(m[3]),
    verseEnd: m[4] ? Number(m[4]) : Number(m[3]),
  };
}

const INLINE_TAG_RE = /\(BB (\d+(?:\.\d+){2})\)/g;

/**
 * Fallback #2 when the filename doesn't carry a verse range: read the
 * "(BB part.chapter.verse)" tags verse-restore.mjs already inserted into
 * the restored transcript wherever it matched a quoted verse against the
 * corpus. Only unambiguous 3-part tags are used (a bare "(BB 77)" short
 * form can't be resolved without already knowing the chapter, so it's
 * skipped here rather than guessed) — same logic as
 * scripts/build-bb-verse-manifest.mjs, ported in-line so the live pipeline
 * doesn't depend on a batch script.
 *
 * Returns the min/max verse tagged within whichever part.chapter has the
 * most tags (a lecture occasionally cites one verse from elsewhere in
 * passing; the dominant chapter is treated as the one actually being read).
 */
export function findVerseRangeFromInlineTags(
  restoredText: string
): { part: number; chapter: number; verseStart: number; verseEnd: number; tagCount: number } | null {
  const byChapter = new Map<string, { part: number; chapter: number; verses: Set<number> }>();
  let m: RegExpExecArray | null;
  INLINE_TAG_RE.lastIndex = 0;
  while ((m = INLINE_TAG_RE.exec(restoredText))) {
    const [part, chapter, verse] = m[1].split(".").map(Number);
    const key = `${part}.${chapter}`;
    if (!byChapter.has(key)) byChapter.set(key, { part, chapter, verses: new Set() });
    byChapter.get(key)!.verses.add(verse);
  }
  if (byChapter.size === 0) return null;

  const dominant = [...byChapter.values()].sort((a, b) => b.verses.size - a.verses.size)[0];
  const verses = [...dominant.verses].sort((a, b) => a - b);
  return {
    part: dominant.part,
    chapter: dominant.chapter,
    verseStart: verses[0],
    verseEnd: verses[verses.length - 1],
    tagCount: dominant.verses.size,
  };
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-zāīūṛṝḷḹṃḥṅñṭḍṇśṣ'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordNgrams(text: string, n = 4): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

// Containment (intersection / anchor size), not Jaccard: a short verse
// anchor's n-grams against a multi-thousand-word transcript. Jaccard
// divides by the union, which the long transcript dominates regardless of
// match quality — confirmed 2026-08-12 a perfect quote scored near-zero
// under Jaccard against a full transcript, ~0.98 under containment.
function containment(anchorNgrams: Set<string>, transcriptNgrams: Set<string>): number {
  if (anchorNgrams.size === 0) return 0;
  let inter = 0;
  for (const x of anchorNgrams) if (transcriptNgrams.has(x)) inter++;
  return inter / anchorNgrams.size;
}

interface CommentaryCorpusEntry {
  part: number;
  chapter: number;
  verse: number;
  translationNgrams: Set<string> | null;
  commentaryNgrams: Set<string> | null;
}

function buildCommentaryCorpus(filePath: string): CommentaryCorpusEntry[] {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const corpus: CommentaryCorpusEntry[] = [];

  let current: { part: number; chapter: number; verse: number } | null = null;
  let transBuffer: string[] = [];
  let commBuffer: string[] = [];

  const flush = () => {
    if (current) {
      const transText = transBuffer.join(" ");
      const commText = commBuffer.join(" ");
      if (transText.length >= 20 || commText.length >= 40) {
        corpus.push({
          ...current,
          translationNgrams: transText.length >= 20 ? wordNgrams(transText) : null,
          commentaryNgrams: commText.length >= 40 ? wordNgrams(commText) : null,
        });
      }
    }
    transBuffer = [];
    commBuffer = [];
  };

  const transRe = /^\*\*Translation:\*\*\s*(.+)$/;
  const commRe = /^\*\*Commentary:\*\*\s*(.+)$/;

  for (const line of lines) {
    const h = HEADER_RE.exec(line);
    if (h) {
      flush();
      // Only the FIRST verse of a header range is tracked as an anchor
      // point — ranges in the source ("## BB 1.1.15-17") cover one
      // continuous discussion, so anchoring on the start verse is enough
      // for content matching (unlike extractCommentarySection, which needs
      // the exact range for slicing).
      current = { part: Number(h[1]), chapter: Number(h[2]), verse: Number(h[3]) };
      continue;
    }
    const t = transRe.exec(line.trim());
    const c = commRe.exec(line.trim());
    if (t) transBuffer.push(t[1]);
    else if (c) commBuffer.push(c[1]);
  }
  flush();

  return corpus;
}

/**
 * Fallback #3, last resort when neither the filename nor inline verse-tags
 * give a range: match the transcript's full text against Vol.1's own
 * Translation/Commentary prose (English, not Sanskrit) via word-4-gram
 * containment. Catches lectures that read the English translation aloud
 * without re-quoting the Sanskrit, which the corpus/verse-restore pass
 * structurally can't see. Ported from scripts/match-verses-by-commentary.mjs
 * (built 2026-08-12 for the 35-lecture manifest; same scoring, same 0.15
 * floor) so the live pipeline doesn't depend on that batch script.
 *
 * Returns null if nothing clears the confidence floor — callers should
 * treat that the same as "no verse range found," not silently guess lower.
 */
export function findVerseRangeFromContent(
  transcriptText: string,
  filePath: string = GOPIPARANADHANA_VOL1_PATH,
  scoreFloor = 0.15
): { part: number; chapter: number; verseStart: number; verseEnd: number; score: number; via: string } | null {
  const corpus = buildCommentaryCorpus(filePath);
  const tg = wordNgrams(transcriptText);

  const scored: { part: number; chapter: number; verse: number; score: number; via: string }[] = [];
  for (const c of corpus) {
    const transScore = c.translationNgrams ? containment(c.translationNgrams, tg) : 0;
    const commScore = c.commentaryNgrams ? containment(c.commentaryNgrams, tg) : 0;
    const score = Math.max(transScore, commScore);
    if (score >= scoreFloor) {
      scored.push({ part: c.part, chapter: c.chapter, verse: c.verse, score, via: transScore >= commScore ? "translation" : "commentary" });
    }
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];

  // If other high-confidence matches share the same chapter, widen to
  // their span — but never cross a chapter boundary, and never let a
  // single stray low-scoring outlier drag the range wide.
  const sameChapter = scored.filter((s) => s.part === top.part && s.chapter === top.chapter && s.score >= scoreFloor);
  const verses = sameChapter.map((s) => s.verse).sort((a, b) => a - b);

  return {
    part: top.part,
    chapter: top.chapter,
    verseStart: verses[0],
    verseEnd: verses[verses.length - 1],
    score: top.score,
    via: top.via,
  };
}

const COMPARE_SYSTEM_PROMPT = `You are assisting with study of Śrīla Sanātana Gosvāmī's Bṛhad-bhāgavatāmṛta.

You will be given two documents covering the same verse range:
1. A summary of a lecture given by His Holiness Niranjana Swami
2. The corresponding section of Gopīparāṇadhana Dāsa's published English translation and commentary (Dig-darśinī) on the same verses

Compare them and extract the points, explanations, stories, or connections that Mahārāja raised in his lecture that are NOT present in Gopīparāṇadhana Dāsa's commentary. Focus on substantive content — new illustrative stories, cross-references to other scriptures, personal realizations, distinctions Mahārāja drew that aren't in the printed commentary, or angles of explanation unique to the lecture.

Do not list points that are already covered in the commentary, even if phrased differently — only genuinely additional content.

Structure your output as:
- A bulleted list of the unique points, each with a short label and 1-2 sentence explanation, grouped by verse/topic where that helps
- If a point is a substantial parallel story or extended teaching, say so explicitly and describe it

If nothing in the lecture goes beyond the commentary for a given verse, do not force a point — it's fine for a verse to have no unique-to-lecture content.

Return ONLY the analysis. No preamble.`;

export async function generateComparativeAnalysis(
  lectureSummary: string,
  commentaryExcerpt: string
): Promise<string> {
  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8_000,
    system: COMPARE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `LECTURE SUMMARY:\n${lectureSummary}\n\n---\n\nGOPĪPARĀṆADHANA DĀSA'S COMMENTARY (same verse range):\n${commentaryExcerpt}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = (block as { text?: string } | undefined)?.text;
  if (!text) throw new Error("Comparative analysis returned no text");
  return text;
}
