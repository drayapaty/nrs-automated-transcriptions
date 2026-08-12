#!/bin/bash
# Same as lectures2000-batch-transcribe.sh, but forces GROQ_API_KEY_14 (the
# paid-tier key) as the ONLY Groq key for this process tree, so its usage is
# isolated/measurable separately from the 13-key free-tier rotation pool.
# Skips any slug already done AND any slug currently in-flight in another
# concurrently-running invocation (either pool), to avoid double-processing
# the same lecture.
set -uo pipefail

LIMIT="${1:-25}"
CONCURRENCY="${2:-5}"

REPO="/Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions"
OUT="/Users/divakar/Documents/Divakar-Development/ask-niranjana-swami/LECTURES-2000"
LOG="$OUT/lectures2000-batch.log"
AUDIO_TMP="/private/tmp/claude-501/-Users-divakar-Documents-Divakar-Development-Research/8eddc4f1-8bc0-4f36-a800-b7201562505b/scratchpad/lectures2000-audio"
mkdir -p "$OUT" "$AUDIO_TMP"

# Unique per-invocation scratch files — a shared fixed filename here would
# let two overlapping invocations (this script or the main-pool one) clobber
# each other's queue mid-read (silent truncation, only a handful of workers
# ever dispatched).
QUEUE_FILE="$AUDIO_TMP/queue-paid-$$.nul"
TODO_FILE="$AUDIO_TMP/todo-paid-$$.nul"
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
: > "$AUDIO_TMP/inflight-exclude-paid-$$.txt"
for f in "$AUDIO_TMP"/todo-main-*.nul "$AUDIO_TMP"/todo-paid-*.nul; do
  [ -f "$f" ] && [ "$f" != "$TODO_FILE" ] && tr '\0' '\n' < "$f" | cut -f2 >> "$AUDIO_TMP/inflight-exclude-paid-$$.txt"
done

: > "$TODO_FILE"
DONE_COUNT=0
SKIP_INFLIGHT=0
TODO_COUNT=0
while IFS=$'\t' read -r -d '' UUID SLUG URL TITLE; do
  if [ -d "$OUT/$SLUG" ]; then
    DONE_COUNT=$((DONE_COUNT + 1))
    continue
  fi
  if grep -qxF "$SLUG" "$AUDIO_TMP/inflight-exclude-paid-$$.txt" 2>/dev/null; then
    SKIP_INFLIGHT=$((SKIP_INFLIGHT + 1))
    continue
  fi
  if [ "$TODO_COUNT" -ge "$LIMIT" ]; then
    continue
  fi
  printf '%s\t%s\t%s\t%s\0' "$UUID" "$SLUG" "$URL" "$TITLE" >> "$TODO_FILE"
  TODO_COUNT=$((TODO_COUNT + 1))
done < "$QUEUE_FILE"
rm -f "$AUDIO_TMP/inflight-exclude-paid-$$.txt"

echo "" | tee -a "$LOG"
echo "=== LECTURES-2000 PAID-KEY batch started: $DONE_COUNT/$TOTAL done, $SKIP_INFLIGHT skipped (in-flight elsewhere), dispatching $TODO_COUNT more at concurrency $CONCURRENCY on GROQ_API_KEY_14 only ===" | tee -a "$LOG"

# Force single-key mode: export the paid key as GROQ_API_KEY and blank out
# all the others so dotenv.config() (no override) leaves them blank —
# groqKeys() filters blanks out, leaving only this one key.
export GROQ_API_KEY
GROQ_API_KEY=$(grep '^GROQ_API_KEY_14=' .env.local | cut -d'"' -f2)
for i in $(seq 2 14); do
  export "GROQ_API_KEY_$i="
done

xargs -0 -n1 -P "$CONCURRENCY" "$REPO/scripts/lectures2000-worker.sh" < "$TODO_FILE"

echo "" | tee -a "$LOG"
echo "=== PAID-KEY BATCH COMPLETE: $TODO_COUNT lectures dispatched ===" | tee -a "$LOG"
