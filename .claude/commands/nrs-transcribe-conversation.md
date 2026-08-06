# Transcribe a multi-speaker conversation

Transcribe a conversation with speaker diarization: Groq Whisper (text quality) + Deepgram (speaker detection) → Claude Sonnet IAST cleanup → verse-restore.

## Input

The user provides:
- A local file path or URL
- Optionally, speaker names: `0:H.H. Niranjana Swami,1:H.H. Dhanurdhara Swami`

If no input provided, ask for it.

## Steps

1. Verify `.env.local` exists with `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, and `DEEPGRAM_API_KEY`.

2. Build the command:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/transcribe-conversation-cli.ts "$INPUT" --speakers "$SPEAKERS"
   ```
   Omit `--speakers` if not provided. Use a 30-minute timeout.

3. Report output file paths and timing. Do NOT summarize the conversation content.

## Notes

- Takes 7-12 min for a 1-hour recording.
- Without speaker names, speakers are labeled Speaker 0, Speaker 1, etc.
