/**
 * Source resolvers for /api/transcribe.
 *
 * Each resolver takes the user-supplied `source_link` and returns the
 * shape /api/jobs expects: a downloadable audio URL + optional metadata
 * that the pipeline can stamp onto the resulting transcript.
 *
 * v0 supports NRS only. YT is stubbed pending a yt-dlp / ytdl-core
 * integration on the serverless edge.
 */

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

export async function resolveYt(
  _sourceLink: string
): Promise<ResolvedSource | ResolverError> {
  return {
    code: 400,
    message:
      "YouTube source not yet supported. Use source=nrs with an NRS lecture URL or UUID. (Tracking in next iteration.)",
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
