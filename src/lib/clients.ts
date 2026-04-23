/**
 * Lazy singletons for external service clients.
 * Centralized here so env-var checks happen in one place.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import Groq from "groq-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let _anthropic: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

let _openai: OpenAI | null = null;
export function openai(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

let _groq: Groq | null = null;
let _groqKeyIdx = 0;

export function groqKeys(): string[] {
  return [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
  ].filter((k): k is string => !!k);
}

export function groq(): Groq {
  const keys = groqKeys();
  if (keys.length === 0) throw new Error("No Groq API keys configured");
  if (!_groq) _groq = new Groq({ apiKey: keys[_groqKeyIdx] });
  return _groq;
}

export function rotateGroqKey(): boolean {
  const keys = groqKeys();
  if (keys.length <= 1) return false;
  _groqKeyIdx = (_groqKeyIdx + 1) % keys.length;
  _groq = new Groq({ apiKey: keys[_groqKeyIdx] });
  return true;
}

export function deepgramKeys(): string[] {
  return [
    process.env.DEEPGRAM_API_KEY,
    process.env.DEEPGRAM_API_KEY_2,
    process.env.DEEPGRAM_API_KEY_3,
    process.env.DEEPGRAM_API_KEY_4,
    process.env.DEEPGRAM_API_KEY_5,
    process.env.DEEPGRAM_API_KEY_6,
    process.env.DEEPGRAM_API_KEY_7,
    process.env.DEEPGRAM_API_KEY_8,
    process.env.DEEPGRAM_API_KEY_9,
    process.env.DEEPGRAM_API_KEY_10,
  ].filter((k): k is string => !!k);
}

let _dynamo: DynamoDBDocumentClient | null = null;
export function dynamo(): DynamoDBDocumentClient {
  if (!_dynamo) {
    const region = process.env.DYNAMODB_REGION || "eu-central-1";
    const accessKeyId = process.env.DYNAMODB_ACCESS_KEY;
    const secretAccessKey = process.env.DYNAMODB_SECRET_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("DYNAMODB_ACCESS_KEY / DYNAMODB_SECRET_KEY not set");
    }
    const base = new DynamoDBClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    _dynamo = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _dynamo;
}

export const TABLE_JOBS = process.env.DYNAMODB_TABLE_JOBS || "nrs-transcribe-jobs";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
