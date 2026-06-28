/**
 * Edge-safe auth config — no adapter, no AWS SDK. Used by middleware.ts
 * which runs in Edge runtime and cannot import the DynamoDB adapter.
 * The full config (with adapter + SES provider) lives in src/auth.ts and
 * is used by the route handler at app/api/auth/[...nextauth]/route.ts.
 */

import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
    error: "/signin/error",
  },
  providers: [], // edge-safe: providers added in src/auth.ts
  // No `authorized` callback — auth gating is handled entirely by
  // src/middleware.ts so we have one path that runs for every request
  // and uniform 401/redirect behavior across HTTP methods.
} satisfies NextAuthConfig;
