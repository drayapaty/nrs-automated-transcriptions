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
 *   translate_russian   — translate a transcript file to Russian
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
        "Translate an English transcript file to Russian. Uses Claude with Gaudiya Vaishnava conventions. Outputs a _ru.md file next to the input. Takes 1-3 minutes per transcript.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the English transcript .md file (typically the _restored.md or _cleaned.md output from transcription)",
          },
        },
        required: ["path"],
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
      const output = execSync(`npx tsx "${TRANSLATE_SCRIPT}" "${filePath}" ru`, {
        encoding: "utf-8",
        cwd: __dirname,
        timeout: 900_000,
        maxBuffer: 10 * 1024 * 1024,
      });
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
