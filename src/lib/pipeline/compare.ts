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
