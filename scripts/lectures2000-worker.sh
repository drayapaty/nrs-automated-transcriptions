#!/bin/bash
# Transcribe one lecture (single record: UUID<TAB>SLUG<TAB>URL<TAB>TITLE).
# Called by lectures2000-batch-transcribe.sh via `xargs -P N`, safe to run
# concurrently since each invocation only ever touches its own SLUG dir.
set -uo pipefail

LINE="$1"
IFS=$'\t' read -r UUID SLUG URL TITLE <<< "$LINE"

REPO="/Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions"
OUT="/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/LECTURES-2000"
LOG="$OUT/lectures2000-batch.log"
AUDIO_TMP="/private/tmp/claude-501/-Users-divakar-Documents-Divakar-Development-Research/8eddc4f1-8bc0-4f36-a800-b7201562505b/scratchpad/lectures2000-audio"

LECDIR="$OUT/$SLUG"
if [ -d "$LECDIR" ]; then
  echo "[$SLUG] SKIP (already done)" | tee -a "$LOG"
  exit 0
fi

echo "" | tee -a "$LOG"
echo "=== [$SLUG] START: $TITLE ===" | tee -a "$LOG"

AUDIO_EXT="${URL##*.}"
AUDIO_PATH="$AUDIO_TMP/${SLUG}.${AUDIO_EXT}"

# Some S3 keys in the source CSV contain raw spaces, '#', or other chars
# that are unsafe/meaningful in a URL (curl won't encode them itself and
# either mis-parses or gets rejected by S3). Percent-encode the path,
# preserving ':', '/', and existing '%' so already-encoded URLs aren't
# double-encoded.
FETCH_URL=$(python3 -c "import sys, urllib.parse as u; print(u.quote(sys.argv[1], safe=':/%'))" "$URL")

if ! curl -sL --fail -o "$AUDIO_PATH" "$FETCH_URL"; then
  echo "[$SLUG] DOWNLOAD FAILED: $URL" | tee -a "$LOG"
  exit 1
fi

SIZE=$(stat -f%z "$AUDIO_PATH" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 100000 ]; then
  echo "[$SLUG] DOWNLOAD TOO SMALL ($SIZE bytes), skipping" | tee -a "$LOG"
  rm -f "$AUDIO_PATH"
  exit 1
fi

cd "$REPO"
TMPLOG=$(mktemp)
if npx tsx scripts/transcribe-cli.ts "$AUDIO_PATH" > "$TMPLOG" 2>&1; then
  sed "s/^/[$SLUG] /" "$TMPLOG" | tee -a "$LOG" >/dev/null
  mkdir -p "$LECDIR"
  BASE=$(basename "$AUDIO_PATH" ".$AUDIO_EXT")
  OUTBASE=$(echo "$BASE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g')
  mv ~/Downloads/"${OUTBASE}"_raw.md "$LECDIR/"
  mv ~/Downloads/"${OUTBASE}"_cleaned.md "$LECDIR/"
  mv ~/Downloads/"${OUTBASE}"_restored.md "$LECDIR/"
  mv "$AUDIO_PATH" "$LECDIR/"
  echo "[$SLUG] DONE: $LECDIR" | tee -a "$LOG"
  rm -f "$TMPLOG"
else
  sed "s/^/[$SLUG] /" "$TMPLOG" | tee -a "$LOG" >/dev/null
  echo "[$SLUG] TRANSCRIBE FAILED: $TITLE" | tee -a "$LOG"
  rm -f "$AUDIO_PATH" "$TMPLOG"
  exit 1
fi
