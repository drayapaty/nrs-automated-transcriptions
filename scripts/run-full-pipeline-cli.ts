#!/usr/bin/env npx tsx
/**
 * Standalone CLI: the entire BB lecture pipeline in one command —
 * transcribe, summarize, compare (skipped automatically when no BB verse
 * range is parseable, e.g. topical talks), write the chapter in Mahārāja's
 * own voice. Built so the whole thing can run from a single Claude Desktop
 * prompt instead of four separate tool calls.
 *
 * Usage:
 *   npx tsx scripts/run-full-pipeline-cli.ts <youtube-url | local-audio-path>
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

function extractPath(output: string): string | null {
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/→\s+(\S.*\.md)\s*$/);
    if (m) return m[1].trim();
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
  if (!input) {
    console.error("Usage: npx tsx scripts/run-full-pipeline-cli.ts <youtube-url | local-audio-path>");
    process.exit(1);
  }

  console.log("=== Stage 1/4: Transcribe ===");
  const transcribeOut = run("transcribe-cli.ts", [input]);
  console.log(transcribeOut);
  const restoredPath = extractPath(transcribeOut);
  if (!restoredPath) {
    console.error("Could not find the restored transcript path in transcribe output — stopping.");
    process.exit(1);
  }

  console.log("\n=== Stage 2/4: Summarize ===");
  const summarizeOut = run("summarize-cli.ts", [restoredPath]);
  console.log(summarizeOut);
  const summaryPath = extractPath(summarizeOut);
  if (!summaryPath) {
    console.error("Could not find the summary path in summarize output — stopping.");
    process.exit(1);
  }

  console.log("\n=== Stage 3/4: Compare against the published commentary ===");
  let comparisonPath: string | null = null;
  try {
    const compareOut = run("compare-cli.ts", [summaryPath]);
    console.log(compareOut);
    comparisonPath = extractPath(compareOut);
  } catch (err: any) {
    console.log(
      `  Skipped — ${String(err.message).split("\n")[0]}\n` +
        `  (normal for a topical talk with no sequential BB verse range; the chapter will be written from the summary alone)`
    );
  }

  console.log("\n=== Stage 4/4: Write the chapter (Mahārāja's voice) ===");
  const chapterOut = run("write-chapter-voiced-cli.ts", [summaryPath, comparisonPath || undefined]);
  console.log(chapterOut);
  const chapterPath = extractPath(chapterOut);

  console.log("\n=== Full pipeline done ===");
  console.log(`Transcript: ${restoredPath}`);
  console.log(`Summary:    ${summaryPath}`);
  console.log(`Comparison: ${comparisonPath || "(none — topical talk or source file missing)"}`);
  console.log(`Chapter:    ${chapterPath || "(not found in output — check the log above)"}`);
}

main().catch((err) => {
  console.error(`Full pipeline failed: ${err.message}`);
  process.exit(1);
});
