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
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
