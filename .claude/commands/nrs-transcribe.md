# Transcribe a lecture

Transcribe an audio file or YouTube URL through the NRS pipeline: Groq Whisper → Claude Sonnet IAST cleanup → deterministic verse-restore.

## Input

The user provides one of:
- A local file path (MP3/WAV/M4A)
- A YouTube URL
- An S3/direct audio URL

If no input provided, ask for it.

## Steps

1. Verify `.env.local` exists in the project root with `GROQ_API_KEY` and `ANTHROPIC_API_KEY`. If missing, tell the user to create it.

2. Run the pipeline:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/transcribe-cli.ts "$INPUT"
   ```
   Use a 10-minute timeout. The script handles YouTube download, chunked transcription, cleanup, and verse-restore automatically.

3. Report results:
   - Output file paths (raw, cleaned, restored — all in ~/Downloads/)
   - Timing per stage
   - Verse-restore stats (restored count, canonical count)
   - IAST character count

## YouTube 403 handling

YouTube periodically blocks yt-dlp (bot detection). If the pipeline fails with a 403:

1. **Try updating yt-dlp first:**
   ```bash
   yt-dlp --update
   ```
   Then retry the same command.

2. **If still failing, try with browser cookies:**
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   yt-dlp -x --audio-format mp3 --audio-quality 128K --cookies-from-browser safari -o "/tmp/lecture.mp3" "$YOUTUBE_URL"
   npx tsx scripts/transcribe-cli.ts /tmp/lecture.mp3
   ```

3. **If all else fails**, tell the user to download the audio manually (e.g. via a browser extension or online converter) and provide the local file path. Then run with `transcribe_file`.

## Notes

- Do NOT summarize, interpret, or comment on the lecture content.
- Pipeline takes 5-7 min for a 1-hour lecture.
