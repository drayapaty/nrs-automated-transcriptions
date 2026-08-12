#!/bin/bash
# Batch-transcribe lectures from 2000 onward with no transcript yet
# (missing-transcripts/2000-onwards.csv). Excludes any UUID already covered
# by the Teachings of Queen Kunti batch (missing-transcripts/teachings-of-queen-kunti.csv,
# already done in full — see TQK/PROGRESS.md). Skips UUIDs whose slug folder
# already exists under LECTURES-2000/, downloads audio, runs transcribe-cli.ts
# via lectures2000-worker.sh, files output into LECTURES-2000/<slug>/.
#
# Runs CONCURRENCY lectures in parallel via `xargs -P` (each worker only
# touches its own slug dir, safe to overlap). Progress tracked by folder
# existence + lectures2000-batch.log — regenerate PROGRESS.md separately
# afterward from the folder listing (same pattern as TQK/PROGRESS.md).
set -uo pipefail

LIMIT="${1:-10}"
CONCURRENCY="${2:-4}"

REPO="/Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions"
OUT="/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/LECTURES-2000"
LOG="$OUT/lectures2000-batch.log"
AUDIO_TMP="/private/tmp/claude-501/-Users-divakar-Documents-Divakar-Development-Research/8eddc4f1-8bc0-4f36-a800-b7201562505b/scratchpad/lectures2000-audio"
mkdir -p "$OUT" "$AUDIO_TMP"

# Unique per-invocation scratch files — a shared fixed filename here would
# let two overlapping invocations of this script clobber each other's queue
# mid-read (silent truncation, only a handful of workers ever dispatched).
QUEUE_FILE="$AUDIO_TMP/queue-main-$$.nul"
TODO_FILE="$AUDIO_TMP/todo-main-$$.nul"
cleanup() { rm -f "$QUEUE_FILE" "$TODO_FILE"; }
trap cleanup EXIT

cd "$REPO"

python3 << 'PYEOF' > "$QUEUE_FILE"
import csv, sys, os
with open("/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/missing-transcripts/teachings-of-queen-kunti.csv") as f:
    tqk_uuids = set(r['uuid'] for r in csv.DictReader(f))
known_bad = set()
kf_path = "/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/LECTURES-2000/known-failures.txt"
if os.path.exists(kf_path):
    with open(kf_path) as f:
        known_bad = set(line.strip() for line in f if line.strip())
with open("/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/missing-transcripts/2000-onwards.csv") as f:
    rows = list(csv.DictReader(f))
missing = [r for r in rows if r['uuid'] not in tqk_uuids and r['uuid'] not in known_bad]
seen = {}
out = sys.stdout
for r in missing:
    slug = f"{r['date']}_{r['location'].lower().replace(' ', '-').replace(',', '').replace('.', '')}_{r['reference'].replace('.', '-') if r['reference'] else 'notag'}"
    if slug in seen:
        seen[slug] += 1
        slug = f"{slug}-{seen[slug]}"
    else:
        seen[slug] = 1
    out.write(f"{r['uuid']}\t{slug}\t{r['s3_audio_url']}\t{r['title']}\0")
PYEOF

TOTAL=$(tr -cd '\0' < "$QUEUE_FILE" | wc -c | tr -d ' ')

# Slugs currently claimed by any other concurrently-running invocation
# (either pool) — glob every live todo file except our own.
: > "$AUDIO_TMP/inflight-exclude-main-$$.txt"
for f in "$AUDIO_TMP"/todo-main-*.nul "$AUDIO_TMP"/todo-paid-*.nul; do
  [ -f "$f" ] && [ "$f" != "$TODO_FILE" ] && tr '\0' '\n' < "$f" | cut -f2 >> "$AUDIO_TMP/inflight-exclude-main-$$.txt"
done

# Filter to not-yet-done and not in-flight elsewhere, cap to LIMIT.
: > "$TODO_FILE"
DONE_COUNT=0
SKIP_INFLIGHT=0
TODO_COUNT=0
while IFS=$'\t' read -r -d '' UUID SLUG URL TITLE; do
  if [ -d "$OUT/$SLUG" ]; then
    DONE_COUNT=$((DONE_COUNT + 1))
    continue
  fi
  if grep -qxF "$SLUG" "$AUDIO_TMP/inflight-exclude-main-$$.txt" 2>/dev/null; then
    SKIP_INFLIGHT=$((SKIP_INFLIGHT + 1))
    continue
  fi
  if [ "$TODO_COUNT" -ge "$LIMIT" ]; then
    continue
  fi
  printf '%s\t%s\t%s\t%s\0' "$UUID" "$SLUG" "$URL" "$TITLE" >> "$TODO_FILE"
  TODO_COUNT=$((TODO_COUNT + 1))
done < "$QUEUE_FILE"
rm -f "$AUDIO_TMP/inflight-exclude-main-$$.txt"

echo "" | tee -a "$LOG"
echo "=== LECTURES-2000 batch started: $DONE_COUNT/$TOTAL already done, $SKIP_INFLIGHT skipped (in-flight elsewhere), dispatching $TODO_COUNT more at concurrency $CONCURRENCY ===" | tee -a "$LOG"

xargs -0 -n1 -P "$CONCURRENCY" "$REPO/scripts/lectures2000-worker.sh" < "$TODO_FILE"

echo "" | tee -a "$LOG"
echo "=== BATCH COMPLETE: $TODO_COUNT lectures dispatched ===" | tee -a "$LOG"
