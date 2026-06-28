/**
 * NextAuth v5 configuration — email magic-link auth via SES, sessions in
 * DynamoDB (table: AUTH_DYNAMODB_TABLE, default "nrs-auth"), allowlist
 * enforced in signIn callback.
 *
 * Env:
 *   AUTH_SECRET                  required, openssl rand -base64 32
 *   AUTH_DYNAMODB_TABLE          defaults to "nrs-auth"
 *   AUTH_DYNAMODB_REGION         defaults to DYNAMODB_REGION
 *   AUTH_DYNAMODB_ACCESS_KEY     defaults to DYNAMODB_ACCESS_KEY
 *   AUTH_DYNAMODB_SECRET_KEY     defaults to DYNAMODB_SECRET_KEY
 *   ALLOWED_EMAILS               comma-separated; "*" or unset = anyone
 *   SES_FROM_EMAIL               required (also used by completion email)
 *   SES_REGION                   defaults to us-east-1 (where idents live)
 *   AUTH_TRUST_HOST              set "true" on Vercel
 */

import NextAuth from "next-auth";
import { DynamoDBAdapter } from "@auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { authConfig as baseConfig } from "./auth.config";

function dynamo(): DynamoDBDocument {
  const region =
    process.env.AUTH_DYNAMODB_REGION ||
    process.env.DYNAMODB_REGION ||
    "eu-central-1";
  const accessKeyId =
    process.env.AUTH_DYNAMODB_ACCESS_KEY || process.env.DYNAMODB_ACCESS_KEY;
  const secretAccessKey =
    process.env.AUTH_DYNAMODB_SECRET_KEY || process.env.DYNAMODB_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Auth DynamoDB credentials missing");
  }
  const client = new DynamoDBClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return DynamoDBDocument.from(client, {
    marshallOptions: {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  });
}

function allowedEmails(): Set<string> | null {
  const raw = (process.env.ALLOWED_EMAILS || "").trim();
  if (!raw || raw === "*") return null; // null = allow anyone
  return new Set(
    raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((s) => s.toLowerCase())
  );
}

function sesClient(): SESv2Client {
  const region =
    process.env.SES_REGION || process.env.DYNAMODB_REGION || "us-east-1";
  const accessKeyId =
    process.env.SES_ACCESS_KEY || process.env.DYNAMODB_ACCESS_KEY;
  const secretAccessKey =
    process.env.SES_SECRET_KEY || process.env.DYNAMODB_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("SES credentials missing");
  }
  return new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function magicLinkHtml(url: string, host: string): string {
  return `<!doctype html>
<html><body style="font-family: Georgia, serif; max-width: 540px; margin: 32px auto; padding: 0 20px; line-height: 1.55; color: #2a1a1a; background: #faf6ef;">
  <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 500; color: #7d1f1f;">Sign in to Transcribe</h1>
  <p>Click the link below to sign in to <strong>${host}</strong>. The link expires in 24 hours and can be used once.</p>
  <p style="margin: 28px 0;">
    <a href="${url}" style="display: inline-block; padding: 12px 22px; background: #7d1f1f; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Sign in</a>
  </p>
  <p style="font-size: 13px; color: #6b5f55;">If you did not request this, you can ignore this email.</p>
</body></html>`;
}

function magicLinkText(url: string, host: string): string {
  return `Sign in to ${host}

Click this link to sign in (expires in 24 hours, single use):

${url}

If you did not request this, you can ignore this email.
`;
}

// NextAuth v5 lazy-config form. Passing a function (instead of an object)
// defers config construction to the first request — so build-time static
// analysis ("Collecting page data") doesn't try to instantiate the
// DynamoDB adapter (which needs env vars not present during build).
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...baseConfig,
  adapter: DynamoDBAdapter(dynamo(), {
    tableName: process.env.AUTH_DYNAMODB_TABLE || "nrs-auth",
    partitionKey: "pk",
    sortKey: "sk",
    indexName: "GSI1",
    indexPartitionKey: "GSI1PK",
    indexSortKey: "GSI1SK",
  }),
  // JWT session strategy lets the Edge middleware verify sessions without
  // hitting DynamoDB (database strategy would require a DB lookup per
  // request and the middleware can't do that). Adapter is still used to
  // persist users + verification tokens for the magic-link flow.
  session: { strategy: "jwt" },
  providers: [
    {
      id: "email",
      type: "email",
      name: "Email",
      from: process.env.SES_FROM_EMAIL,
      maxAge: 24 * 60 * 60,
      options: {},
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        const from = (provider as { from?: string }).from || process.env.SES_FROM_EMAIL;
        if (!from) throw new Error("SES_FROM_EMAIL not configured");
        const host = new URL(url).host;
        const client = sesClient();
        await client.send(
          new SendEmailCommand({
            FromEmailAddress: from,
            Destination: { ToAddresses: [identifier] },
            Content: {
              Simple: {
                Subject: {
                  Data: `Sign in to ${host}`,
                  Charset: "UTF-8",
                },
                Body: {
                  Html: { Data: magicLinkHtml(url, host), Charset: "UTF-8" },
                  Text: { Data: magicLinkText(url, host), Charset: "UTF-8" },
                },
              },
            },
          })
        );
      },
    },
  ],
  callbacks: {
    async signIn({ user }) {
      const allow = allowedEmails();
      if (!allow) return true;
      const email = (user?.email || "").toLowerCase();
      if (!email) return false;
      return allow.has(email);
    },
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
}));
