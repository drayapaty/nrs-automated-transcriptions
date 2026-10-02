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
           "DEEPGRAM_API_KEY": "...",
           "OPENAI_API_KEY": "sk-...",
           "OPENSEARCH_URL": "https://148.251.70.122:9200",
           "OPENSEARCH_USER": "admin",
           "OPENSEARCH_PASS": "...",
           "OPENSEARCH_INDEX": "ask-nrs-lectures",
           "NODE_TLS_REJECT_UNAUTHORIZED": "0"
         }
       }
     }
   }
   ```
   Notes:
   - `DEEPGRAM_API_KEY` is only needed for the conversation/diarization tool.
   - `OPENAI_API_KEY`, `OPENSEARCH_*` and `NODE_TLS_REJECT_UNAUTHORIZED` are only
     needed for the `elaborate` tool (Part 2 — parallel examples from books/lectures).
     `OPENAI_API_KEY` is used to embed the topic for the semantic search against
     OpenSearch — without it `elaborate` fails ("OPENAI_API_KEY not set"), and inside
     `run_full_pipeline` that stage is caught and skipped, so no elaborate output
     appears. Ask Divakar for the real `OPENAI_API_KEY` and `OPENSEARCH_PASS`
     values; omit all of these lines only if you don't plan to use `elaborate`.
   - `NODE_TLS_REJECT_UNAUTHORIZED=0` is required because that OpenSearch
     host uses a self-signed certificate — this only weakens TLS verification
     for connections this one process makes, not system-wide.

3. **One extra file needed for `compare_lecture` and `elaborate`** (both
   depend on it): Gopīparāṇadhana Dāsa's published Bṛhad-bhāgavatāmṛta Vol.1
   translation/commentary must exist locally at:
   ```
   ~/Downloads/FFF/SanatanaGoswami-extracted/md/01_Brhad-Bhagavatamrita__Gopiparanadana-Vol1.md
   ```
   This is copyrighted text and is deliberately NOT included in this
   package. Ask Divakar for the file directly. Every other tool
   (transcribe, translate, summarize, write_chapter, write_chapter_voiced)
   works without it.

4. **Restart Claude Desktop** (Cmd+Q, reopen).

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

Also works on a Word file:
> Translate this to Russian. Just run the tool: /Users/nbyers/Downloads/lecture_summary.docx

### Summarize a lecture
> Summarize this lecture. Just run the tool: /Users/nbyers/Downloads/lecture_restored.md

### Compare against Gopīparāṇadhana's commentary
(needs the Vol.1 source file installed locally — see setup step 3 above)
> Compare this lecture summary to the commentary. Just run the tool: /Users/nbyers/Downloads/lecture_summary.md

If the verse range isn't in the filename, give it explicitly:
> Compare this lecture summary to the commentary, BB part 1 chapter 2 verses 14-18: /Users/nbyers/Downloads/lecture_summary.md

### Write chapter material (third person)
> Write this up as book-chapter material. Just run the tool: /Users/nbyers/Downloads/lecture_summary.md

### Write chapter material (Mahārāja's own voice)
> Write this in my own voice as book-chapter material. Just run the tool: /Users/nbyers/Downloads/lecture_summary.md

### Elaborate (4-part: excerpt, parallel examples, elaboration angles)
(needs OpenSearch env vars and the Vol.1 source file — see setup steps 2-3 above; run compare first)
> Run the elaborate step on this lecture. Restored transcript: /Users/nbyers/Downloads/lecture_restored.md, summary: /Users/nbyers/Downloads/lecture_summary.md

### The whole pipeline in one prompt
No separate "run everything" tool exists — each tool's output filename is predictable from
its input, so Claude will chain several tools in one reply if the prompt asks for it:
> Run the full pipeline on this lecture: transcribe it, summarize it, compare it against the commentary, then write it as a chapter in my own voice. Just run the tools in sequence and tell me the final file paths when done.
> /Users/nbyers/Downloads/lecture.mp3

This relies on Claude choosing to call all four tools correctly in order — watch it the
first few times. If it stops partway, ask it to continue from wherever it left off (each
tool's output file already exists on disk, so nothing is lost). If this proves unreliable
in practice, a single dedicated pipeline tool could be built instead.

## Output
All files are saved to `~/Downloads/`:
- `*_raw.md` — raw Whisper output
- `*_cleaned.md` — IAST-corrected by Sonnet
- `*_restored.md` — canonical verse references restored
- `*_diarized_raw.md` — raw diarized conversation
- `*_diarized_cleaned.md` — IAST-corrected diarized conversation
- `*_diarized_restored.md` — diarized with verse restoration
- `*_ru.md` / `*_ru.docx` — Russian translation
- `*_summary.md` — Evernote-style lecture summary
- `*_comparison.md` — points not covered in Gopīparāṇadhana's commentary
- `*_chapter.md` / `*_chapter_voiced.md` — book-chapter drafts
- `*_elaborate.md` (+ `_part-1/2/3.md`, `_abridged_part1.md`, `_elaborate_combined.md`, `_abridged_combined.md`) — elaborate step output

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
