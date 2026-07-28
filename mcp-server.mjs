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
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_SCRIPT = join(__dirname, "scripts", "transcribe-cli.ts");

function runCli(input) {
  const output = execSync(`npx tsx "${CLI_SCRIPT}" "${input}"`, {
    encoding: "utf-8",
    cwd: __dirname,
    timeout: 900_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return output;
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
