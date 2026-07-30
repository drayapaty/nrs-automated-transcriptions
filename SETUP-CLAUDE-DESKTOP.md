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
           "ANTHROPIC_API_KEY": "sk-ant-..."
         }
       }
     }
   }
   ```

3. **Restart Claude Desktop** (Cmd+Q, reopen).

## Available Tools

Once configured, you can ask Claude Desktop:

### Transcribe a local audio file
> "Transcribe this lecture: /Users/me/Downloads/lecture.mp3"

### Transcribe from a URL (S3, direct link)
> "Transcribe this URL: https://nrs-user-content-prod.s3.eu-central-1.amazonaws.com/lecture/..."

### Transcribe from YouTube
> "Transcribe this YouTube lecture: https://www.youtube.com/watch?v=..."

### Translate to Russian
> "Translate this transcript to Russian: /Users/me/Downloads/lecture_restored.md"

## Output
All files are saved to `~/Downloads/`:
- `*_raw.md` — raw Whisper output
- `*_cleaned.md` — IAST-corrected by Sonnet
- `*_restored.md` — canonical verse references restored
- `*_ru.md` — Russian translation

## Typical timing
- 30-min lecture: ~2-3 min transcription + ~1 min translation
- 1-hour lecture: ~5-7 min transcription + ~2 min translation

## Cost per lecture
- Groq Whisper: free (4 hrs audio/day limit)
- Sonnet cleanup: ~$0.12
- Russian translation: ~$0.10
- Total: ~$0.22/lecture
