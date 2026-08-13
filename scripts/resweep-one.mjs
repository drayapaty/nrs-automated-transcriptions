import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
dotenv.config({ path: "/Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions/.env.local" });

const path = "/Users/divakar/Downloads/bb-book-chapters-2026-08-05/2026_04_26_bb_1_2_50_52/2026_04_26_bb_1_2_50_52_chapter_voiced.md";
const text = readFileSync(path, "utf-8");

const { anthropic, CLAUDE_MODEL } = await import("/Users/divakar/Documents/Divakar-Development/nrs-automated-transcriptions/src/lib/clients.ts");

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const response = await anthropic().messages.create({
  model: HAIKU_MODEL,
  max_tokens: 8000,
  system:
    "This is a first-person book chapter written by a spiritual teacher who is the book's author — it is book prose, not lecture notes or a transcript. The reader is not physically present with him; he is writing for someone reading the finished book later, not addressing a live room. Find every place where the text implies the reader was live and present with him at a spoken gathering — not just explicit words like \"class\"/\"session\"/\"talk,\" but ALSO subtler phrasing like \"when we left off,\" \"as we were saying,\" \"we ended there last time,\" references to who was physically \"present\" at a specific talk versus who was not, phrases like \"next time,\" or anything else that presumes the reader shared a real-time moment with him rather than reading a written chapter — and rewrite ONLY those specific spots into book-appropriate narrative continuity (e.g. referring back to what the chapter itself established, not to a shared live moment), while preserving the exact same meaning, voice, and every other word of the rest of the text unchanged. If there are no such spots, return the text completely unchanged. Return ONLY the full corrected chapter text, no preamble, no explanation of what you changed.",
  messages: [{ role: "user", content: text }],
});
const block = response.content.find((b) => b.type === "text");
const fixed = block?.text?.trim();
if (fixed) {
  writeFileSync(path, fixed);
  console.log("CHANGED:", text.length, "->", fixed.length, "chars");
} else {
  console.log("NO CHANGE / empty response");
}
