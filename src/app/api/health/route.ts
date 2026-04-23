import { NextResponse } from "next/server";

/**
 * Public health check — does NOT require auth so monitoring can hit it.
 * Reports which secrets are configured but never their values.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "nrs-automated-transcriptions",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    config: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      deepgram_keys: [
        process.env.DEEPGRAM_API_KEY,
        process.env.DEEPGRAM_API_KEY_2,
        process.env.DEEPGRAM_API_KEY_3,
        process.env.DEEPGRAM_API_KEY_4,
        process.env.DEEPGRAM_API_KEY_5,
        process.env.DEEPGRAM_API_KEY_6,
        process.env.DEEPGRAM_API_KEY_7,
      ].filter(Boolean).length,
      groq_keys: [
        process.env.GROQ_API_KEY,
        process.env.GROQ_API_KEY_2,
        process.env.GROQ_API_KEY_3,
        process.env.GROQ_API_KEY_4,
      ].filter(Boolean).length,
      dynamodb: !!(process.env.DYNAMODB_ACCESS_KEY && process.env.DYNAMODB_SECRET_KEY),
      opensearch: !!(process.env.OPENSEARCH_URL && process.env.OPENSEARCH_PASS),
      auth: !!process.env.ADMIN_BEARER_TOKEN,
    },
  });
}
