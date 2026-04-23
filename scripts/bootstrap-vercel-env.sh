#!/usr/bin/env bash
#
# One-shot Vercel environment bootstrap.
#
# Reads secrets from ../ask-niranjana-swami/.env.local (same source of truth
# so both projects stay in sync), generates a fresh ADMIN_BEARER_TOKEN, and
# pushes the full env set to this Vercel project for production + preview +
# development targets.
#
# Prerequisites:
#   1. Vercel CLI:    npm i -g vercel
#   2. Logged in:     vercel login
#   3. Project linked: vercel link   (run from this repo directory)
#
# Usage:
#   ./scripts/bootstrap-vercel-env.sh
#
# Re-running is safe — it removes any existing value and adds the new one
# for every variable.

set -euo pipefail

# --- Paths ------------------------------------------------------------------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ENV="${NRS_SOURCE_ENV:-$HERE/../ask-niranjana-swami/.env.local}"

# --- Preflight --------------------------------------------------------------
if ! command -v vercel >/dev/null 2>&1; then
  echo "❌ vercel CLI not found. Install with:  npm i -g vercel"
  exit 1
fi

if [ ! -f "$HERE/.vercel/project.json" ]; then
  echo "❌ This directory is not linked to a Vercel project."
  echo "   Run:  vercel link   (from $HERE)"
  exit 1
fi

if [ ! -f "$SOURCE_ENV" ]; then
  echo "❌ Source env file not found: $SOURCE_ENV"
  echo "   Set NRS_SOURCE_ENV to point at an .env file with your secrets."
  exit 1
fi

echo "✓ Source env: $SOURCE_ENV"
echo "✓ Vercel project: $(jq -r '.projectId // "?"' "$HERE/.vercel/project.json" 2>/dev/null || echo '?')"
echo

# --- Load source env file ---------------------------------------------------
# shellcheck disable=SC1090
set -a
. "$SOURCE_ENV"
set +a

# --- Helper: push one env var to Vercel (all three targets) -----------------
push_var() {
  local key="$1"
  local value="$2"

  if [ -z "${value:-}" ]; then
    echo "  ⊘ $key  (empty — skipped)"
    return
  fi

  for target in production preview development; do
    # Remove any existing value silently (ignore errors if it doesn't exist)
    vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
    # Add the new value via stdin
    printf "%s" "$value" | vercel env add "$key" "$target" >/dev/null 2>&1
  done
  echo "  ✓ $key"
}

# --- Generate a fresh ADMIN_BEARER_TOKEN ------------------------------------
if [ -z "${ADMIN_BEARER_TOKEN:-}" ]; then
  ADMIN_BEARER_TOKEN="$(openssl rand -hex 32)"
  echo "✓ Generated fresh ADMIN_BEARER_TOKEN"
else
  echo "✓ Reusing ADMIN_BEARER_TOKEN from source env"
fi
echo

# --- Push all env vars ------------------------------------------------------
echo "Pushing env vars to Vercel (production + preview + development)…"
echo

# Auth token for admin ↔ service
push_var ADMIN_BEARER_TOKEN            "$ADMIN_BEARER_TOKEN"

# Anthropic (Claude cleanup + translation)
push_var ANTHROPIC_API_KEY             "${ANTHROPIC_API_KEY:-}"

# OpenAI (embeddings for OpenSearch indexing)
push_var OPENAI_API_KEY                "${OPENAI_API_KEY:-}"

# Deepgram keys (Nova-3 primary, with rotation)
push_var DEEPGRAM_API_KEY              "${DEEPGRAM_API_KEY:-}"
push_var DEEPGRAM_API_KEY_2            "${DEEPGRAM_API_KEY_2:-}"
push_var DEEPGRAM_API_KEY_3            "${DEEPGRAM_API_KEY_3:-}"
push_var DEEPGRAM_API_KEY_4            "${DEEPGRAM_API_KEY_4:-}"
push_var DEEPGRAM_API_KEY_5            "${DEEPGRAM_API_KEY_5:-}"
push_var DEEPGRAM_API_KEY_6            "${DEEPGRAM_API_KEY_6:-}"
push_var DEEPGRAM_API_KEY_7            "${DEEPGRAM_API_KEY_7:-}"

# Groq keys (Whisper fallback)
push_var GROQ_API_KEY                  "${GROQ_API_KEY:-}"
push_var GROQ_API_KEY_2                "${GROQ_API_KEY_2:-}"
push_var GROQ_API_KEY_3                "${GROQ_API_KEY_3:-}"
push_var GROQ_API_KEY_4                "${GROQ_API_KEY_4:-}"

# DynamoDB (shared AWS account, but new table names for this service)
push_var DYNAMODB_REGION               "${DYNAMODB_REGION:-eu-central-1}"
push_var DYNAMODB_ACCESS_KEY           "${DYNAMODB_ACCESS_KEY:-}"
push_var DYNAMODB_SECRET_KEY           "${DYNAMODB_SECRET_KEY:-}"
push_var DYNAMODB_TABLE_JOBS           "nrs-transcribe-jobs"
push_var DYNAMODB_TABLE_LECTURES       "nrs-lectures-auto-transcribe"

# OpenSearch (ask-niranjana-swami calls these ELASTICSEARCH_* — remap here
# to the OPENSEARCH_* names this service expects, so both projects can keep
# their existing variable names without rename churn).
push_var OPENSEARCH_URL                "${OPENSEARCH_URL:-${ELASTICSEARCH_URL:-}}"
push_var OPENSEARCH_USER               "${OPENSEARCH_USER:-${ELASTICSEARCH_USER:-admin}}"
push_var OPENSEARCH_PASS               "${OPENSEARCH_PASS:-${ELASTICSEARCH_PASS:-}}"
push_var OPENSEARCH_INDEX              "${OPENSEARCH_INDEX:-${ELASTICSEARCH_INDEX:-ask-nrs-lectures}}"

# Model selection (can tune without code change)
push_var CLAUDE_MODEL                  "${CLAUDE_MODEL:-claude-sonnet-4-5}"

# Worker concurrency (affects Deepgram key rotation headroom)
push_var MAX_CONCURRENT_JOBS           "${MAX_CONCURRENT_JOBS:-3}"

echo
echo "✓ All env vars pushed."
echo
echo "Next steps:"
echo "  1. (One-time) Create DynamoDB tables locally:"
echo "       cp .env.example .env.local     # fill in same values"
echo "       npm run create-tables"
echo
echo "  2. Trigger a production deploy:"
echo "       vercel --prod"
echo
echo "  3. Smoke test:"
echo "       curl https://<deploy-url>/api/health"
echo

# --- Save ADMIN_BEARER_TOKEN locally for convenience ------------------------
TOKEN_FILE="$HERE/.vercel/.admin-bearer-token"
{
  echo "# Generated by bootstrap-vercel-env.sh on $(date -u +%FT%TZ)"
  echo "# Use this token in the admin page config to call the service."
  echo "ADMIN_BEARER_TOKEN=$ADMIN_BEARER_TOKEN"
} > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
echo "✓ ADMIN_BEARER_TOKEN saved to $TOKEN_FILE  (gitignored)"
