"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";

type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "cleaning"
  | "translating"
  | "indexing"
  | "done"
  | "failed";

interface JobRecord {
  job_id: string;
  status: JobStatus | string;
  progress?: { stage?: string; pct?: number; message?: string };
  request?: { metadata?: { title?: string; date?: string; uuid?: string } };
  resolved?: { metadata?: { title?: string; date?: string; uuid?: string } };
  result?: { transcript_en?: string };
  error?: string;
  created_at?: string;
  updated_at?: string;
  finished_at?: string;
}

interface StoredJob {
  job_id: string;
  title: string;
  uuid: string;
  date: string;
  submitted_at: string;
}

const STORAGE_KEY = "nrs-transcribe-jobs";

function loadStored(): StoredJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredJob[]) : [];
  } catch {
    return [];
  }
}

function saveStored(jobs: StoredJob[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, 25)));
}

function badgeClass(status: string): string {
  if (status === "done") return "badge done";
  if (status === "failed" || status === "error") return "badge failed";
  if (status === "queued") return "badge queued";
  return "badge running";
}

function stageLabel(stage: string, status: string): string {
  const s = (stage || status || "").toLowerCase();
  switch (s) {
    case "queued":
      return "Queued — waiting for a worker";
    case "downloading":
      return "Downloading audio";
    case "transcribing":
      return "Transcribing (Deepgram)";
    case "cleaning":
      return "Cleaning Sanskrit + paragraphing (Sonnet)";
    case "translating":
      return "Translating";
    case "indexing":
      return "Indexing for search";
    case "done":
      return "Done";
    case "failed":
    case "error":
      return "Failed";
    default:
      return stage || status;
  }
}

function fmtAge(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Home() {
  const [source, setSource] = useState<"nrs" | "yt" | "upload">("nrs");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredJob[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobRecord>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const { data: session } = useSession();

  // Load history + remember last-used email on first paint.
  useEffect(() => {
    setStored(loadStored());
    const lastEmail =
      typeof window !== "undefined"
        ? localStorage.getItem("nrs-transcribe-notify-email") || ""
        : "";
    if (lastEmail) setNotifyEmail(lastEmail);
  }, []);

  // Poll every job that isn't done/failed.
  useEffect(() => {
    const active = stored.filter((s) => {
      const j = jobs[s.job_id];
      return !j || (j.status !== "done" && j.status !== "failed");
    });
    if (active.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      for (const s of active) {
        try {
          const res = await fetch(`/api/ui/job/${s.job_id}`);
          if (!res.ok) continue;
          const data = (await res.json()) as JobRecord;
          if (cancelled) return;
          setJobs((prev) => ({ ...prev, [s.job_id]: data }));
        } catch {
          /* ignore transient */
        }
      }
    };
    tick();
    const handle = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [stored, jobs]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedEmail = notifyEmail.trim();
    if (trimmedEmail && typeof window !== "undefined") {
      localStorage.setItem("nrs-transcribe-notify-email", trimmedEmail);
    }

    // === UPLOAD MODE — 3-step orchestration ===
    if (source === "upload") {
      if (!file) {
        setError("Pick an audio file to upload.");
        return;
      }
      setSubmitting(true);
      setUploadProgress(0);
      try {
        // Step 1 — ask the server for a presigned PUT URL
        const initRes = await fetch("/api/ui/upload-init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "audio/mpeg",
            size: file.size,
          }),
        });
        const initData = await initRes.json();
        if (!initRes.ok) {
          setError(initData?.error || `init failed (HTTP ${initRes.status})`);
          setSubmitting(false);
          setUploadProgress(null);
          return;
        }
        const { key, uploadUrl } = initData as { key: string; uploadUrl: string };

        // Step 2 — PUT the file directly to S3 with progress
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "audio/mpeg");
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
            }
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`S3 PUT failed (HTTP ${xhr.status})`));
          xhr.onerror = () => reject(new Error("Network error during upload"));
          xhr.send(file);
        });
        setUploadProgress(100);

        // Step 3 — tell the server the upload is done; it presigns a GET URL
        // and forwards to the transcription pipeline
        const doneRes = await fetch("/api/ui/upload-done", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key,
            filename: file.name,
            ...(trimmedEmail ? { notify_email: trimmedEmail } : {}),
          }),
        });
        const doneData = await doneRes.json();
        if (!doneRes.ok) {
          setError(doneData?.error || `submit failed (HTTP ${doneRes.status})`);
          setSubmitting(false);
          setUploadProgress(null);
          return;
        }
        const meta = doneData?.resolved?.metadata || {};
        const entry: StoredJob = {
          job_id: doneData.job_id,
          title: meta.title || file.name,
          uuid: meta.uuid || "",
          date: meta.date || "",
          submitted_at: new Date().toISOString(),
        };
        const next = [entry, ...stored];
        setStored(next);
        saveStored(next);
        setFile(null);
        // Reset native file input
        const inp = document.getElementById("file") as HTMLInputElement | null;
        if (inp) inp.value = "";
        setUploadProgress(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setUploadProgress(null);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // === URL MODE (nrs / yt) ===
    if (!link.trim()) {
      setError("Paste a lecture URL or UUID.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ui/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          source_link: link.trim(),
          ...(trimmedEmail ? { notify_email: trimmedEmail } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      const meta = data?.resolved?.metadata || {};
      const entry: StoredJob = {
        job_id: data.job_id,
        title: meta.title || "(untitled)",
        uuid: meta.uuid || "",
        date: meta.date || "",
        submitted_at: new Date().toISOString(),
      };
      const next = [entry, ...stored];
      setStored(next);
      saveStored(next);
      setLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function clearHistory() {
    setStored([]);
    setJobs({});
    setExpanded({});
    saveStored([]);
  }

  async function copyTranscript(jobId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(jobId);
      setTimeout(() => setCopied((c) => (c === jobId ? null : c)), 2000);
    } catch {
      setError("Copy failed — your browser blocked clipboard access.");
    }
  }

  return (
    <main className="container">
      <header className="header">
        <div className="om">श्री</div>
        <h1>Transcribe a Lecture</h1>
        <p className="subtitle">
          Paste a niranjanaswami.net lecture URL or UUID. The pipeline transcribes, cleans up Sanskrit, paragraphs, and indexes the result.
        </p>
      </header>

      <section className="card">
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div className="row">
            <div className="field shrink">
              <label htmlFor="source">Source</label>
              <select
                id="source"
                className="select"
                value={source}
                onChange={(e) => setSource(e.target.value as "nrs" | "yt" | "upload")}
              >
                <option value="nrs">NRS lecture</option>
                <option value="yt">YouTube</option>
                <option value="upload">Upload audio</option>
              </select>
            </div>
            {source !== "upload" ? (
              <div className="field">
                <label htmlFor="link">URL or UUID</label>
                <input
                  id="link"
                  className="input"
                  type="text"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder={
                    source === "nrs"
                      ? "https://niranjanaswami.net/media/lectures/<uuid>  or  <uuid>"
                      : "https://www.youtube.com/watch?v=…  or  https://youtu.be/…  or  11-char video id"
                  }
                  disabled={submitting}
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="file">Audio file (mp3, m4a, wav, webm)</label>
                <input
                  id="file"
                  className="input"
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.webm,.flac,.ogg"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={submitting}
                />
                {file && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                    {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                )}
                {uploadProgress !== null && (
                  <div className="progress" style={{ marginTop: 8 }}>
                    <div style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="notifyEmail">Notify when done (optional)</label>
            <input
              id="notifyEmail"
              className="input"
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={submitting}
              autoComplete="email"
            />
          </div>
          <div className="field">
            <button type="submit" className="btn btn-block" disabled={submitting}>
              {submitting ? <span className="spinner" /> : null}
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </section>

      <h2 className="section-title">Recent jobs</h2>
      {stored.length === 0 ? (
        <div className="empty">No jobs yet. Submit a lecture above.</div>
      ) : (
        <>
          <div className="jobs">
            {stored.map((s) => {
              const j = jobs[s.job_id];
              const status = j?.status || "queued";
              const pct = j?.progress?.pct ?? 0;
              const stage = j?.progress?.stage || status;
              const transcript = j?.result?.transcript_en?.trim() || "";
              const isExpanded = !!expanded[s.job_id];
              return (
                <div key={s.job_id} className={`job ${status === "done" ? "job-done" : ""}`}>
                  <div className="job-top">
                    <div className="job-title" title={s.title}>
                      {status === "done" ? "✓ " : ""}{s.title}
                    </div>
                    <div className="job-meta">{fmtAge(s.submitted_at)}</div>
                  </div>
                  <div className="job-bottom">
                    <span className={badgeClass(status)}>{status}</span>
                    <span className="stage-label">{stageLabel(stage, status)}{status !== "done" && status !== "failed" ? ` · ${pct}%` : ""}</span>
                  </div>
                  {status !== "done" && status !== "failed" && (
                    <div className="progress"><div style={{ width: `${pct}%` }} /></div>
                  )}
                  {status === "done" && transcript && (
                    <>
                      <div className="job-actions">
                        <button
                          type="button"
                          className="download-link download-link-btn"
                          onClick={() =>
                            setExpanded((e) => ({ ...e, [s.job_id]: !isExpanded }))
                          }
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? "▾ Hide transcript" : "▸ Read transcript"}
                        </button>
                        <button
                          type="button"
                          className="download-link download-link-btn"
                          onClick={() => copyTranscript(s.job_id, transcript)}
                        >
                          {copied === s.job_id ? "✓ Copied" : "⎘ Copy"}
                        </button>
                        <a
                          className="download-link"
                          href={`/api/ui/job/${s.job_id}/download?format=pdf`}
                          download
                        >
                          ⤓ PDF
                        </a>
                        <a
                          className="download-link"
                          href={`/api/ui/job/${s.job_id}/download?format=md`}
                          download
                        >
                          ⤓ Markdown
                        </a>
                        <a
                          className="download-link"
                          href={`/api/ui/job/${s.job_id}/download?format=txt`}
                          download
                        >
                          ⤓ Plain text
                        </a>
                      </div>
                      {isExpanded && (
                        <div className="transcript">
                          {transcript.split(/\n{2,}/).map((para, i) => (
                            <p key={i}>{para.trim()}</p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {j?.error && <div className="error" style={{ marginTop: 8 }}>{j.error}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button
              className="btn"
              style={{ background: "transparent", color: "var(--text-muted)", padding: "6px 14px", fontSize: 12 }}
              onClick={clearHistory}
            >
              clear history
            </button>
          </div>
        </>
      )}

      <footer className="footer">
        Niranjana Swami — Transcribe · {new Date().getFullYear()}
        {session?.user?.email && (
          <span style={{ marginLeft: 12 }}>
            · signed in as {session.user.email} ·{" "}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/signin" })}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--accent)",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
                textDecoration: "underline",
              }}
            >
              sign out
            </button>
          </span>
        )}
      </footer>
    </main>
  );
}
