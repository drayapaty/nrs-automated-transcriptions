"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const MESSAGES: Record<string, string> = {
  AccessDenied: "Your email is not on the allow-list for this app.",
  Verification: "The sign-in link is invalid or has expired.",
  Configuration: "Server auth configuration error. Contact the admin.",
};

function ErrorBody() {
  const params = useSearchParams();
  const code = params.get("error") || "Default";
  const msg = MESSAGES[code] || "Something went wrong during sign-in.";
  return (
    <main className="container">
      <header className="header">
        <div className="om">श्री</div>
        <h1>Sign-in error</h1>
      </header>
      <section className="card">
        <div className="error">{msg}</div>
        <div style={{ marginTop: 18 }}>
          <Link className="btn btn-block" href="/signin">Try again</Link>
        </div>
      </section>
      <footer className="footer">
        Niranjana Swami — Transcribe · {new Date().getFullYear()}
      </footer>
    </main>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<main className="container"><div className="empty">Loading…</div></main>}>
      <ErrorBody />
    </Suspense>
  );
}
