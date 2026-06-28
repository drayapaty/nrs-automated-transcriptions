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
  // Explicit JWT strategy — must match src/auth.ts so the cookie format
  // is identical between Edge middleware (this config) and the Node
  // runtime route handler (auth.ts).
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
    error: "/signin/error",
  },
  providers: [], // edge-safe: providers added in src/auth.ts
  callbacks: {
    // Always return true. Gating happens in src/middleware.ts; we still
    // need this callback so the auth() wrapper populates req.auth for
    // our custom middleware function. Without it, req.auth was null for
    // every request and every API call returned 401 even when the user
    // had a valid session cookie.
    authorized() {
      return true;
    },
  },
} satisfies NextAuthConfig;
