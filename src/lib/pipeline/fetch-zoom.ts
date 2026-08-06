/**
 * Fetch H.H. Niranjana Swami's latest Zoom class recording (audio only) via
 * Zoom's Server-to-Server OAuth API. Defaults to the most recent recording
 * on the account without confirmation — see DECISIONS.md 2026-08-06.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ZOOM_LECTURE_EMAIL = process.env.ZOOM_LECTURE_EMAIL || "nrs@niranjanaswami.com";

async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) {
    throw new Error("ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET not set");
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } }
  );
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Zoom auth failed: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

interface ZoomRecordingFile {
  file_type: string;
  recording_type: string;
  download_url: string;
  file_size: number;
}

interface ZoomMeeting {
  topic: string;
  start_time: string;
  recording_files: ZoomRecordingFile[];
}

function sanitizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Zoom's recordings API requires a bounded date range, not "everything". */
async function listRecentMeetings(token: string, daysBack = 7): Promise<ZoomMeeting[]> {
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const res = await fetch(
    `https://api.zoom.us/v2/users/${ZOOM_LECTURE_EMAIL}/recordings?from=${fmt(from)}&to=${fmt(to)}&page_size=30`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!data.meetings) {
    throw new Error(`Zoom recordings list failed: ${JSON.stringify(data)}`);
  }
  return (data.meetings as ZoomMeeting[]).sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );
}

export interface FetchZoomResult {
  outPath: string;
  topic: string;
  startTime: string;
  fileSizeBytes: number;
  ambiguous: boolean;
  candidateCount: number;
}

/**
 * Downloads the latest Zoom recording's audio-only file. Defaults to the
 * most recent meeting without confirmation. If more than one meeting shares
 * the same calendar day as the latest one, flags `ambiguous: true` rather
 * than silently guessing — caller decides how to handle it.
 */
export async function fetchLatestZoomRecording(
  destDir: string = join(homedir(), "Downloads")
): Promise<FetchZoomResult> {
  const token = await getZoomAccessToken();
  const meetings = await listRecentMeetings(token);

  if (meetings.length === 0) {
    throw new Error(`No Zoom recordings found for ${ZOOM_LECTURE_EMAIL} in the last 7 days`);
  }

  const latest = meetings[0];
  const latestDay = latest.start_time.slice(0, 10);
  const sameDayCount = meetings.filter((m) => m.start_time.slice(0, 10) === latestDay).length;

  const audioFile = latest.recording_files.find((f) => f.recording_type === "audio_only");
  if (!audioFile) {
    throw new Error(
      `Latest meeting "${latest.topic}" (${latest.start_time}) has no audio_only recording file`
    );
  }

  const date = latest.start_time.slice(0, 10);
  const topic = sanitizeTopic(latest.topic);
  const outPath = join(destDir, `${date}_zoom_${topic}.m4a`);

  const fileRes = await fetch(audioFile.download_url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) {
    throw new Error(`Zoom audio download failed: HTTP ${fileRes.status}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  writeFileSync(outPath, buffer);

  return {
    outPath,
    topic: latest.topic,
    startTime: latest.start_time,
    fileSizeBytes: buffer.length,
    ambiguous: sameDayCount > 1,
    candidateCount: sameDayCount,
  };
}
