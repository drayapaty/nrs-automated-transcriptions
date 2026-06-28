/**
 * S3 helpers for the direct-upload audio path.
 *
 * Browser uploads a file directly to S3 via a presigned PUT URL we hand
 * out from /api/ui/upload-init. After the upload completes, the browser
 * tells /api/ui/upload-done which presigns a short-lived GET URL and
 * forwards to /api/transcribe — same pipeline as NRS-source jobs.
 *
 * Bucket: nrs-transcribe-uploads (eu-central-1)
 *   Block all public access ✓
 *   7-day lifecycle expiration ✓
 *   CORS allows PUT from production + preview Vercel URLs and localhost ✓
 *
 * Env (defaults to existing DYNAMODB_* creds, can be overridden):
 *   S3_UPLOAD_BUCKET   default "nrs-transcribe-uploads"
 *   S3_UPLOAD_REGION   default DYNAMODB_REGION → "eu-central-1"
 *   S3_UPLOAD_ACCESS_KEY  default DYNAMODB_ACCESS_KEY
 *   S3_UPLOAD_SECRET_KEY  default DYNAMODB_SECRET_KEY
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

let _client: S3Client | null = null;
function s3(): S3Client {
  if (_client) return _client;
  const region =
    process.env.S3_UPLOAD_REGION || process.env.DYNAMODB_REGION || "eu-central-1";
  const accessKeyId =
    process.env.S3_UPLOAD_ACCESS_KEY || process.env.DYNAMODB_ACCESS_KEY;
  const secretAccessKey =
    process.env.S3_UPLOAD_SECRET_KEY || process.env.DYNAMODB_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("S3 credentials not configured (DYNAMODB_* or S3_UPLOAD_* env)");
  }
  _client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export function uploadBucket(): string {
  return process.env.S3_UPLOAD_BUCKET || "nrs-transcribe-uploads";
}

/**
 * Generate a fresh S3 key + presigned PUT URL for a browser-direct upload.
 * The key includes a UUID prefix so different uploads can't collide.
 */
export async function presignUpload(
  filename: string,
  contentType: string
): Promise<{ key: string; uploadUrl: string; expiresAt: string }> {
  // Sanitize filename (strip path components, dangerous chars).
  const safe = filename
    .replace(/.*[/\\]/, "")
    .replace(/[^\w.\-]/g, "_")
    .slice(0, 100) || "audio";
  const id = randomUUID();
  const key = `uploads/${id}/${safe}`;

  const cmd = new PutObjectCommand({
    Bucket: uploadBucket(),
    Key: key,
    ContentType: contentType || "application/octet-stream",
  });
  const uploadUrl = await getSignedUrl(s3(), cmd, { expiresIn: 600 }); // 10 min
  return {
    key,
    uploadUrl,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

/**
 * Generate a presigned GET URL for the pipeline to fetch the uploaded
 * audio. Short-lived so it can't leak indefinitely.
 */
export async function presignDownload(key: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: uploadBucket(),
    Key: key,
  });
  return await getSignedUrl(s3(), cmd, { expiresIn: 3600 }); // 1 hr
}
