# `admin-v1` — staging branch

This is a **long-lived feature branch**, not a short-lived PR branch.

## Purpose

Build the admin panel + iterate on `/api/transcribe` (incl. YouTube
source wiring) **without disturbing prod or local dev**.

## How it's deployed

Every push to `admin-v1` triggers a Vercel preview deployment. The
preview URL is stable per branch (auto-assigned by Vercel on the first
push). Production deployment on `main` is untouched.

## How to use

- Work commits land directly on `admin-v1` (or short PRs into it).
- Test against the preview URL with the same `ADMIN_BEARER_TOKEN` as
  prod (Vercel preview env vars are populated from production unless
  scoped otherwise).
- When the staging build proves out, open a PR `admin-v1` → `main` for
  the merge.

## Branch protection

Do NOT merge `admin-v1` → `main` accidentally. Treat as opt-in. The
branch is intentionally divergent from main.
