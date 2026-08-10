const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  LevelFormat, AlignmentType,
} = require("docx");

const [, , inPath, outPath] = process.argv;
const raw = fs.readFileSync(inPath, "utf8");
const lines = raw.split("\n");

// IAST/Vedic diacritics (ṛ ṣ ṇ ḥ ṃ ṭ ḍ etc, Latin Extended Additional block)
// need a font with full glyph coverage. Noto Sans has that coverage but
// isn't bundled with Word/macOS by default — if it's not installed locally,
// Word silently substitutes another font per-run, which can behave
// inconsistently (confirmed 2026-08-07: body text rendered fine, a heading
// run with the identical declared font did not, on the same machine).
// "Arial Unicode MS" ships with macOS and Office and has the same coverage
// without depending on a separate font install.
const IAST_FONT = "Arial Unicode MS";

// Parse **bold** into TextRuns
function parseInline(text) {
  const runs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), font: IAST_FONT }));
    runs.push(new TextRun({ text: m[1], bold: true, font: IAST_FONT }));
    last = re.lastIndex;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), font: IAST_FONT }));
  if (runs.length === 0) runs.push(new TextRun({ text, font: IAST_FONT }));
  return runs;
}

// Two bullet sets: "bullets" for content directly under a numbered (##)
// section, "bulletsIndented" for content under a lettered (###) sub-
// heading — shifted one full level (720 twips) further right so it visibly
// nests under its parent "A./B./C." heading instead of sitting flush with
// bullets that belong directly to the numbered section.
function bulletLevels(base) {
  return [
    { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: base, hanging: 360 } } } },
    { level: 1, format: LevelFormat.BULLET, text: "○", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: base + 720, hanging: 360 } } } },
    { level: 2, format: LevelFormat.BULLET, text: "▪", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: base + 1440, hanging: 360 } } } },
  ];
}

const numbering = {
  config: [
    { reference: "bullets", levels: bulletLevels(720) },
    { reference: "bulletsIndented", levels: bulletLevels(1440) },
  ],
};

const children = [];
let underH3 = false; // true while we're inside a "### A./B./C." sub-section

for (const line of lines) {
  const l = line.trimEnd();
  if (!l.trim()) continue;
  if (l === "---") continue;

  const h2 = l.match(/^##\s+(.*)$/);
  const h3 = l.match(/^###\s+(.*)$/);
  const nestedBullet = l.match(/^(\s{2,})-\s+◦?\s*(.*)$/);
  const topBullet = l.match(/^-\s+(.*)$/);

  if (h2) {
    underH3 = false;
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: parseInline(h2[1]),
      spacing: { before: 320, after: 160 },
    }));
  } else if (h3) {
    underH3 = true;
    // Indented sub-heading, nested under its parent H2
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      indent: { left: 720 },
      children: parseInline(h3[1]),
      spacing: { before: 240, after: 120 },
    }));
  } else if (nestedBullet) {
    children.push(new Paragraph({
      children: parseInline(nestedBullet[2]),
      numbering: { reference: underH3 ? "bulletsIndented" : "bullets", level: 1 },
      spacing: { after: 80 },
    }));
  } else if (topBullet) {
    children.push(new Paragraph({
      children: parseInline(topBullet[1]),
      numbering: { reference: underH3 ? "bulletsIndented" : "bullets", level: 0 },
      spacing: { after: 80 },
    }));
  } else {
    children.push(new Paragraph({ children: parseInline(l), spacing: { after: 120 } }));
  }
}

const doc = new Document({
  numbering,
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 } } },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("wrote", outPath);
});
