#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";

interface NoteEntry {
  filePath: string;
  filename: string;
  title: string;
  tags: string[];
  content: string;
  createdAt: string | null; // extracted from filename pattern YYYY-MM-DD_HH-mm_
  mtime: number;
}

interface SearchWeights {
  tagExact: number;
  filenameMatch: number;
  tagPartial: number;
  contentMatch: number;
  multiTokenBonus: number;
  allTokensBonus: number;
}

interface StructuredSearchResult {
  score: number;
  matchedTokenCount: number;
  reasons: string[];
  entry: Omit<NoteEntry, "filePath" | "content"> & { snippet: string };
}

const DEFAULT_WEIGHTS: SearchWeights = {
  tagExact: 6,
  filenameMatch: 4,
  tagPartial: 3,
  contentMatch: 2,
  multiTokenBonus: 3,
  allTokensBonus: 4,
};

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function getNotesDir(): string {
  const notesDir = process.env.NOTES_DIRECTORY;
  if (!notesDir) {
    throw new Error("NOTES_DIRECTORY environment variable not set");
  }
  return notesDir;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function extractFrontMatterTags(rawContent: string): string[] {
  const fmMatch = rawContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const tagsLine = fmMatch[1].match(/^tags\s*:\s*(.+)$/m);
  if (!tagsLine) return [];
  const raw = tagsLine[1].replace(/[\[\]]/g, "");
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
}

function extractInlineTags(bodyContent: string): string[] {
  const matches = bodyContent.match(/#[\w-]+/g) || [];
  return [...new Set(matches)];
}

function extractTitle(rawContent: string, filename: string): string {
  const fmMatch = rawContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleLine = fmMatch[1].match(/^title\s*:\s*(.+)$/m);
    if (titleLine) return titleLine[1].trim().replace(/^["']|["']$/g, "");
  }
  const headingMatch = rawContent.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return path.basename(filename, ".md");
}

/** Extract creation datetime from filename pattern: YYYY-MM-DD_HH-mm[_...] */
function extractCreatedAt(filename: string): string | null {
  const base = path.basename(filename);
  const m = base.match(/^(\d{4}-\d{2}-\d{2})[_-](\d{2})[_-](\d{2})/);
  if (m) return `${m[1]} ${m[2]}:${m[3]}`;
  const dateOnly = base.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];
  return null;
}

function collectNoteFiles(dir: string, baseDir: string): { filePath: string; mtime: number }[] {
  const results: { filePath: string; mtime: number }[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectNoteFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const stat = fs.statSync(fullPath);
      results.push({ filePath: fullPath, mtime: stat.mtimeMs });
    }
  }
  return results;
}

function parseAllNoteFiles(notesDir: string): NoteEntry[] {
  const files = collectNoteFiles(notesDir, notesDir);
  const entries: NoteEntry[] = [];

  for (const { filePath, mtime } of files) {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const filename = path.relative(notesDir, filePath);
    const title = extractTitle(rawContent, filename);
    const fmTags = extractFrontMatterTags(rawContent);
    const bodyContent = rawContent.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trim();
    const inlineTags = extractInlineTags(bodyContent);
    // Merge both tag sources (front matter takes precedence; inline deduplicated)
    const tags = [...new Set([...fmTags, ...inlineTags])];
    const createdAt = extractCreatedAt(filename);

    entries.push({ filePath, filename, title, tags, content: bodyContent, createdAt, mtime });
  }

  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

const SNIPPET_RADIUS = 100; // chars on each side of match

function extractSnippet(content: string, tokens: string[]): string {
  const lc = content.toLowerCase();
  let bestIdx = -1;
  for (const token of tokens) {
    const idx = lc.indexOf(token.startsWith("#") ? token : token);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx === -1) {
    // No match — return content head
    return content.slice(0, SNIPPET_RADIUS * 2).replace(/\n+/g, " ").trim();
  }
  const start = Math.max(0, bestIdx - SNIPPET_RADIUS);
  const end = Math.min(content.length, bestIdx + SNIPPET_RADIUS);
  const raw = content.slice(start, end).replace(/\n+/g, " ").trim();
  return (start > 0 ? "…" : "") + raw + (end < content.length ? "…" : "");
}

// ---------------------------------------------------------------------------
// Search / scoring helpers
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.toLowerCase();
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => normalize(token))
    .filter((token) => token.length > 0);
}

function toBoundedInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function getEffectiveWeights(overrides?: Partial<SearchWeights>): SearchWeights {
  return {
    tagExact: toBoundedInt(overrides?.tagExact ?? DEFAULT_WEIGHTS.tagExact, DEFAULT_WEIGHTS.tagExact, 1, 20),
    filenameMatch: toBoundedInt(overrides?.filenameMatch ?? DEFAULT_WEIGHTS.filenameMatch, DEFAULT_WEIGHTS.filenameMatch, 1, 20),
    tagPartial: toBoundedInt(overrides?.tagPartial ?? DEFAULT_WEIGHTS.tagPartial, DEFAULT_WEIGHTS.tagPartial, 1, 20),
    contentMatch: toBoundedInt(overrides?.contentMatch ?? DEFAULT_WEIGHTS.contentMatch, DEFAULT_WEIGHTS.contentMatch, 1, 20),
    multiTokenBonus: toBoundedInt(overrides?.multiTokenBonus ?? DEFAULT_WEIGHTS.multiTokenBonus, DEFAULT_WEIGHTS.multiTokenBonus, 0, 20),
    allTokensBonus: toBoundedInt(overrides?.allTokensBonus ?? DEFAULT_WEIGHTS.allTokensBonus, DEFAULT_WEIGHTS.allTokensBonus, 0, 20),
  };
}

function getRecencyBonus(mtime: number): number {
  const days = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
  if (days <= 7) return 4;
  if (days <= 30) return 3;
  if (days <= 90) return 2;
  if (days <= 180) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Synonym support
// ---------------------------------------------------------------------------

function getBuiltInSynonyms(): Map<string, string[]> {
  return new Map([
    ["経費", ["精算", "交通費", "出張費"]],
    ["会議", ["mtg", "ミーティング"]],
    ["タスク", ["todo", "課題"]],
    ["メモ", ["note", "ノート"]],
    ["バグ", ["bug", "不具合", "エラー"]],
  ]);
}

function buildSynonymMap(customSynonyms?: string[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();

  for (const [key, values] of getBuiltInSynonyms()) {
    const k = normalize(key);
    if (!map.has(k)) map.set(k, new Set());
    values.forEach((v) => map.get(k)!.add(normalize(v)));
  }

  for (const row of customSynonyms ?? []) {
    const [rawKey, rawValues] = row.split(":").map((p) => p.trim());
    if (!rawKey || !rawValues) continue;
    const k = normalize(rawKey);
    if (!map.has(k)) map.set(k, new Set());
    rawValues.split(",").map((v) => normalize(v.trim())).filter((v) => v.length > 0).forEach((v) => map.get(k)!.add(v));
  }

  return new Map([...map.entries()].map(([k, v]) => [k, [...v]]));
}

function expandTokens(tokens: string[], synonymMap: Map<string, string[]>): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const bare = token.startsWith("#") ? token.slice(1) : token;
    (synonymMap.get(bare) ?? []).forEach((s) => expanded.add(s));
  }
  return [...expanded];
}

// ---------------------------------------------------------------------------
// Frequency-aware content scoring (capped)
// ---------------------------------------------------------------------------

const FREQ_CAP = 4; // max bonus multiplier from frequency

function contentFrequencyScore(contentText: string, token: string, baseWeight: number): number {
  if (!contentText.includes(token)) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = contentText.indexOf(token, pos)) !== -1) {
    count++;
    pos += token.length;
    if (count >= FREQ_CAP) break;
  }
  return baseWeight * Math.min(count, FREQ_CAP);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreEntry(
  entry: NoteEntry,
  tokens: string[],
  weights: SearchWeights,
  includeRecencyBonus: boolean,
): StructuredSearchResult {
  const normalizedTags = entry.tags.map((tag) => normalize(tag));
  const tagText = normalizedTags.join(" ");
  const contentText = normalize(entry.content);
  const filenameText = normalize(entry.filename);
  const titleText = normalize(entry.title);

  let score = 0;
  let matchedTokenCount = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    let tokenMatched = false;
    const tagToken = token.startsWith("#") ? token : `#${token}`;

    if (normalizedTags.includes(tagToken)) {
      score += weights.tagExact;
      reasons.push(`tag:${tagToken}`);
      tokenMatched = true;
      // still check content frequency for exact tag token
    }

    if (filenameText.includes(token) || titleText.includes(token)) {
      score += weights.filenameMatch;
      reasons.push(`filename:${token}`);
      tokenMatched = true;
    }

    if (!normalizedTags.includes(tagToken) && tagText.includes(token)) {
      score += weights.tagPartial;
      reasons.push(`tag-partial:${token}`);
      tokenMatched = true;
    }

    const freqScore = contentFrequencyScore(contentText, token, weights.contentMatch);
    if (freqScore > 0) {
      score += freqScore;
      reasons.push(`content:${token}(x${Math.round(freqScore / weights.contentMatch)})`);
      tokenMatched = true;
    }

    if (tokenMatched) matchedTokenCount += 1;
  }

  if (matchedTokenCount >= 2) {
    score += weights.multiTokenBonus;
    reasons.push("bonus:multi-token");
  }

  if (tokens.length > 0 && matchedTokenCount === tokens.length) {
    score += weights.allTokensBonus;
    reasons.push("bonus:all-tokens");
  }

  if (includeRecencyBonus) {
    const bonus = getRecencyBonus(entry.mtime);
    if (bonus > 0) {
      score += bonus;
      reasons.push(`bonus:recent+${bonus}`);
    }
  }

  const { filePath: _fp, content: _c, ...entryRest } = entry;
  return {
    score,
    matchedTokenCount,
    reasons: [...new Set(reasons)],
    entry: { ...entryRest, snippet: extractSnippet(entry.content, tokens) },
  };
}

// ---------------------------------------------------------------------------
// Date filtering helper
// ---------------------------------------------------------------------------

function noteMatchesDateRange(entry: NoteEntry, from?: string, to?: string): boolean {
  // Use createdAt if available, fall back to mtime date string
  const dateStr = entry.createdAt ?? new Date(entry.mtime).toISOString().slice(0, 10);
  const noteDate = dateStr.slice(0, 10);
  if (from && noteDate < from) return false;
  if (to && noteDate > to) return false;
  return true;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "notes-mcp", version: "3.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_notes",
      description: "Search notes by keyword, tag, or filename. Returns metadata + a snippet around each match.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query (keyword or tag like #todo)" },
          tag: { type: "string", description: "Filter by specific tag (without #)" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
    {
      name: "get_recent_notes",
      description: "Get the most recently modified notes (metadata only)",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: { type: "number", description: "Number of notes (default 10)" },
        },
      },
    },
    {
      name: "get_notes_by_tag",
      description: "Get all notes with a specific tag (metadata + snippet)",
      inputSchema: {
        type: "object" as const,
        properties: {
          tag: { type: "string", description: "Tag name (without #)" },
        },
        required: ["tag"],
      },
    },
    {
      name: "get_notes_by_date",
      description: "Get notes created within a date range (based on filename date or modification time)",
      inputSchema: {
        type: "object" as const,
        properties: {
          from: { type: "string", description: "Start date YYYY-MM-DD (inclusive)" },
          to: { type: "string", description: "End date YYYY-MM-DD (inclusive)" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
    {
      name: "list_notes",
      description: "List all notes with metadata only (filename, title, tags, createdAt, mtime). Lightweight overview.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: { type: "number", description: "Max results (default 50, use 0 for all)" },
        },
      },
    },
    {
      name: "list_tags",
      description: "List all unique tags across all notes with usage counts",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "structure_search_notes",
      description: "Score-ranked search with tunable weights, synonym expansion, and recency bonus. Returns snippet per result.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query (e.g. '#todo meeting 経費')" },
          limit: { type: "number", description: "Max results (default 10, range 1-200)" },
          include_recency_bonus: { type: "boolean", description: "Apply recency bonus (default true)" },
          synonyms: {
            type: "array",
            items: { type: "string" },
            description: "Custom synonym rules, format: 'key:syn1,syn2'",
          },
          weights: {
            type: "object",
            description: "Score weight overrides",
            properties: {
              tagExact: { type: "number" },
              filenameMatch: { type: "number" },
              tagPartial: { type: "number" },
              contentMatch: { type: "number" },
              multiTokenBonus: { type: "number" },
              allTokensBonus: { type: "number" },
            },
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_note_content",
      description: "Get the full content of a specific note by filename",
      inputSchema: {
        type: "object" as const,
        properties: {
          filename: { type: "string", description: "Relative filename of the note (as returned by other tools)" },
        },
        required: ["filename"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const notesDir = getNotesDir();
  const entries = parseAllNoteFiles(notesDir);

  switch (request.params.name) {

    case "search_notes": {
      const { query, tag, limit = 10 } = request.params.arguments as {
        query?: string;
        tag?: string;
        limit?: number;
      };

      let filtered = entries;

      if (tag) {
        filtered = filtered.filter((e) => e.tags.includes(`#${tag}`));
      }

      const tokens = query ? tokenizeQuery(query) : [];

      if (tokens.length > 0) {
        filtered = filtered.filter((e) => {
          const lc = e.content.toLowerCase();
          const fn = e.filename.toLowerCase();
          const ti = e.title.toLowerCase();
          const tg = e.tags.join(" ").toLowerCase();
          return tokens.some((t) => lc.includes(t) || fn.includes(t) || ti.includes(t) || tg.includes(t));
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            filtered.slice(0, limit).map(({ filePath: _, content, ...rest }) => ({
              ...rest,
              snippet: extractSnippet(content, tokens),
            })),
            null, 2,
          ),
        }],
      };
    }

    case "get_recent_notes": {
      const { limit = 10 } = request.params.arguments as { limit?: number };
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            entries.slice(0, limit).map(({ filePath: _, content: __, ...rest }) => rest),
            null, 2,
          ),
        }],
      };
    }

    case "get_notes_by_tag": {
      const { tag } = request.params.arguments as { tag: string };
      const filtered = entries.filter((e) => e.tags.includes(`#${tag}`));
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            filtered.map(({ filePath: _, content, ...rest }) => ({
              ...rest,
              snippet: content.slice(0, SNIPPET_RADIUS * 2).replace(/\n+/g, " ").trim(),
            })),
            null, 2,
          ),
        }],
      };
    }

    case "get_notes_by_date": {
      const { from, to, limit = 20 } = request.params.arguments as {
        from?: string;
        to?: string;
        limit?: number;
      };
      const filtered = entries.filter((e) => noteMatchesDateRange(e, from, to));
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            filtered.slice(0, limit).map(({ filePath: _, content: __, ...rest }) => rest),
            null, 2,
          ),
        }],
      };
    }

    case "list_notes": {
      const { limit = 50 } = request.params.arguments as { limit?: number };
      const items = limit === 0 ? entries : entries.slice(0, limit);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            items.map(({ filePath: _, content: __, ...rest }) => rest),
            null, 2,
          ),
        }],
      };
    }

    case "list_tags": {
      const tagCount = new Map<string, number>();
      for (const entry of entries) {
        for (const tag of entry.tags) {
          tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
        }
      }
      const sorted = [...tagCount.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(sorted, null, 2) }],
      };
    }

    case "structure_search_notes": {
      const {
        query,
        limit = 10,
        include_recency_bonus = true,
        synonyms,
        weights,
      } = request.params.arguments as {
        query: string;
        limit?: number;
        include_recency_bonus?: boolean;
        synonyms?: string[];
        weights?: Partial<SearchWeights>;
      };

      const queryTokens = tokenizeQuery(query);
      if (queryTokens.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "query is empty" }, null, 2) }],
        };
      }

      const safeLimit = toBoundedInt(limit, 10, 1, 200);
      const synonymMap = buildSynonymMap(synonyms);
      const expandedTokens = expandTokens(queryTokens, synonymMap);
      const effectiveWeights = getEffectiveWeights(weights);

      const ranked = entries
        .map((entry) => scoreEntry(entry, expandedTokens, effectiveWeights, include_recency_bonus))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.mtime - a.entry.mtime)
        .slice(0, safeLimit);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            { query, queryTokens, expandedTokens, totalMatches: ranked.length, results: ranked },
            null, 2,
          ),
        }],
      };
    }

    case "get_note_content": {
      const { filename } = request.params.arguments as { filename: string };
      const entry = entries.find((e) => e.filename === filename);
      if (!entry) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Note not found: ${filename}` }) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: entry.content }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Notes MCP server running on stdio");
}

main().catch(console.error);
