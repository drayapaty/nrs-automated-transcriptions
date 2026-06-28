"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function SignInForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter your email.");
      return;
    }
    setSubmitting(true);
    try {
      await signIn("email", { email: trimmed, callbackUrl, redirect: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <header className="header">
        <div className="om">श्री</div>
        <h1>Transcribe a Lecture</h1>
        <p className="subtitle">Sign in to continue. We send a magic link to your email.</p>
      </header>
      <section className="card">
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={submitting}
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className="field">
            <button type="submit" className="btn btn-block" disabled={submitting}>
              {submitting ? <span className="spinner" /> : null}
              {submitting ? "Sending link…" : "Send sign-in link"}
            </button>
          </div>
        </form>
      </section>
      <footer className="footer">
        Niranjana Swami — Transcribe · {new Date().getFullYear()}
      </footer>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="container"><div className="empty">Loading…</div></main>}>
      <SignInForm />
    </Suspense>
  );
}
