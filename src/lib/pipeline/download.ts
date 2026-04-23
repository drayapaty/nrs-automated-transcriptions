/**
 * Download audio from a presigned S3 URL into memory.
 *
 * Vercel functions have ~512 MB of /tmp and ~3 GB of memory; we keep the
 * payload in memory rather than writing to disk to avoid disk I/O overhead.
 * Existing transcripts max out under 100 KB; raw audio for a 60-min lecture
 * is typically 30–80 MB as MP3, well within memory.
 */

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500 MB sanity cap

export interface DownloadResult {
  buffer: Buffer;
  bytes: number;
  contentType: string;
}

export async function downloadAudio(presignedUrl: string): Promise<DownloadResult> {
  const res = await fetch(presignedUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(
      `Audio download failed: ${res.status} ${res.statusText} (URL truncated)`
    );
  }

  const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Audio file too large: ${contentLength} bytes > ${MAX_DOWNLOAD_BYTES} cap`
    );
  }

  const contentType = res.headers.get("content-type") || "audio/mpeg";
  const arrayBuf = await res.arrayBuffer();

  if (arrayBuf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Audio file too large after download: ${arrayBuf.byteLength} bytes`
    );
  }

  return {
    buffer: Buffer.from(arrayBuf),
    bytes: arrayBuf.byteLength,
    contentType,
  };
}
