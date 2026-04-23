/**
 * DynamoDB store for the per-request job state machine.
 *
 * Table:    nrs-transcribe-jobs
 * PK:       job_id (S)   — short uuid
 * TTL attr: ttl    (N)   — 30-day expiry
 *
 * Rows are short-lived job tracking. The actual transcripts live in
 * `nrs-lectures-auto-transcribe` (see lib/lectures.ts) and OpenSearch.
 */

import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo, TABLE_JOBS } from "./clients";
import type { Job, JobProgress, JobResult, JobStatus } from "./types";
import crypto from "crypto";

const TTL_DAYS = 30;

export function newJobId(): string {
  // 16-char alphanumeric — readable, URL-safe, low collision at our volume
  return crypto.randomBytes(8).toString("hex");
}

export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function ttlSeconds(): number {
  return Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60;
}

export async function createJob(job: Omit<Job, "ttl">): Promise<Job> {
  const item: Job = { ...job, ttl: ttlSeconds() };
  await dynamo().send(new PutCommand({ TableName: TABLE_JOBS, Item: item }));
  return item;
}

export async function getJob(job_id: string): Promise<Job | null> {
  const res = await dynamo().send(
    new GetCommand({ TableName: TABLE_JOBS, Key: { job_id } })
  );
  return (res.Item as Job | undefined) ?? null;
}

export async function setStatus(
  job_id: string,
  status: JobStatus,
  progress: JobProgress
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_JOBS,
      Key: { job_id },
      UpdateExpression:
        "SET #s = :s, progress = :p, updated_at = :u",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": status,
        ":p": progress,
        ":u": nowIso(),
      },
    })
  );
}

export async function setResult(
  job_id: string,
  result: JobResult
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_JOBS,
      Key: { job_id },
      UpdateExpression:
        "SET #s = :s, progress = :p, result = :r, updated_at = :u, finished_at = :f",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "done",
        ":p": { stage: "done", pct: 100 },
        ":r": result,
        ":u": nowIso(),
        ":f": nowIso(),
      },
    })
  );
}

export async function setError(job_id: string, error: string): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_JOBS,
      Key: { job_id },
      UpdateExpression:
        "SET #s = :s, error_msg = :e, updated_at = :u, finished_at = :f",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "failed",
        ":e": error,
        ":u": nowIso(),
        ":f": nowIso(),
      },
    })
  );
}
