#!/usr/bin/env node
/**
 * MCP server for Claude Desktop — exposes the NRS transcription pipeline.
 *
 * Delegates to scripts/transcribe-cli.ts via npx tsx (avoids needing
 * a build step — runs TypeScript pipeline modules directly).
 *
 * Tools:
 *   transcribe_youtube  — download + transcribe + cleanup + verse-restore
 *   transcribe_file     — same pipeline from a local audio file
 *   transcribe_url      — same pipeline from S3/direct URL
 *   transcribe_conversation — multi-speaker diarized transcription
 *   translate_russian   — translate a transcript (.md or .docx) to Russian
 *   summarize_lecture   — Evernote-style summary from a restored transcript
 *   compare_lecture      — vs. Gopīparāṇadhana Vol.1 commentary (needs local source file)
 *   write_chapter_voiced — first-person (Mahārāja's voice) book-chapter draft — the
 *                          only chapter-writing tool; no third-person variant kept
 *   elaborate             — 4-part elaboration step (needs OpenSearch access)
 *
 * Install in Claude Desktop:
 *   ~/Library/Application Support/Claude/claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "nrs-transcribe": {
 *         "command": "node",
 *         "args": ["<path>/nrs-automated-transcriptions/mcp-server.mjs"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_SCRIPT = join(__dirname, "scripts", "transcribe-cli.ts");
const CONVERSATION_SCRIPT = join(__dirname, "scripts", "transcribe-conversation-cli.ts");
const TRANSLATE_SCRIPT = join(__dirname, "scripts", "translate-cli.ts");
const SUMMARIZE_SCRIPT = join(__dirname, "scripts", "summarize-cli.ts");
const COMPARE_SCRIPT = join(__dirname, "scripts", "compare-cli.ts");
const WRITE_CHAPTER_VOICED_SCRIPT = join(__dirname, "scripts", "write-chapter-voiced-cli.ts");
const ELABORATE_SCRIPT = join(__dirname, "scripts", "elaborate-cli.ts");

function runScript(script, args, timeoutMs = 900_000) {
  const quotedArgs = args.filter(Boolean).map((a) => `"${a}"`).join(" ");
  return execSync(`npx tsx "${script}" ${quotedArgs}`, {
    encoding: "utf-8",
    cwd: __dirname,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runCli(input) {
  const output = execSync(`npx tsx "${CLI_SCRIPT}" "${input}"`, {
    encoding: "utf-8",
    cwd: __dirname,
    timeout: 900_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return output;
}

function downloadAndReencode(url) {
  const tmp = mkdtempSync(join(tmpdir(), "nrs-url-"));
  const slug = url.replace(/.*\//, "").replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
  const rawPath = join(tmp, slug);
  const monoPath = join(tmp, slug.replace(/\.[^.]+$/, "_mono.mp3"));
  execSync(`curl -sL "${url}" -o "${rawPath}"`, { timeout: 300_000 });
  execSync(`ffmpeg -y -i "${rawPath}" -ac 1 -ar 16000 -b:a 128k "${monoPath}" 2>/dev/null`, { timeout: 300_000 });
  return { monoPath, cleanup: () => { try { unlinkSync(rawPath); unlinkSync(monoPath); } catch {} } };
}

const server = new Server(
  { name: "nrs-transcribe", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "transcribe_youtube",
      description:
        "Transcribe a YouTube lecture by H.H. Niranjana Swami. Downloads audio, runs Groq Whisper transcription, Sonnet IAST cleanup, and deterministic verse restoration. Saves raw/cleaned/restored .md files to ~/Downloads/. Takes 5-7 minutes for a 1-hour lecture.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "YouTube video URL",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "transcribe_file",
      description:
        "Transcribe a local audio file (MP3/WAV/M4A). Runs Groq Whisper transcription, Sonnet IAST cleanup, and deterministic verse restoration. Saves raw/cleaned/restored .md files to ~/Downloads/. Takes 5-7 minutes for a 1-hour lecture.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the audio file",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "translate_russian",
      description:
        "Translate an English transcript or lecture summary to Russian. Uses Claude with Gaudiya Vaishnava conventions. Accepts .md or .docx input. .md input outputs a _ru.md file; .docx input outputs both _ru.md and _ru.docx (headings/bullets/bold rebuilt to match the original formatting). Takes 1-3 minutes per file.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the English .md or .docx file (typically the _restored.md, _cleaned.md, or _summary.md/.docx output from an earlier step)",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "summarize_lecture",
      description:
        "Generate an Evernote-style summary of a Bṛhad-bhāgavatāmṛta lecture from its restored transcript. Pure numbered-flow structure (## 1) Title, ### A. sub-point), no fixed section labels. Outputs a _summary.md file next to the input. Takes ~1 minute.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the restored/cleaned transcript .md file",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "compare_lecture",
      description:
        "Comparative analysis: finds points in the lecture NOT covered in Gopīparāṇadhana Dāsa's published Bṛhad-bhāgavatāmṛta Vol.1 commentary. Requires the Vol.1 source file to exist locally at ~/Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md (not included in this install — ask Divakar for it if missing). Only works for lectures with a sequential BB verse range (not topical talks) unless the range is passed explicitly. Outputs a _comparison.md file. Takes ~1 minute.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the lecture _summary.md file",
          },
          part: { type: "number", description: "BB part number — only needed if not parseable from the filename" },
          chapter: { type: "number", description: "BB chapter number — only needed if not parseable from the filename" },
          verseStart: { type: "number", description: "Starting verse number — only needed if not parseable from the filename" },
          verseEnd: { type: "number", description: "Ending verse number — only needed if not parseable from the filename" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_chapter_voiced",
      description:
        "Write first-person book-chapter prose in Mahārāja's own voice (he is the book's author), calibrated against his Collected Letters tone profile. The only chapter-writing tool — no third-person variant. Unverified against real book manuscript pages — treat as a rough draft. Outputs a _chapter_voiced.md file. Takes ~1 minute.",
      inputSchema: {
        type: "object",
        properties: {
          summaryPath: { type: "string", description: "Absolute path to the lecture _summary.md file" },
          comparisonPath: { type: "string", description: "Absolute path to the _comparison.md file, if one exists (optional — for topical talks with no BB verse anchor, compare_lecture never runs, and this writes straight from the summary). If omitted, derived from summaryPath." },
        },
        required: ["summaryPath"],
      },
    },
    {
      name: "elaborate",
      description:
        "Mahārāja's 4-point elaboration step: Part 1 an edited transcript excerpt (his real words, not a summary), Part 2 parallel examples from his own published books/lectures (requires OpenSearch access — OPENSEARCH_URL/USER/PASS env vars, not included in this install), Part 3 suggested elaboration angles. Also writes an abridged Part 1 and two combined files. Requires compare_lecture to have been run first (needs the _comparison.md file). Takes 2-4 minutes.",
      inputSchema: {
        type: "object",
        properties: {
          restoredPath: { type: "string", description: "Absolute path to the restored transcript .md file" },
          summaryPath: { type: "string", description: "Absolute path to the lecture _summary.md file" },
          comparisonPath: { type: "string", description: "Absolute path to the _comparison.md file. If omitted, derived from summaryPath." },
        },
        required: ["restoredPath", "summaryPath"],
      },
    },
    {
      name: "transcribe_url",
      description:
        "Transcribe an audio file from a URL (S3, direct link, etc.). Downloads the audio, re-encodes for Groq compatibility, then runs Groq Whisper transcription, Sonnet IAST cleanup, and deterministic verse restoration. Saves raw/cleaned/restored .md files to ~/Downloads/. Takes 5-7 minutes for a 1-hour lecture.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Direct URL to an audio file (MP3/WAV/M4A). Works with S3 presigned URLs, direct download links, etc.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "transcribe_conversation",
      description:
        "Transcribe a multi-speaker conversation or interview. Uses Groq Whisper for text quality and Deepgram for speaker diarization (who said what), then Sonnet IAST cleanup and verse restoration. Saves diarized_raw/diarized_cleaned/diarized_restored .md files to ~/Downloads/. Takes 7-12 minutes for a 1-hour recording. Requires DEEPGRAM_API_KEY.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the audio file (MP3/WAV/M4A)",
          },
          url: {
            type: "string",
            description: "URL to download audio from (S3, direct link). Use this OR path, not both.",
          },
          speakers: {
            type: "string",
            description: 'Optional speaker name mapping. Format: "0:H.H. Niranjana Swami,1:H.H. Dhanurdhara Swami,2:Devotee". Speaker numbers are assigned by Deepgram (usually 0-based). If omitted, speakers are labeled Speaker 0, Speaker 1, etc.',
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "transcribe_youtube") {
      const url = args.url;
      if (!url || !/youtu\.?be/.test(url)) {
        return { content: [{ type: "text", text: "Invalid YouTube URL" }] };
      }
      const output = runCli(url);
      return { content: [{ type: "text", text: output }] };
    }

    if (name === "transcribe_file") {
      const filePath = args.path;
      if (!filePath) {
        return { content: [{ type: "text", text: "Missing file path" }] };
      }
      const output = runCli(filePath);
      return { content: [{ type: "text", text: output }] };
    }

    if (name === "translate_russian") {
      const filePath = args.path;
      if (!filePath) {
        return { content: [{ type: "text", text: "Missing file path" }] };
      }
      const output = runScript(TRANSLATE_SCRIPT, [filePath, "ru"]);
      return { content: [{ type: "text", text: output }] };
    }

    if (name === "summarize_lecture") {
      if (!args.path) {
        return { content: [{ type: "text", text: "Missing file path" }] };
      }
      const output = runScript(SUMMARIZE_SCRIPT, [args.path]);
      return { content: [{ type: "text", text: output }] };
    }

    if (name === "compare_lecture") {
      if (!args.path) {
        return { content: [{ type: "text", text: "Missing file path" }] };
      }
      const output = runScript(COMPARE_SCRIPT, [
        args.path,
        args.part,
        args.chapter,
        args.verseStart,
        args.verseEnd,
      ]);
      return { content: [{ type: "text", text: output }] };
    }

    if (name === "write_chapter_voiced") {
      if (!args.summaryPath) {
        return { content: [{ type: "text", text: "Missing summaryPath" }] };
      }
      const output = runScript(WRITE_CHAPTER_VOICED_SCRIPT, [args.summaryPath, args.comparisonPath]);
      return { content: [{ type: "text", text: output }] };
    }

    if (name === "elaborate") {
      if (!args.restoredPath || !args.summaryPath) {
        return { content: [{ type: "text", text: "Missing restoredPath or summaryPath" }] };
      }
      const output = runScript(
        ELABORATE_SCRIPT,
        [args.restoredPath, args.summaryPath, args.comparisonPath],
        1_800_000
      );
      return { content: [{ type: "text", text: output }] };
    }

    if (name === "transcribe_url") {
      const url = args.url;
      if (!url || !url.startsWith("http")) {
        return { content: [{ type: "text", text: "Invalid URL — must start with http(s)://" }] };
      }
      const { monoPath, cleanup } = downloadAndReencode(url);
      try {
        const output = runCli(monoPath);
        return { content: [{ type: "text", text: output }] };
      } finally {
        cleanup();
      }
    }

    if (name === "transcribe_conversation") {
      let audioPath = args.path;
      let cleanupFn = null;

      if (!audioPath && args.url) {
        if (!args.url.startsWith("http")) {
          return { content: [{ type: "text", text: "Invalid URL — must start with http(s)://" }] };
        }
        const dl = downloadAndReencode(args.url);
        audioPath = dl.monoPath;
        cleanupFn = dl.cleanup;
      }

      if (!audioPath) {
        return { content: [{ type: "text", text: "Provide either path or url" }] };
      }

      try {
        const speakersArg = args.speakers ? `--speakers "${args.speakers}"` : "";
        const output = execSync(
          `npx tsx "${CONVERSATION_SCRIPT}" "${audioPath}" ${speakersArg}`,
          {
            encoding: "utf-8",
            cwd: __dirname,
            timeout: 1_800_000,
            maxBuffer: 10 * 1024 * 1024,
          }
        );
        return { content: [{ type: "text", text: output }] };
      } finally {
        if (cleanupFn) cleanupFn();
      }
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Pipeline failed: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
