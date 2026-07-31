# NRS Transcription Pipeline — Claude Desktop Setup

## Prerequisites
- macOS with Node.js 18+ installed
- Claude Desktop installed
- ffmpeg (`brew install ffmpeg`)
- yt-dlp for YouTube support (`brew install yt-dlp`) — optional

## Install

1. **Unpack the archive** (if received as tar.gz):
   ```bash
   cd ~/Documents
   tar xzf nrs-transcribe-package.tar.gz
   cd nrs-automated-transcriptions
   npm install
   ```

2. **Configure Claude Desktop** — open/create:
   `~/Library/Application Support/Claude/claude_desktop_config.json`

   Add this (replace YOUR_USERNAME with your Mac username):
   ```json
   {
     "mcpServers": {
       "nrs-transcribe": {
         "command": "node",
         "args": ["/Users/YOUR_USERNAME/Documents/nrs-automated-transcriptions/mcp-server.mjs"],
         "env": {
           "GROQ_API_KEY": "gsk_...",
           "ANTHROPIC_API_KEY": "sk-ant-...",
           "DEEPGRAM_API_KEY": "..."
         }
       }
     }
   }
   ```
   Note: DEEPGRAM_API_KEY is only needed for the conversation/diarization tool.

3. **Restart Claude Desktop** (Cmd+Q, reopen).

## Project Instructions (recommended)

Create a new Project in Claude Desktop and paste this as the project instructions:

> When I ask you to transcribe or translate, use the nrs-transcribe tools.
> Return only the output file paths and timing. Do not summarize, interpret,
> or comment on the lecture content.

This prevents Claude from trying to analyze or interpret the transcript content.

## Prompts

Copy-paste these into Claude Desktop. Replace the file path with your actual file.

### Transcribe a local audio file
> Transcribe this file. Just run the tool and tell me the output file paths, nothing else: /Users/nbyers/Downloads/lecture.mp3

### Transcribe from a URL (S3, direct link)
> Transcribe this URL. Just run the tool and tell me the output file paths: https://nrs-user-content-prod.s3.eu-central-1.amazonaws.com/lecture/...

### Transcribe from YouTube
> Transcribe this YouTube lecture. Just run the tool: https://www.youtube.com/watch?v=...

### Transcribe a multi-speaker conversation
> Transcribe this conversation. Just run the tool and tell me the output file paths: /Users/nbyers/Downloads/interview.mp3

With speaker names:
> Transcribe this conversation with speakers 0:H.H. Niranjana Swami, 1:H.H. Dhanurdhara Swami. Just run the tool: /Users/nbyers/Downloads/interview.mp3

### Translate to Russian
> Translate this to Russian. Just run the tool: /Users/nbyers/Downloads/lecture_restored.md

## Output
All files are saved to `~/Downloads/`:
- `*_raw.md` — raw Whisper output
- `*_cleaned.md` — IAST-corrected by Sonnet
- `*_restored.md` — canonical verse references restored
- `*_diarized_raw.md` — raw diarized conversation
- `*_diarized_cleaned.md` — IAST-corrected diarized conversation
- `*_diarized_restored.md` — diarized with verse restoration
- `*_ru.md` — Russian translation

## Typical timing
- 30-min lecture: ~2-3 min transcription + ~1 min translation
- 1-hour lecture: ~5-7 min transcription + ~2 min translation
- 1-hour conversation: ~7-12 min (Groq + Deepgram run in parallel)

## Cost per lecture
- Groq Whisper: free (4 hrs audio/day limit)
- Deepgram diarization: free tier (Nova-2)
- Sonnet cleanup: ~$0.12
- Russian translation: ~$0.10
- Total: ~$0.22/lecture, ~$0.15/conversation
