/**
 * Source resolvers for /api/transcribe.
 *
 * Each resolver takes the user-supplied `source_link` and returns the
 * shape /api/jobs expects: a downloadable audio URL + optional metadata
 * that the pipeline can stamp onto the resulting transcript.
 *
 * NRS: hits backend.niranjanaswami.net for a presigned S3 URL.
 * YT : @distube/ytdl-core extracts the direct googlevideo.com audio URL
 *      so the existing pipeline can stream from it without any S3
 *      round-trip.
 */

import ytdl from "@distube/ytdl-core";

const NRS_API_DETAIL = "https://backend.niranjanaswami.net/api/Lecture";

export type SourceKind = "nrs" | "yt";

export interface ResolvedSource {
  audio_url: string;          // downloadable URL the pipeline can fetch
  metadata: {
    uuid: string;
    title?: string;
    date?: string;
    year?: number;
    duration?: string;
    source_type: "lecture";
  };
}

export interface ResolverError {
  code: 400 | 404 | 502;
  message: string;
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function extractUuid(input: string): string | null {
  const m = UUID_RE.exec(input);
  return m ? m[0].toLowerCase() : null;
}

export async function resolveNrs(
  sourceLink: string
): Promise<ResolvedSource | ResolverError> {
  const uuid = extractUuid(sourceLink);
  if (!uuid) {
    return {
      code: 400,
      message:
        "Could not find a UUID in source_link. Expected an NRS lecture URL or a bare UUID.",
    };
  }

  const url = `${NRS_API_DETAIL}/${uuid}?author=ns`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: 502, message: `NRS API fetch failed: ${msg}` };
  }
  if (!res.ok) {
    return {
      code: res.status === 404 ? 404 : 502,
      message: `NRS API responded HTTP ${res.status}`,
    };
  }

  const payload = (await res.json()) as {
    data?: Record<string, unknown>;
    [k: string]: unknown;
  };
  const v = (payload?.data ?? payload) as {
    audioLinkPresigned?: string;
    audioLink?: string;
    publishedDate?: string;
    duration?: string;
    en?: { title?: string };
  };
  const audioUrl = v?.audioLinkPresigned || v?.audioLink;
  if (!audioUrl) {
    return {
      code: 404,
      message: `Lecture ${uuid} has no audioLink in catalog.`,
    };
  }

  const date = v?.publishedDate || "";
  const year = date ? parseInt(date.substring(0, 4), 10) : undefined;

  return {
    audio_url: audioUrl,
    metadata: {
      uuid,
      title: v?.en?.title || "",
      date,
      year: Number.isFinite(year) ? (year as number) : undefined,
      duration: v?.duration || "",
      source_type: "lecture",
    },
  };
}

const YT_ID_RE =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractYtId(input: string): string | null {
  // Plain 11-char ID (no URL) — accept directly.
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
  const m = YT_ID_RE.exec(input);
  return m ? m[1] : null;
}

export async function resolveYt(
  sourceLink: string
): Promise<ResolvedSource | ResolverError> {
  const videoId = extractYtId(sourceLink);
  if (!videoId) {
    return {
      code: 400,
      message:
        "Could not extract a YouTube video ID from source_link. Expected a YouTube URL or bare 11-char video ID.",
    };
  }

  let info: Awaited<ReturnType<typeof ytdl.getInfo>>;
  try {
    info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      code: 502,
      message: `YouTube fetch failed for ${videoId}: ${msg}`,
    };
  }

  // Pick the best audio-only format. ytdl annotates formats with hasAudio /
  // hasVideo / audioBitrate. Sort by bitrate desc and take the top.
  const audioOnly = info.formats
    .filter((f) => f.hasAudio && !f.hasVideo && f.url)
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
  const chosen = audioOnly[0] ?? info.formats.find((f) => f.hasAudio && f.url);
  if (!chosen || !chosen.url) {
    return {
      code: 502,
      message: `No playable audio format on YouTube video ${videoId}`,
    };
  }

  const v = info.videoDetails;
  const publishDate = v.publishDate || v.uploadDate || "";
  const isoDate = publishDate ? `${publishDate}T00:00:00.000Z` : "";
  const year = publishDate ? parseInt(publishDate.substring(0, 4), 10) : undefined;
  const lengthSec = parseInt(v.lengthSeconds || "0", 10);
  const duration = lengthSec
    ? new Date(lengthSec * 1000).toISOString().substring(11, 19)
    : "";

  return {
    audio_url: chosen.url,
    metadata: {
      uuid: `yt-${videoId}`,
      title: v.title || `YouTube ${videoId}`,
      date: isoDate,
      year: Number.isFinite(year) ? (year as number) : undefined,
      duration,
      source_type: "lecture",
    },
  };
}

export async function resolveSource(
  kind: SourceKind,
  sourceLink: string
): Promise<ResolvedSource | ResolverError> {
  if (kind === "nrs") return resolveNrs(sourceLink);
  if (kind === "yt") return resolveYt(sourceLink);
  return { code: 400, message: `Unknown source kind: ${kind}` };
}
