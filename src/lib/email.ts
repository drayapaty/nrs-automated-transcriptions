/**
 * AWS SES email notifications for transcription jobs.
 *
 * Env:
 *   SES_REGION         — defaults to DYNAMODB_REGION, then "us-east-1"
 *   SES_ACCESS_KEY     — defaults to DYNAMODB_ACCESS_KEY (reuse)
 *   SES_SECRET_KEY     — defaults to DYNAMODB_SECRET_KEY (reuse)
 *   SES_FROM_EMAIL     — REQUIRED, must be SES-verified in the configured region
 *
 * If SES_FROM_EMAIL is unset the helpers no-op + log; the pipeline keeps
 * running. This keeps the admin UI usable in dev environments that don't
 * have SES wired up.
 */

import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import type { Job } from "./types";

let _ses: SESv2Client | null = null;
function ses(): SESv2Client | null {
  if (_ses) return _ses;
  const region =
    process.env.SES_REGION || process.env.DYNAMODB_REGION || "us-east-1";
  const accessKeyId =
    process.env.SES_ACCESS_KEY || process.env.DYNAMODB_ACCESS_KEY;
  const secretAccessKey =
    process.env.SES_SECRET_KEY || process.env.DYNAMODB_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.warn("[email] AWS credentials not configured; email disabled");
    return null;
  }
  _ses = new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _ses;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMarkdown(job: Job): string {
  const m = job.request.metadata;
  const r = job.result;
  const title = m?.title || "(untitled)";
  const date = m?.date ? String(m.date).substring(0, 10) : "";
  const location = m?.location || "";
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  if (date) lines.push(`*${date}*`);
  if (location) lines.push(`*${location}*`);
  if (date || location) lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(r?.transcript_en?.trim() || "(no transcript)");
  lines.push("");
  return lines.join("\n");
}

function buildHtml(job: Job): string {
  const m = job.request.metadata;
  const r = job.result;
  const title = escapeHtml(m?.title || "(untitled)");
  const date = m?.date ? escapeHtml(String(m.date).substring(0, 10)) : "";
  const location = m?.location ? escapeHtml(m.location) : "";
  const paragraphs = (r?.transcript_en || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: Georgia, serif; max-width: 720px; margin: 32px auto; padding: 0 20px; line-height: 1.55; color: #2a1a1a;">
  <h1 style="font-weight: 500;">${title}</h1>
  ${date ? `<p style="color:#6b5f55; margin: 0;"><em>${date}</em></p>` : ""}
  ${location ? `<p style="color:#6b5f55; margin: 0 0 24px;"><em>${location}</em></p>` : "<div style='height:24px'></div>"}
  <hr style="border: none; border-top: 1px solid #e8dfd0; margin: 24px 0;">
  ${paragraphs}
</body>
</html>`;
}

export async function sendCompletionEmail(
  toEmail: string,
  job: Job
): Promise<{ sent: boolean; reason?: string }> {
  const client = ses();
  const from = process.env.SES_FROM_EMAIL;
  if (!client || !from) {
    return { sent: false, reason: "SES not configured (no FROM or creds)" };
  }

  const m = job.request.metadata;
  const title = m?.title || job.job_id;
  const subject = `Transcript ready — ${title}`;
  const md = buildMarkdown(job);
  const html = buildHtml(job);

  const fileBaseName = (m?.title || "transcript")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);

  // Build raw MIME with .md attachment for archival; HTML inline for reading.
  const boundary = "----nrs-transcript-" + job.job_id.slice(0, 12);
  const rawMessage = [
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf-8").toString("base64"),
    `--${boundary}`,
    `Content-Type: text/markdown; name="${fileBaseName}.md"`,
    `Content-Disposition: attachment; filename="${fileBaseName}.md"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(md, "utf-8").toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const input: SendEmailCommandInput = {
    FromEmailAddress: from,
    Destination: { ToAddresses: [toEmail] },
    Content: { Raw: { Data: Buffer.from(rawMessage, "utf-8") } },
  };

  try {
    await client.send(new SendEmailCommand(input));
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[email] send failed to ${toEmail}: ${msg}`);
    return { sent: false, reason: msg };
  }
}

export async function sendFailureEmail(
  toEmail: string,
  job: Job,
  errorMsg: string
): Promise<{ sent: boolean; reason?: string }> {
  const client = ses();
  const from = process.env.SES_FROM_EMAIL;
  if (!client || !from) {
    return { sent: false, reason: "SES not configured" };
  }
  const title = job.request.metadata?.title || job.job_id;
  const subject = `Transcription failed — ${title}`;
  const body = `The transcription job for "${title}" did not complete.

Error: ${errorMsg}

Job id: ${job.job_id}
Submitted: ${job.created_at}
`;
  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [toEmail] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Text: { Data: body, Charset: "UTF-8" } },
          },
        },
      })
    );
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[email] failure send to ${toEmail}: ${msg}`);
    return { sent: false, reason: msg };
  }
}
