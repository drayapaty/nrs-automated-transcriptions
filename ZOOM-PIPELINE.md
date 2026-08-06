# Zoom-class distribution pipeline — design doc

**Status: not built yet.** Architecture agreed, blocked on one input from
Mahārāja. This doc is the spec to build against once unblocked.

## Purpose

After Mahārāja gives a Zoom class, the resulting audio file needs to reach
two places automatically instead of by hand:

1. **Evernote** — for the summary devotees currently write by hand.
2. **`nrs-automated-transcriptions`** — for the verse-accurate transcript
   (IAST cleanup, corpus verse-restoration) devotees currently trigger via
   Claude Desktop.

Getting the audio file itself (Zoom cloud vs local recording, who exports
it) is **out of scope** — this pipeline starts once a local audio file
exists.

## Architecture

```
                    ┌─────────────────────────┐
                    │  local audio file (mp3)  │
                    │  handed off manually     │
                    └────────────┬─────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                                ▼
     ┌───────────────────────┐      ┌───────────────────────────┐
     │  Evernote leg          │      │  Transcription leg         │
     │  1. upload audio to S3 │      │  local pipeline already    │
     │  2. email a LINK to    │      │  installed on his Mac      │
     │     Evernote's note-   │      │  (mcp-server.mjs, same     │
     │     creation address   │      │  functions as              │
     │     via SES            │      │  transcribe-cli.ts)        │
     └───────────────────────┘      └───────────────────────────┘
                 │                                │
                 ▼                                ▼
         Evernote note created            ~/Downloads/*_raw.md
         with download link               ~/Downloads/*_cleaned.md
         (Evernote generates its          ~/Downloads/*_restored.md
          own summary — not our
          concern)
```

**Not an attachment — a link.** A real class recording is 40-100+ MB
(measured: 61.2 MB for a 67-min mp3 @128kbps during the gpt-4o-transcribe
test). AWS SES hard-caps raw messages at 10 MB, and most mail gateways cap
attachments around 25 MB regardless — mailing the audio directly would
just fail. Audio goes to S3 first (reusing the presigned-URL flow already
used for `/api/jobs`); the email to Evernote carries a download link, not
the file itself.

## Decisions (logged in `DECISIONS.md`, 2026-08-02)

- **Evernote delivery = email, not API.** Evernote's public API dev-token
  program has been closed to new developers for years. Every account has a
  private "email this note" address (`username.xxxxx@m.evernote.com`) —
  mailing to it auto-creates a note.
- **Evernote email = a link, not an attachment.** SES hard-caps raw
  messages at 10 MB; a real class recording (40-100+ MB) would just fail
  to send. Upload audio to S3 first (reuse the presigned-URL flow already
  used for `/api/jobs`), then email a download link. Reuses the raw-MIME
  send pattern already in `src/lib/email.ts` (used today for completion
  emails) — just a text/HTML body this time, not a binary attachment.
- **Evernote generates its own summary.** We only deliver the audio (via
  link) there. Summary format/content is not our concern.
- **Transcription leg calls the LOCAL pipeline**, not the remote
  `/api/jobs` Vercel endpoint. Reuses `transcribeWithGroqChunked` →
  `cleanupTranscript` → `restoreVerses` — the same functions
  `scripts/transcribe-cli.ts` already calls.
- **Trigger is manual.** A person hands off the audio file (CLI arg or
  pasted path in Claude Desktop), matching the existing pattern in
  `SETUP-CLAUDE-DESKTOP.md`. Not a folder-watcher or webhook — not
  revisited unless asked.

## TODO

- [ ] **2026-08-06, deferred**: video recordings (`active_speaker` +
      `gallery_view` MP4, ~2.8 GB combined for a 3-hour class) are currently
      skipped entirely — only the `audio_only` M4A gets pulled. Divakar's
      plan: back them up to Google Drive instead of discarding them,
      link to be shared later. Not built yet. Relevant since Zoom's own
      cloud copy auto-deletes after 30 days (`auto_delete_date` on each
      recording) — video is only recoverable from Zoom during that window
      unless backed up somewhere first.
- [ ] **Blocked**: get Mahārāja's Evernote note-creation email address
      (`username.xxxxx@m.evernote.com`). Found in Evernote desktop/web app
      under Settings → General → "Email notes to."
- [ ] Decide: one combined script/tool that runs both legs, or two
      separate steps a person triggers independently?
- [ ] Decide: if the Evernote email send fails (SES misconfigured, bad
      address), should the transcription leg still complete? `email.ts`
      today no-ops silently when SES isn't configured — likely wrong here,
      since a silently-dropped Evernote delivery would go unnoticed. Needs
      a loud failure path (visible error, not a silent skip).
- [ ] Build the script (`scripts/distribute-lecture.ts`, once unblocked):
      - Accept local audio file path as arg.
      - Evernote leg: upload audio to S3 (presigned URL, same pattern as
        the admin UI upload flow), then send an email via the SES client
        pattern from `src/lib/email.ts` with a download link in the body
        — not the audio as an attachment.
      - Transcription leg: call `transcribeWithGroqChunked` →
        `cleanupTranscript` → `restoreVerses`, save outputs to
        `~/Downloads/` (same naming as `transcribe-cli.ts`).
      - Run both legs, report pass/fail for each distinctly.
      - Decide S3 object lifetime/access: presigned URL expiry needs to be
        long enough for Evernote's crawler + Mahārāja to click it (not the
        short-lived kind used for job submission).
- [ ] Add usage instructions to `SETUP-CLAUDE-DESKTOP.md` once the script
      exists (new MCP tool or new copy-paste prompt, matching the existing
      section style).
- [ ] Test end-to-end on one real class recording before treating this as
      the standard workflow.

## Explicitly not in scope

- Summary generation (Evernote's own).
- Russian translation, OpenSearch indexing, the remote `/api/jobs` path —
  all separate, untouched by this pipeline.
- Automating how the audio file gets exported from Zoom in the first
  place.
