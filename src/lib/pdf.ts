/**
 * Render a finished transcription job to a PDF buffer.
 *
 * Pure-JS via @react-pdf/renderer — no headless Chromium, works on
 * Vercel serverless without extra binaries. Default fonts (Times-Roman,
 * Helvetica) carry the Latin Extended Additional block, so IAST
 * diacritics (ḥ ṛ ṣ ṅ ñ ā ī ū ś ṭ ḍ ṁ ḷ) render correctly.
 */

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { Job } from "./types";
import React from "react";

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 64,
    paddingHorizontal: 64,
    fontFamily: "Times-Roman",
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "#2a1a1a",
  },
  title: {
    fontFamily: "Times-Bold",
    fontSize: 20,
    marginBottom: 4,
  },
  meta: {
    fontSize: 10,
    color: "#6b5f55",
    fontFamily: "Times-Italic",
  },
  divider: {
    marginTop: 14,
    marginBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: "#c9bca8",
  },
  paragraph: {
    marginBottom: 9,
    textAlign: "justify",
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 64,
    right: 64,
    textAlign: "center",
    fontSize: 9,
    color: "#a59885",
    fontFamily: "Times-Italic",
  },
});

interface TranscriptDocProps {
  title: string;
  date: string;
  location: string;
  paragraphs: string[];
}

function TranscriptDoc(props: TranscriptDocProps) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(View, null,
        React.createElement(Text, { style: styles.title }, props.title)
      ),
      props.date
        ? React.createElement(Text, { style: styles.meta }, props.date)
        : null,
      props.location
        ? React.createElement(Text, { style: styles.meta }, props.location)
        : null,
      React.createElement(View, { style: styles.divider }),
      ...props.paragraphs.map((p, i) =>
        React.createElement(Text, { key: i, style: styles.paragraph }, p)
      ),
      React.createElement(
        Text,
        {
          style: styles.footer,
          render: (rp: { pageNumber: number; totalPages: number }) =>
            `${rp.pageNumber} / ${rp.totalPages}`,
          fixed: true,
        }
      )
    )
  );
}

export async function transcriptToPdfBuffer(job: Job): Promise<Buffer> {
  const m = job.request.metadata;
  const title = m?.title || "(untitled)";
  const date = m?.date ? String(m.date).substring(0, 10) : "";
  const location = m?.location || "";
  const paragraphs = (job.result?.transcript_en || "(no transcript)")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const doc = TranscriptDoc({ title, date, location, paragraphs });
  const blob = await pdf(doc).toBuffer();
  // pdf().toBuffer() returns a NodeJS stream in some versions; flatten.
  if (Buffer.isBuffer(blob)) return blob;
  return await streamToBuffer(blob as unknown as NodeJS.ReadableStream);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
