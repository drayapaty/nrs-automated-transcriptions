import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

// v3 — incorporates native Russian devotee editor corrections (July 2026):
// - Cyrillicize ALL Sanskrit terms (not just names)
// - Use devotional register: "обрел милость", "святая дхама", "искупить вину"
// - «Мысли с собой» for takeaways
// - Full clauses over participial compression
const RUSSIAN_PROMPT = `You are translating a lecture summary by His Holiness Niranjana Swami into Russian.

The text is a structured summary of a Gaudiya Vaishnava spiritual lecture. Translate the entire English text into fluent, natural Russian.

Rules:
- Maintain the same structure, numbering, and paragraph layout as the English original
- Cyrillicize ALL proper names using standard Russian Vaishnava conventions:
  Krishna → Кришна, Brahmā → Брахма, Śiva → Шива, Nārada → Нарада, Prahlāda → Прахлад,
  Viṣṇu → Вишну, Caitanya → Чайтанья, Prabhupāda → Прабхупада, Hanumān → Хануман,
  Vṛndāvana → Вриндаван, Vraja → Враджа, Satyaloka → Сатьялока, Mahādeva → Махадева,
  Niranjana Swami → Ниранджана Свами, Pāṇḍavas → Пандавы, Nṛsiṁha → Нрисимха
- Cyrillicize scripture names: Bṛhad-bhāgavatāmṛta → Брихад-бхагаватамрита, Śrīmad-Bhāgavatam → Шримад-Бхагаватам
- Cyrillicize ALL Sanskrit terms (do NOT leave them in Latin/IAST):
  līlā → лила, jīva → джива, dhām → дхама, Yogamāyā → Йогамайя, Mahāmāyā → Махамайя,
  yukta-vairāgya → йукта-вайрагья, guṇa-avatāra → гуна-аватара, bhakti → бхакти,
  prema → према, rasa → раса, karma → карма, dharma → дхарма, japa → джапа,
  kīrtana → киртан, prasāda → прасад, saṅkīrtana → санкиртана, sādhu → садху,
  śāstra → шастра, ācārya → ачарья, brāhmaṇa → брахман, paramparā → парампара
- KEEP verse references in Latin letters as-is: SB 1.2.6, BG 2.40, CC Adi 1.1, Text 77
- Always say "святая дхама" (holy dhām), never bare "дхама" or "дхам"
- Use devotional register and natural Russian phrasing:
  - "recipient of mercy" → "преданный, который обрел милость" (NOT "получатель милости")
  - "life fulfilled" → "жизнь увенчалась успехом"
  - "correcting with the same tongue" → "искупить вину тем же языком"
  - "lesson about reverence" → "урок о правильном умонастроении"
  - "takeaways" → «мысли с собой» (NOT «выводы»)
- Use standard Russian Vaishnava terms: Господь for Lord, преданное служение for devotional service, духовный учитель for spiritual master, преданный for devotee
- Prefer full clauses over participial compression — Russian reads more naturally with explicit subjects and verbs
- Add small clarifying phrases where meaning would be ambiguous without them
- Translate naturally — not word-for-word. The Russian should read fluently for a Russian-speaking devotee audience.

Return ONLY the Russian translation. No headers, commentary, or explanations.`;

function extractDocx(path: string): string {
  const py = `
import zipfile, xml.etree.ElementTree as ET
with zipfile.ZipFile('${path.replace(/'/g, "\\'")}') as z:
    tree = ET.parse(z.open('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    for p in tree.findall('.//w:p', ns):
        texts = [t.text for t in p.findall('.//w:t', ns) if t.text]
        if texts:
            print(''.join(texts))
`;
  return execSync(`python3 -c "${py.replace(/"/g, '\\"')}"`, { encoding: "utf-8" });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx translate-summary.ts <input.docx>");
    process.exit(1);
  }

  const baseName = inputPath.replace(/\.docx$/, "");
  const outputMd = `${baseName} - Russian.md`;
  const outputDocx = `${baseName} - Russian.docx`;

  const text = extractDocx(inputPath);
  console.log(`Input: ${text.length} chars`);

  // Split into chunks if > 12K chars
  const CHUNK = 12_000;
  const chunks: string[] = [];
  if (text.length <= CHUNK) {
    chunks.push(text);
  } else {
    const paras = text.split("\n");
    let buf = "";
    for (const p of paras) {
      if (buf.length + p.length > CHUNK && buf.length > 0) {
        chunks.push(buf);
        buf = p + "\n";
      } else {
        buf += p + "\n";
      }
    }
    if (buf.trim()) chunks.push(buf);
  }
  console.log(`Split into ${chunks.length} chunks: ${chunks.map(c => c.length).join(", ")} chars`);

  const client = new Anthropic();
  const translated: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 16_000,
      messages: [{ role: "user", content: `${RUSSIAN_PROMPT}\n\nTEXT:\n${chunks[i]}` }],
    }, { timeout: 120_000 });

    const block = response.content.find((b: any) => b.type === "text");
    translated.push((block as any)?.text || chunks[i]);
  }

  const result = translated.join("\n\n");
  writeFileSync(outputMd, result);
  console.log(`MD: ${result.length} chars → ${outputMd}`);

  // Also write docx
  const pyDocx = `
from docx import Document
doc = Document()
with open('${outputMd}', 'r') as f:
    text = f.read()
for para in text.split('\\n'):
    if para.strip():
        doc.add_paragraph(para)
doc.save('${outputDocx}')
print('DOCX written')
`;
  execSync(`python3 -c "${pyDocx.replace(/"/g, '\\"')}"`, { encoding: "utf-8" });
  console.log(`DOCX → ${outputDocx}`);
}

main().catch(console.error);
