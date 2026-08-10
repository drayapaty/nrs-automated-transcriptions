/**
 * Post-cleanup guard: strips guru-praṇāma that Sonnet fabricated.
 *
 * Sonnet sometimes sees garbled Sanskrit (BB verse) in the raw Whisper
 * output and reconstitutes it as a full guru-praṇāma set. This
 * deterministic post-pass compares the raw Whisper text against the
 * cleaned output:
 *
 *  - If raw has NO guru-praṇāma markers → strip ALL guru-praṇāma
 *  - If raw has markers → keep first occurrence, strip duplicates
 */

const GURU_MARKERS = [
  "oṁ ajñāna-timirāndhasya",
  "jñānāñjana-śalākayā",
  "cakṣur unmīlitaṁ yena",
  "tasmai śrī-gurave namaḥ",
  "nama oṁ viṣṇu-pādāya",
  "kṛṣṇa-preṣṭhāya bhū-tale",
  "śrīmate bhaktivedānta-svāmin",
  "svāmin iti nāmine",
  "namas te sārasvate deve",
  "gaura-vāṇī-pracāriṇe",
  "nirviśeṣa-śūnyavādi",
  "pāścātya-deśa-tāriṇe",
  "mūkaṁ karoti vācālaṁ",
  "mukāṁ karoti vācālaṁ",
  "paṅguṁ laṅghayate girim",
  "yat-kṛpā tam ahaṁ vande",
  "śrī-guruṁ dīna-tāraṇam",
];

const IAST_TO_ASCII: [RegExp, string][] = [
  [/[āàâ]/g, "a"], [/[īìî]/g, "i"], [/[ūùû]/g, "u"],
  [/[ṛṝ]/g, "r"], [/[ṣśš]/g, "s"], [/[ṇñṅ]/g, "n"],
  [/[ṭṯ]/g, "t"], [/[ḍḏ]/g, "d"], [/[ḥḫ]/g, "h"],
  [/[ṁṃ]/g, "m"], [/[ḷḹ]/g, "l"],
];

function asciiFold(s: string): string {
  let r = s.toLowerCase();
  for (const [pat, rep] of IAST_TO_ASCII) r = r.replace(pat, rep);
  return r;
}

const RAW_GURU_PROBES = [
  /j[ñn]?a?n?a.{0,15}ti.?m[aeiou]?r/i,
  /vi.?s.?[hn]?.?n?u.{0,10}p[aeiou]d/i,
  /sarasvat/i,
  /bhaktived/i,
];

function rawHasGuruPranama(raw: string): boolean {
  const folded = asciiFold(raw);
  return RAW_GURU_PROBES.some((p) => p.test(folded));
}

function isGuruLine(line: string): boolean {
  const lc = line.trim().toLowerCase();
  if (!lc) return false;
  return GURU_MARKERS.some((m) => lc.includes(m.toLowerCase()));
}

function isContinuationLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (t.startsWith("[") && t.endsWith("]")) return true;
  if (t.startsWith("(") && t.endsWith(")")) return true;
  return false;
}

interface Block {
  start: number;
  end: number;
}

const MERGE_GAP = 8;

function findGuruBlocks(lines: string[]): Block[] {
  const raw: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isGuruLine(lines[i])) {
      const start = i;
      while (
        i < lines.length &&
        (isGuruLine(lines[i]) || isContinuationLine(lines[i]))
      ) {
        i++;
      }
      let end = i;
      while (end > start && isContinuationLine(lines[end - 1])) end--;
      if (end > start) raw.push({ start, end });
    } else {
      i++;
    }
  }

  if (raw.length <= 1) return raw;

  const merged: Block[] = [raw[0]];
  for (let j = 1; j < raw.length; j++) {
    const prev = merged[merged.length - 1];
    if (raw[j].start - prev.end <= MERGE_GAP) {
      prev.end = raw[j].end;
    } else {
      merged.push(raw[j]);
    }
  }
  return merged;
}

export function stripFabricatedPranama(
  raw: string,
  cleaned: string
): { text: string; stripped: number } {
  const lines = cleaned.split("\n");
  const blocks = findGuruBlocks(lines);

  if (blocks.length === 0) return { text: cleaned, stripped: 0 };

  const hasRaw = rawHasGuruPranama(raw);

  let toStrip: Block[];
  if (!hasRaw) {
    toStrip = blocks;
  } else {
    toStrip = blocks.slice(1);
  }

  if (toStrip.length === 0) return { text: cleaned, stripped: 0 };

  const result = [...lines];
  for (let i = toStrip.length - 1; i >= 0; i--) {
    const b = toStrip[i];
    let rs = b.start;
    let re = b.end;
    if (rs > 0 && result[rs - 1].trim() === "") rs--;
    if (re < result.length && result[re]?.trim() === "") re++;
    result.splice(rs, re - rs);
  }

  return { text: result.join("\n"), stripped: toStrip.length };
}
