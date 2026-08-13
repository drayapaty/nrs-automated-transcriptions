#!/usr/bin/env npx tsx
/**
 * Standalone CLI: the entire BB lecture pipeline in one command —
 * transcribe, summarize, compare (skipped automatically when no BB verse
 * range is parseable, e.g. topical talks), write the chapter in Mahārāja's
 * own voice, and elaborate (skipped automatically when there's no
 * comparison to elaborate on). Built so the whole thing can run from a
 * single Claude Desktop prompt instead of five separate tool calls.
 *
 * Usage:
 *   npx tsx scripts/run-full-pipeline-cli.ts <youtube-url | local-audio-path> [part] [chapter] [verseStart] [verseEnd]
 *
 * The verse-range args are optional — when omitted, the compare stage falls
 * back to its own 3-tier auto-detect (filename, inline verse-restore tags,
 * content-match against the commentary). When given, they're passed straight
 * through to compare-cli.ts instead, same as calling that tool directly.
 *
 * Purely an orchestrator — each stage shells out to the existing standalone
 * CLI for that stage, so it runs the exact same code path as calling the
 * stage individually. No pipeline logic of its own.
 */

import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// Several stages print more than one "→ <path>" line (summarize now emits
// English + Russian .md/.docx; elaborate emits 7 files). Picking the *last*
// line unconditionally was a real bug: once summarize started printing
// _summary_ru.md after _summary.md, "last .md line" silently became the
// Russian summary, which then got fed into compare/write_chapter/elaborate
// -- wrong-language input all the way downstream, with no error anywhere.
// suffixPattern anchors to the exact filename ending wanted, so a stage
// with multiple real outputs still returns the ONE that matters to the
// next stage, not whichever line happened to print last.
function extractPath(output: string, suffixPattern: RegExp = /\.md$/): string | null {
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/→\s+(\S+\.md)/);
    if (m && suffixPattern.test(m[1])) return m[1].trim();
  }
  return null;
}

function run(script: string, args: (string | undefined)[]): string {
  const quoted = args.filter((a): a is string => !!a).map((a) => `"${a}"`).join(" ");
  return execSync(`npx tsx "${join(__dirname, script)}" ${quoted}`, {
    encoding: "utf-8",
    cwd: REPO_ROOT,
    timeout: 1_800_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function main() {
  const input = process.argv[2];
  const [part, chapter, verseStart, verseEnd] = process.argv.slice(3, 7);
  if (!input) {
    console.error(
      "Usage: npx tsx scripts/run-full-pipeline-cli.ts <youtube-url | local-audio-path> [part] [chapter] [verseStart] [verseEnd]"
    );
    process.exit(1);
  }

  console.log("=== Stage 1/4: Transcribe ===");
  const transcribeOut = run("transcribe-cli.ts", [input]);
  console.log(transcribeOut);
  const restoredPath = extractPath(transcribeOut, /_restored\.md$/);
  if (!restoredPath) {
    console.error("Could not find the restored transcript path in transcribe output — stopping.");
    process.exit(1);
  }

  console.log("\n=== Stage 2/4: Summarize ===");
  const summarizeOut = run("summarize-cli.ts", [restoredPath]);
  console.log(summarizeOut);
  // Anchored, not "last .md line" -- summarize also emits _summary_ru.md,
  // which sorts after _summary.md and would otherwise win by accident.
  const summaryPath = extractPath(summarizeOut, /_summary\.md$/);
  if (!summaryPath) {
    console.error("Could not find the English summary path in summarize output — stopping.");
    process.exit(1);
  }

  console.log("\n=== Stage 3/5: Compare against the published commentary ===");
  let comparisonPath: string | null = null;
  try {
    const compareOut = part
      ? run("compare-cli.ts", [summaryPath, part, chapter, verseStart, verseEnd])
      : run("compare-cli.ts", [summaryPath]);
    console.log(compareOut);
    comparisonPath = extractPath(compareOut, /_comparison\.md$/);
  } catch (err: any) {
    console.log(
      `  Skipped — ${String(err.message).split("\n")[0]}\n` +
        `  (normal for a topical talk with no sequential BB verse range; the chapter will be written from the summary alone)`
    );
  }

  console.log("\n=== Stage 4/5: Write the chapter (Mahārāja's voice) ===");
  const chapterOut = run("write-chapter-voiced-cli.ts", [summaryPath, comparisonPath || undefined]);
  console.log(chapterOut);
  const chapterPath = extractPath(chapterOut, /_chapter_voiced\.md$/);

  console.log("\n=== Stage 5/5: Elaborate ===");
  let elaboratePath: string | null = null;
  if (comparisonPath) {
    try {
      const elaborateOut = run("elaborate-cli.ts", [restoredPath, summaryPath, comparisonPath]);
      console.log(elaborateOut);
      // elaborate-cli.ts prints 7 "→" lines (main + part-1/2/3 + abridged +
      // both combined variants) -- anchor to the main file, not whichever
      // printed last (that would be the abridged-combined variant).
      elaboratePath = extractPath(elaborateOut, /_elaborate\.md$/);
    } catch (err: any) {
      console.log(`  Elaborate failed: ${String(err.message).split("\n")[0]}`);
    }
  } else {
    console.log("  Skipped — no comparison.md (elaborate needs a compared verse range).");
  }

  console.log("\n=== Full pipeline done ===");
  console.log(`Transcript: ${restoredPath}`);
  console.log(`Summary:    ${summaryPath}`);
  console.log(`Comparison: ${comparisonPath || "(none — topical talk or source file missing)"}`);
  console.log(`Chapter:    ${chapterPath || "(not found in output — check the log above)"}`);
  console.log(`Elaborate:  ${elaboratePath || "(none — no comparison, or elaborate failed)"}`);
}

main().catch((err) => {
  console.error(`Full pipeline failed: ${err.message}`);
  process.exit(1);
});
