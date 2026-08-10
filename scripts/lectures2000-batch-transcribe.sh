#!/bin/bash
# Batch-transcribe lectures from 2000 onward with no transcript yet
# (missing-transcripts/2000-onwards.csv). Excludes any UUID already covered
# by the Teachings of Queen Kunti batch (missing-transcripts/teachings-of-queen-kunti.csv,
# already done in full — see TQK/PROGRESS.md). Skips UUIDs whose slug folder
# already exists under LECTURES-2000/, downloads audio, runs transcribe-cli.ts,
# files output into LECTURES-2000/<slug>/. Progress tracked by folder existence
# + lectures2000-batch.log — regenerate PROGRESS.md separately afterward from
# the folder listing (same pattern as TQK/PROGRESS.md).
set -uo pipefail

LIMIT="${1:-10}"

REPO="/Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions"
OUT="/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/LECTURES-2000"
LOG="$OUT/lectures2000-batch.log"
AUDIO_TMP="/private/tmp/claude-501/-Users-divakar-Documents-Divakar-Development-Research/8eddc4f1-8bc0-4f36-a800-b7201562505b/scratchpad/lectures2000-audio"
mkdir -p "$OUT" "$AUDIO_TMP"

cd "$REPO"

python3 << 'PYEOF' > "$AUDIO_TMP/queue.tsv"
import csv
with open("/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/missing-transcripts/teachings-of-queen-kunti.csv") as f:
    tqk_uuids = set(r['uuid'] for r in csv.DictReader(f))
with open("/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/missing-transcripts/2000-onwards.csv") as f:
    rows = list(csv.DictReader(f))
missing = [r for r in rows if r['uuid'] not in tqk_uuids]
seen = {}
for r in missing:
    slug = f"{r['date']}_{r['location'].lower().replace(' ', '-').replace(',', '').replace('.', '')}_{r['reference'].replace('.', '-') if r['reference'] else 'notag'}"
    if slug in seen:
        seen[slug] += 1
        slug = f"{slug}-{seen[slug]}"
    else:
        seen[slug] = 1
    print(f"{r['uuid']}\t{slug}\t{r['s3_audio_url']}\t{r['title']}")
PYEOF

TOTAL=$(wc -l < "$AUDIO_TMP/queue.tsv" | tr -d ' ')
COUNT=0
ATTEMPTED=0

echo "=== LECTURES-2000 batch started, $TOTAL lectures in queue, this run limited to $LIMIT ===" >> "$LOG"

while IFS=$'\t' read -r UUID SLUG URL TITLE; do
  COUNT=$((COUNT + 1))

  LECDIR="$OUT/$SLUG"
  if [ -d "$LECDIR" ]; then
    echo "[$COUNT/$TOTAL] SKIP (already done): $SLUG" | tee -a "$LOG"
    continue
  fi

  if [ "$ATTEMPTED" -ge "$LIMIT" ]; then
    echo "" | tee -a "$LOG"
    echo "=== Run limit ($LIMIT) reached, stopping ===" | tee -a "$LOG"
    break
  fi
  ATTEMPTED=$((ATTEMPTED + 1))

  echo "" | tee -a "$LOG"
  echo "=== [$COUNT/$TOTAL, run $ATTEMPTED/$LIMIT] $TITLE ===" | tee -a "$LOG"

  AUDIO_EXT="${URL##*.}"
  AUDIO_PATH="$AUDIO_TMP/${SLUG}.${AUDIO_EXT}"

  echo "Downloading..." | tee -a "$LOG"
  if ! curl -sL --fail -o "$AUDIO_PATH" "$URL"; then
    echo "DOWNLOAD FAILED: $URL" | tee -a "$LOG"
    continue
  fi

  SIZE=$(stat -f%z "$AUDIO_PATH" 2>/dev/null || echo 0)
  if [ "$SIZE" -lt 100000 ]; then
    echo "DOWNLOAD TOO SMALL ($SIZE bytes), skipping" | tee -a "$LOG"
    rm -f "$AUDIO_PATH"
    continue
  fi

  echo "Transcribing..." | tee -a "$LOG"
  if npx tsx scripts/transcribe-cli.ts "$AUDIO_PATH" >> "$LOG" 2>&1; then
    mkdir -p "$LECDIR"
    BASE=$(basename "$AUDIO_PATH" ".$AUDIO_EXT")
    # transcribe-cli.ts slugifies its output name by replacing every non-alnum
    # char (including hyphens) with "_" -- must match that here or the mv's
    # silently no-op and strand the transcript files in ~/Downloads.
    OUTBASE=$(echo "$BASE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g')
    mv ~/Downloads/"${OUTBASE}"_raw.md "$LECDIR/"
    mv ~/Downloads/"${OUTBASE}"_cleaned.md "$LECDIR/"
    mv ~/Downloads/"${OUTBASE}"_restored.md "$LECDIR/"
    mv "$AUDIO_PATH" "$LECDIR/"
    echo "DONE: $LECDIR" | tee -a "$LOG"
  else
    echo "TRANSCRIBE FAILED: $TITLE" | tee -a "$LOG"
    rm -f "$AUDIO_PATH"
  fi
done < "$AUDIO_TMP/queue.tsv"

echo "" | tee -a "$LOG"
echo "=== BATCH COMPLETE: $COUNT lectures processed ===" | tee -a "$LOG"
