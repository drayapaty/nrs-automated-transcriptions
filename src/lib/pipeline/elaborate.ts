/**
 * "Elaborate" step — Mahārāja's 4-point write spec (see
 * scripts/ELABORATE_REQUIREMENTS.md). New tool, alongside write-chapter.ts /
 * write-chapter-voiced.ts — does not replace either.
 *
 * Mahārāja's 4 points, verbatim:
 *   1. PROVIDE THE SPEAKER'S ELABORATION CONTEXTUALLY FROM HIS PRESENTATION
 *   2. IN OTHER WORDS DON'T GIVE A SUMMARY BUT GIVE AN EDITED VERSION OF THE
 *      ABOVE POINT 1
 *   3. FIND OTHER EXAMPLES USED BY THE SPEAKER ON THIS TOPIC WITHIN THE
 *      CONTEXT OF HIS PRESENTATION FROM HIS PREVIOUS LECTURES OR BOOKS AND
 *      LIST THEM SEPARATELY
 *   4. SUGGEST THE BEST VERSION FOR ELABORATING ON THIS TOPIC, PLEASE LIST
 *      THESE SUGGESTIONS AT THE BOTTOM OF THE OUTPUT, IF MORE THAN ONE
 *      TOPICS ARE EXTRACTED PLEASE PROVIDE AN EXAMPLE OF EACH
 *
 * Point 3's corpus is BOOKS ONLY (his other transcribed lectures explicitly
 * excluded — confirmed 2026-08-06).
 *
 * Book search uses the SAME production OpenSearch index that powers
 * ask-niranjana-swami (ask-nrs-lectures, ~5,150 book chunks, source_type=
 * "book"), not local grep — hybrid BM25 + semantic vector search, filtered
 * to books only. Reuses the same OPENSEARCH_URL/USER/PASS/INDEX credentials
 * already in this repo's .env.local (confirmed identical to
 * ask-niranjana-swami's ELASTICSEARCH_* values — same server). Semantic
 * search also sidesteps a real problem local grep hit: his published books
 * use plain ASCII transliteration ("Krishna", "Krsna", "Siva"), not the
 * IAST diacritics ("Kṛṣṇa", "Śiva") our own pipeline and an LLM naturally
 * produce — exact-substring grep on diacritic search terms silently missed
 * every real match. Embeddings match on meaning, not exact spelling.
 */

import { anthropic, openai, CLAUDE_MODEL } from "../clients";

// Read lazily (inside functions, not as module-level consts) — static ES
// module imports evaluate before a CLI's dotenv.config() call runs in this
// codebase's execution order, so top-level `const X = process.env.X` here
// would permanently capture `undefined`. Every other client in this repo
// (see clients.ts) reads env vars inside functions for the same reason.
function openSearchConfig() {
  const url = process.env.OPENSEARCH_URL;
  const user = process.env.OPENSEARCH_USER;
  const pass = process.env.OPENSEARCH_PASS;
  const index = process.env.OPENSEARCH_INDEX || "ask-nrs-lectures";
  if (!url || !user || !pass) {
    throw new Error("OPENSEARCH_URL / OPENSEARCH_USER / OPENSEARCH_PASS not set");
  }
  return { url, user, pass, index };
}

// Cheap, low-stakes call (generating short search phrases) — no need for
// the full model.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Small Haiku call: 3-6 short search phrases for the lecture's main topics. */
async function findTopics(summary: string): Promise<string[]> {
  const response = await anthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    system:
      "Given a lecture summary, list 3-6 short topic phrases (2-6 words each) that capture the lecture's main teachings — named pastimes, key concepts, or themes. Plain English is fine; Sanskrit terms don't need diacritics. Return ONLY the phrases, one per line, no numbering, no explanation.",
    messages: [{ role: "user", content: summary }],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = (block as { text?: string } | undefined)?.text || "";
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*\d.]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

interface SourceHit {
  content: string;
  title?: string;
  source_file?: string;
  source_type?: string;
  year?: number;
}

const QUEEN_KUNTI_TOPIC = "Teachings of Queen Kunti";
const LECTURE_YEAR_FLOOR = 2000;

/**
 * Hybrid BM25 + kNN search against the production index, one topic at a time.
 * Corpus: his own books (all), plus his own lectures from 2000 onward, plus
 * his full "Teachings of Queen Kunti" lecture series regardless of year.
 */
async function searchSourceIndex(topic: string, matchCount = 6): Promise<SourceHit[]> {
  const { url, user, pass, index } = openSearchConfig();
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // self-signed cert on this host
  const embedding = await generateEmbedding(topic);
  const authHeader = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  const corpusFilter = {
    bool: {
      should: [
        { term: { source_type: "book" } },
        {
          bool: {
            filter: [
              { term: { source_type: "lecture" } },
              {
                bool: {
                  should: [
                    { range: { lecture_date_year: { gte: LECTURE_YEAR_FLOOR } } },
                    { term: { topic_en: QUEEN_KUNTI_TOPIC } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  };

  const query = {
    size: matchCount,
    _source: ["content", "title", "source_file", "source_type", "year", "lecture_date_year"],
    query: {
      bool: {
        should: [
          { match: { content: { query: topic, boost: 0.3 } } },
          { match: { title: { query: topic, boost: 0.15 } } },
          {
            script_score: {
              query: { bool: { filter: [corpusFilter] } },
              script: {
                source: "knn_score",
                lang: "knn",
                params: { field: "embedding", query_value: embedding, space_type: "cosinesimil" },
              },
            },
          },
        ],
        minimum_should_match: 1,
        filter: [corpusFilter],
      },
    },
  };

  const res = await fetch(`${url}/${index}/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(query),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenSearch search failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const hits = (data.hits?.hits || []) as Array<{ _source: SourceHit }>;
  return hits.map((h) => h._source);
}

/**
 * Dedicated search scoped to lectures/passages that cite or quote from the
 * "Teachings of Queen Kunti" book. NOTE: topic_en=="Teachings of Queen Kunti"
 * only tags the one lecture literally titled after that book (Sept 1, 2013,
 * Almaty) — it does NOT catch the other lectures that reference/quote the
 * book while tagged under their own topic (e.g. an SB 1.8.21 class that
 * cites Kuntī-devī's prayers). Filtering on topic_en alone missed ~12 of the
 * ~13 relevant lectures (confirmed against askniranjanaswami.com's own
 * citation search, 2026-08-06). Filter on the phrase itself instead.
 */
async function searchQueenKunti(topic: string, matchCount = 2): Promise<SourceHit[]> {
  const { url, user, pass, index } = openSearchConfig();
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const embedding = await generateEmbedding(topic);
  const authHeader = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  const kuntiFilter = {
    bool: {
      should: [
        { match_phrase: { content: "Teachings of Queen Kunti" } },
        { match_phrase: { content: "Queen Kunti's prayers" } },
        { match_phrase: { title: "Teachings of Queen Kunti" } },
        { term: { topic_en: QUEEN_KUNTI_TOPIC } },
      ],
      minimum_should_match: 1,
    },
  };

  const query = {
    size: matchCount,
    _source: ["content", "title", "source_file", "source_type", "year"],
    query: {
      bool: {
        should: [
          { match: { content: { query: topic, boost: 0.3 } } },
          {
            script_score: {
              query: { bool: { filter: [kuntiFilter] } },
              script: {
                source: "knn_score",
                lang: "knn",
                params: { field: "embedding", query_value: embedding, space_type: "cosinesimil" },
              },
            },
          },
        ],
        minimum_should_match: 1,
        filter: [kuntiFilter],
      },
    },
  };

  const res = await fetch(`${url}/${index}/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(query),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenSearch Queen Kunti search failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const hits = (data.hits?.hits || []) as Array<{ _source: SourceHit }>;
  return hits.map((h) => h._source);
}

async function searchSourcesForTopics(topics: string[]): Promise<string> {
  if (topics.length === 0) return "";
  const sections: string[] = [];
  for (const topic of topics) {
    let hits: SourceHit[];
    try {
      const [general, queenKunti] = await Promise.all([
        searchSourceIndex(topic),
        searchQueenKunti(topic),
      ]);
      const seen = new Set(general.map((h) => h.content));
      hits = [...general, ...queenKunti.filter((h) => !seen.has(h.content))];
    } catch (err) {
      console.warn(`[elaborate] source search failed for "${topic}": ${(err as Error).message}`);
      continue;
    }
    if (hits.length === 0) continue;
    const body = hits
      .map((h) => {
        const kind = h.source_type === "lecture" ? "lecture" : "book";
        const year = h.year ? `, ${h.year}` : "";
        return `### [${kind}] "${h.title || h.source_file || "unknown"}"${year}\n${h.content}`;
      })
      .join("\n\n");
    sections.push(`## Search: "${topic}"\n${body}`);
  }
  return sections.join("\n\n");
}

const ELABORATE_SYSTEM_PROMPT = `You are drafting material for a book Niranjana Swami is writing himself, in his own first-person voice. He is the author. Every sentence should be plausible as something he wrote or dictated himself.

You will be given:
1. The full lecture TRANSCRIPT (verse-restored, cleaned)
2. His own EVERNOTE SUMMARY of the same lecture
3. COMPARISON NOTES — points from the lecture not covered in Gopīparāṇadhana Dāsa's published commentary
4. SOURCE SEARCH RESULTS — candidate passages from his own other books, his own lectures from 2000 onward, and his full "Teachings of Queen Kunti" lecture series, that may relate to the same topic(s), retrieved via semantic + keyword search (search results only — may contain false positives; use judgment). Each result is tagged [book] or [lecture].

Produce output with exactly these parts, in this order:

## Part 1 — Elaboration
This is the bulk of the output. Provide the elaboration contextually from his presentation — NOT a summary. Take what he actually said in the TRANSCRIPT and produce an EDITED version of it: trim filler, false starts, and repetition, but preserve his real words, his real explanations, his real train of thought and structure. Do not condense his points into a synopsis — keep the actual content and phrasing, just cleaned up. Full first-person prose, in his voice (see VOICE below).

## Part 2 — Other examples on this topic (from his books and lectures)
Look through the SOURCE SEARCH RESULTS. For each topic covered in the lecture, list any genuine parallel example, analogy, or teaching he has used elsewhere — in his own books, in a lecture from 2000 onward, or in his "Teachings of Queen Kunti" series — on the same topic. Cite the title, whether it's a book or lecture, and the year if given for lectures. Be honest: if a search result is just a coincidental keyword match and not a real parallel, leave it out. If no genuine parallel exists for a topic, say so plainly ("I did not find another example of this in the searched sources") rather than inventing one. List separately per topic if the lecture covers more than one.

## Part 3 — Suggested best version for elaborating this topic
At the bottom of the output: for each topic covered in the lecture, suggest which version/angle would work best for elaborating on it in the finished book (the transcript's original telling, a book parallel from Part 2, or a synthesis) and why. If the lecture covers more than one topic, give one example per topic.

VOICE (first-person, mandatory throughout Part 1 and wherever else you speak in his voice — calibrated from his actual writing, the 5-volume Collected Letters):
- First person only — "I," not "Mahārāja teaches" or "he shows us." He is the author holding the pen. E.g. "When I first came to this verse, I could not help but notice...", "I have often reflected on why Śrīla Sanātana Gosvāmī places this here...", "I am reminded, whenever I read this passage, of..."
- Humble, not authoritative — frame teaching as passed down from Prabhupāda/Sanātana Gosvāmī/śāstra, not his own independent conclusion. Avoid scholarly-pronouncement framing ("this passage reveals," "one may observe that..."); prefer "Śrīla Prabhupāda has shown us...," "I take shelter of what Śrīla Sanātana Gosvāmī teaches here..."
- Anchor substantive claims in authority, not bare personal assertion — trace them to Prabhupāda's purports/letters, a śāstric verse, or a lived example, introduced as received wisdom he is passing on.
- "We/us" for the shared devotional situation, alongside "I" for his own reflection.
- Gentle qualifiers ("somehow or other," "to some degree," "in some way") — avoid absolutist phrasing.
- Warm and encouraging, even when the content is demanding — meet difficulty with reassurance, normalize struggle rather than pressure.
- A closing turn toward prayer or aspiration at the end of a substantial passage — handing the outcome to Kṛṣṇa/Prabhupāda rather than closing on his own authority.
- IAST diacritics throughout: Kṛṣṇa, Śiva, Brahmā, Prabhupāda, Bhāgavatam, etc.
- Bold key Sanskrit terms on first use.

CONTENT RULES:
- Do NOT quote or closely paraphrase Gopīparāṇadhana Dāsa's copyrighted translation/commentary text.
- Do NOT fabricate a book parallel that isn't genuinely supported by the search results.
- One combined output for the whole lecture — if it covers multiple topics, Part 2 and Part 3 each list multiple entries inside this single document, not separate documents.
- This is book text, not a lecture transcript. No lecture-note artifacts: never say "class," "this class," "our last class," "in today's class," "we will begin our next class," "the speaker says," etc. Rephrase or drop these — e.g. "as I mentioned earlier," "as we discussed above," or simply omit the reference. The reader is holding a book, not sitting in a room.

Return ONLY the formatted output (Part 1 / Part 2 / Part 3). No preamble.`;

export interface ElaborateResult {
  output: string;
  topics: string[];
}

export async function elaborate(
  transcript: string,
  evernoteSummary: string,
  comparisonNotes: string
): Promise<ElaborateResult> {
  const topics = await findTopics(evernoteSummary);
  const sourceExcerpts = await searchSourcesForTopics(topics);

  const response = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16_000,
    system: ELABORATE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `TRANSCRIPT:\n${transcript}\n\n---\n\n` +
          `EVERNOTE SUMMARY:\n${evernoteSummary}\n\n---\n\n` +
          `COMPARISON NOTES:\n${comparisonNotes}\n\n---\n\n` +
          `SOURCE SEARCH RESULTS (topics searched: ${topics.join(", ") || "none"}):\n${sourceExcerpts || "(no matches found)"}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = (block as { text?: string } | undefined)?.text;
  if (!text) throw new Error("Elaborate step returned no text");
  return { output: text, topics };
}
