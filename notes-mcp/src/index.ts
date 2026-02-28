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
  entry: NoteEntry;
}

const DEFAULT_WEIGHTS: SearchWeights = {
  tagExact: 6,
  filenameMatch: 4,
  tagPartial: 3,
  contentMatch: 2,
  multiTokenBonus: 3,
  allTokensBonus: 4,
};

function getNotesDir(): string {
  const notesDir = process.env.NOTES_DIRECTORY;
  if (!notesDir) {
    throw new Error("NOTES_DIRECTORY environment variable not set");
  }
  return notesDir;
}

function extractFrontMatterTags(content: string): string[] {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const tagsLine = fmMatch[1].match(/^tags\s*:\s*(.+)$/m);
  if (!tagsLine) return [];
  // Support: tags: [foo, bar] or tags: foo, bar
  const raw = tagsLine[1].replace(/[\[\]]/g, "");
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
}

function extractInlineTags(content: string): string[] {
  const matches = content.match(/#[\w-]+/g) || [];
  return [...new Set(matches)];
}

function extractTitle(content: string, filename: string): string {
  // Try YAML front matter title
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleLine = fmMatch[1].match(/^title\s*:\s*(.+)$/m);
    if (titleLine) return titleLine[1].trim().replace(/^["']|["']$/g, "");
  }
  // Try first # heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  // Fall back to filename stem
  return path.basename(filename, ".md");
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
    const content = fs.readFileSync(filePath, "utf8");
    const filename = path.relative(notesDir, filePath);
    const title = extractTitle(content, filename);
    const fmTags = extractFrontMatterTags(content);
    const inlineTags = extractInlineTags(content);
    const tags = fmTags.length > 0 ? fmTags : inlineTags;

    // Strip front matter from content for searching
    const bodyContent = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trim();

    entries.push({ filePath, filename, title, tags, content: bodyContent, mtime });
  }

  // Sort by mtime descending (newest first)
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}

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
      continue;
    }

    if (filenameText.includes(token) || titleText.includes(token)) {
      score += weights.filenameMatch;
      reasons.push(`filename:${token}`);
      tokenMatched = true;
    }

    if (tagText.includes(token)) {
      score += weights.tagPartial;
      reasons.push(`tag-partial:${token}`);
      tokenMatched = true;
    }

    if (contentText.includes(token)) {
      score += weights.contentMatch;
      reasons.push(`content:${token}`);
      tokenMatched = true;
    }

    if (tokenMatched) matchedTokenCount += 1;
  }

  if (matchedTokenCount >= 2) {
    score += weights.multiTokenBonus;
    reasons.push("bonus:multi-token");
  }

  if (matchedTokenCount === tokens.length) {
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

  return { score, matchedTokenCount, reasons: [...new Set(reasons)], entry };
}

const server = new Server(
  { name: "notes-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_notes",
      description: "Search notes by tag, filename, or keyword",
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
      description: "Get the most recently modified notes",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: { type: "number", description: "Number of notes (default 10)" },
        },
      },
    },
    {
      name: "get_notes_by_tag",
      description: "Get all notes with a specific tag",
      inputSchema: {
        type: "object" as const,
        properties: {
          tag: { type: "string", description: "Tag name (without #)" },
        },
        required: ["tag"],
      },
    },
    {
      name: "list_tags",
      description: "List all unique tags across all notes",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "structure_search_notes",
      description: "Score-ranked search with tunable weights across all note files",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query (e.g. '#todo meeting')" },
          limit: { type: "number", description: "Max results (default 10, range 1-200)" },
          include_recency_bonus: { type: "boolean", description: "Apply recency bonus (default true)" },
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

      if (query) {
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.content.toLowerCase().includes(lowerQuery) ||
            e.filename.toLowerCase().includes(lowerQuery) ||
            e.title.toLowerCase().includes(lowerQuery) ||
            e.tags.some((t) => t.toLowerCase().includes(lowerQuery)),
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              filtered.slice(0, limit).map(({ filePath: _, content: __, ...rest }) => rest),
              null,
              2,
            ),
          },
        ],
      };
    }

    case "get_recent_notes": {
      const { limit = 10 } = request.params.arguments as { limit?: number };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              entries.slice(0, limit).map(({ filePath: _, content: __, ...rest }) => rest),
              null,
              2,
            ),
          },
        ],
      };
    }

    case "get_notes_by_tag": {
      const { tag } = request.params.arguments as { tag: string };
      const filtered = entries.filter((e) => e.tags.includes(`#${tag}`));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              filtered.map(({ filePath: _, content: __, ...rest }) => rest),
              null,
              2,
            ),
          },
        ],
      };
    }

    case "list_tags": {
      const allTags = entries.flatMap((e) => e.tags);
      const uniqueTags = [...new Set(allTags)].sort();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(uniqueTags, null, 2) }],
      };
    }

    case "structure_search_notes": {
      const {
        query,
        limit = 10,
        include_recency_bonus = true,
        weights,
      } = request.params.arguments as {
        query: string;
        limit?: number;
        include_recency_bonus?: boolean;
        weights?: Partial<SearchWeights>;
      };

      const queryTokens = tokenizeQuery(query);
      if (queryTokens.length === 0) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "query is empty" }, null, 2) },
          ],
        };
      }

      const safeLimit = toBoundedInt(limit, 10, 1, 200);
      const effectiveWeights = getEffectiveWeights(weights);

      const ranked = entries
        .map((entry) => scoreEntry(entry, queryTokens, effectiveWeights, include_recency_bonus))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.mtime - a.entry.mtime)
        .slice(0, safeLimit)
        .map(({ entry: { filePath: _, content: __, ...entryRest }, ...rest }) => ({
          ...rest,
          entry: entryRest,
        }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ query, queryTokens, totalMatches: ranked.length, results: ranked }, null, 2),
          },
        ],
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

