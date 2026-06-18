# YouTube transcription — fallback plan

Three free tiers, automatic where possible, last-resort manual.

## Tier 1 — `@distube/ytdl-core` (primary, free)

Runs inside `resolveYt()` in `src/lib/source-resolvers.ts`. Pure JS,
no infra, no auth.

**When it fails:**

- `"Sign in to confirm you're not a bot"` — Vercel datacenter IPs hit
  YouTube's bot wall more often than residential IPs.
- `"Could not extract player config"` — YouTube updated its player;
  ytdl-core needs a patch release.
- HTTP 410 on signature URLs — signature decryption logic stale.

**Recovery:** none needed at this tier. Code automatically falls
through to Tier 2 on any thrown error.

**Maintenance:** `npm update @distube/ytdl-core` when you see
repeated failures. The Distube fork usually publishes a fix within a
few days of any YT player change.

## Tier 2 — `cobalt.tools` public API (fallback, free)

Same `resolveYt()` function tries this if Tier 1 throws. POSTs to
`<COBALT_API_URL>/api/json` with `{ url, isAudioOnly: true,
aFormat: "mp3" }` and uses the returned `url` directly as the audio
URL. Title comes from YouTube's free oEmbed endpoint.

**Defaults:** `COBALT_API_URL = https://api.cobalt.tools/` (set in
Vercel env if you need to swap).

**When it fails:**

- The public instance moved (HTTP 404 on the endpoint).
- Their rate limit kicked in (HTTP 429).
- Their backend is also bot-walled by YouTube (same upstream cause as
  Tier 1).

**Recovery when this dies for real:**

1. Find the current public instance — the
   [cobalt-tools/cobalt](https://github.com/imputnet/cobalt) GitHub
   repo's README links to community-run mirrors.
2. Vercel project settings → Environment Variables (scope:
   admin-v1 + production if/when this branch merges) → set
   `COBALT_API_URL=https://<new-instance>/`.
3. Push any commit to admin-v1 (or main) to redeploy.

**Cost:** $0 today. If cobalt ever paywalls, drop this tier.

## Tier 3 — local Mac, you-in-the-loop (last resort, free, bulletproof)

When both Tier 1 and Tier 2 are dead at the same time (rare but
plausible during a YouTube player rollout), Maharaja texts or emails
you the URL, and you run the local Bash wrapper in the sibling repo
`ask-niranjana-swami`:

```bash
cd ~/Documents/Divakar-Development/ask-niranjana-swami
./scripts/transcribe-yt.sh <youtube-url>
```

This uses `yt-dlp` natively on your Mac — residential IP, never
bot-walled, always works. Output lands in
`~/Downloads/yt-transcripts/<date>_<slug>_<id>/` with `phase1.md` as
the shareable artifact.

**Maintenance:** `brew upgrade yt-dlp` when its scrape breaks. The
yt-dlp project releases new builds frequently.

## NRS path is unaffected by any of this

`/api/transcribe { source: "nrs", source_link: "<URL or UUID>" }`
hits `backend.niranjanaswami.net` directly for a presigned audio URL.
No ytdl-core, no cobalt, no local script involved. The fallback plan
above is YouTube-only.

## Quick decision table

| Symptom | What to do |
|---|---|
| Single YT URL fails in admin UI | Retry once. Often transient (cold cache / rate-limit). |
| All YT URLs failing for >1 hr | Check Vercel function logs for the resolveYt warning. If `cobalt fallback also failed`, run Tier 3. |
| Tier 3 also failing | `brew upgrade yt-dlp` and retry. If still broken, YouTube has changed something fundamental — wait a day for yt-dlp/distube/cobalt to patch. |
| Single video fails but others work | The video itself may be age-restricted, members-only, or region-locked. Tier 3 with `--keep-audio` will surface the yt-dlp error. |
