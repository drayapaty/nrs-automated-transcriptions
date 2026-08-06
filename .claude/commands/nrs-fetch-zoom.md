# Fetch latest Zoom recording

Download Mahārāja's most recent Zoom class recording (audio only). No confirmation needed — per standing rule, always grab the latest recording automatically.

## Steps

1. Verify `.env.local` exists with `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`.

2. Run:
   ```bash
   cd /Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions
   npx tsx scripts/fetch-zoom-cli.ts
   ```
   Use a 5-minute timeout (files run 100MB+).

3. Report the downloaded file path, topic, recording date, and size.

## Notes

- Defaults to the latest recording automatically — do not ask which meeting first.
- Only pulls the `audio_only` file, never the video (active_speaker/gallery_view MP4s) — video backup to Google Drive is a separate, not-yet-built step (see `ZOOM-PIPELINE.md` TODO).
- If the script warns about multiple recordings on the same day, surface that to the user rather than silently picking one.
- Output convention: `~/Downloads/<date>_zoom_<sanitized-topic>.m4a`
