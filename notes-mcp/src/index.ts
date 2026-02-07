#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";

interface MemoryEntry {
  dateTime: string;
  tags: string[];
  content: string;
  reminder?: string;
}

interface SearchWeights {
  tagExact: number;
  dateMatch: number;
  monthMatch: number;
  tagPartial: number;
  contentMatch: number;
  multiTokenBonus: number;
  allTokensBonus: number;
}

interface StructuredSearchResult {
  score: number;
  matchedTokenCount: number;
  reasons: string[];
  entry: MemoryEntry;
}

const DEFAULT_WEIGHTS: SearchWeights = {
  tagExact: 6,
  dateMatch: 4,
  monthMatch: 3,
  tagPartial: 3,
  contentMatch: 2,
  multiTokenBonus: 3,
  allTokensBonus: 4,
};

function getMemoryPath(): string {
  const notesDir = process.env.NOTES_DIRECTORY;
  if (!notesDir) {
    throw new Error("NOTES_DIRECTORY environment variable not set");
  }
  return path.join(notesDir, "memory.md");
}

function parseMemoryFile(memoryPath: string): MemoryEntry[] {
  if (!fs.existsSync(memoryPath)) {
    return [];
  }

  const content = fs.readFileSync(memoryPath, "utf8");
  const lines = content.split("\n");
  const entries: MemoryEntry[] = [];

  let currentEntry: MemoryEntry | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)(.*)$/);

    if (headerMatch) {
      if (currentEntry) {
        entries.push(currentEntry);
      }

      const dateTime = headerMatch[1];
      const tagsPart = headerMatch[2];
      const tags = tagsPart.match(/#[\w-]+/g) || [];

      // Check for reminder date @YYYY-MM-DD
      const reminderMatch = tagsPart.match(/@(\d{4}-\d{2}-\d{2})/);

      currentEntry = {
        dateTime,
        tags,
        content: "",
        reminder: reminderMatch ? reminderMatch[1] : undefined,
      };
    } else if (currentEntry && line.trim() && !line.startsWith("# ")) {
      currentEntry.content += (currentEntry.content ? "\n" : "") + line;
    }
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

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
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function getEffectiveWeights(overrides?: Partial<SearchWeights>): SearchWeights {
  return {
    tagExact: toBoundedInt(overrides?.tagExact ?? DEFAULT_WEIGHTS.tagExact, DEFAULT_WEIGHTS.tagExact, 1, 20),
    dateMatch: toBoundedInt(overrides?.dateMatch ?? DEFAULT_WEIGHTS.dateMatch, DEFAULT_WEIGHTS.dateMatch, 1, 20),
    monthMatch: toBoundedInt(overrides?.monthMatch ?? DEFAULT_WEIGHTS.monthMatch, DEFAULT_WEIGHTS.monthMatch, 1, 20),
    tagPartial: toBoundedInt(overrides?.tagPartial ?? DEFAULT_WEIGHTS.tagPartial, DEFAULT_WEIGHTS.tagPartial, 1, 20),
    contentMatch: toBoundedInt(overrides?.contentMatch ?? DEFAULT_WEIGHTS.contentMatch, DEFAULT_WEIGHTS.contentMatch, 1, 20),
    multiTokenBonus: toBoundedInt(overrides?.multiTokenBonus ?? DEFAULT_WEIGHTS.multiTokenBonus, DEFAULT_WEIGHTS.multiTokenBonus, 0, 20),
    allTokensBonus: toBoundedInt(overrides?.allTokensBonus ?? DEFAULT_WEIGHTS.allTokensBonus, DEFAULT_WEIGHTS.allTokensBonus, 0, 20),
  };
}

function parseEntryDate(dateTime: string): Date | null {
  const isoLike = dateTime.includes(" ") ? dateTime.replace(" ", "T") : `${dateTime}T00:00`;
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getRecencyBonus(dateTime: string): number {
  const parsed = parseEntryDate(dateTime);
  if (!parsed) {
    return 0;
  }

  const now = new Date();
  const days = (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24);

  if (days <= 7) {
    return 4;
  }
  if (days <= 30) {
    return 3;
  }
  if (days <= 90) {
    return 2;
  }
  if (days <= 180) {
    return 1;
  }
  return 0;
}

function getBuiltInSynonyms(): Map<string, string[]> {
  return new Map<string, string[]>([
    ["経費", ["精算", "交通費", "出張費"]],
    ["会議", ["mtg", "ミーティング"]],
    ["タスク", ["todo", "課題"]],
  ]);
}

function getSynonymMap(customSynonyms?: string[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();

  for (const [key, values] of getBuiltInSynonyms()) {
    const normalizedKey = normalize(key);
    if (!map.has(normalizedKey)) {
      map.set(normalizedKey, new Set<string>());
    }
    values.forEach((value) => map.get(normalizedKey)?.add(normalize(value)));
  }

  for (const row of customSynonyms ?? []) {
    const [rawKey, rawValues] = row.split(":").map((part) => part.trim());
    if (!rawKey || !rawValues) {
      continue;
    }

    const key = normalize(rawKey);
    if (!map.has(key)) {
      map.set(key, new Set<string>());
    }

    rawValues
      .split(",")
      .map((v) => normalize(v.trim()))
      .filter((v) => v.length > 0)
      .forEach((v) => map.get(key)?.add(v));
  }

  return new Map([...map.entries()].map(([key, values]) => [key, [...values]]));
}

function expandTokens(tokens: string[], synonymMap: Map<string, string[]>): string[] {
  const expanded = new Set(tokens);

  for (const token of tokens) {
    const bareToken = token.startsWith("#") ? token.slice(1) : token;
    const synonyms = synonymMap.get(bareToken) ?? [];
    synonyms.forEach((synonym) => expanded.add(synonym));
  }

  return [...expanded];
}

function scoreEntry(
  entry: MemoryEntry,
  tokens: string[],
  weights: SearchWeights,
  includeRecencyBonus: boolean
): StructuredSearchResult {
  const dateText = normalize(entry.dateTime);
  const normalizedTags = entry.tags.map((tag) => normalize(tag));
  const tagText = normalizedTags.join(" ");
  const contentText = normalize(entry.content);
  const monthText = entry.dateTime.slice(0, 7);

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

    if (dateText.includes(token)) {
      score += weights.dateMatch;
      reasons.push(`date:${token}`);
      tokenMatched = true;
    }

    if (monthText.includes(token)) {
      score += weights.monthMatch;
      reasons.push(`month:${token}`);
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

    if (tokenMatched) {
      matchedTokenCount += 1;
    }
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
    const recencyBonus = getRecencyBonus(entry.dateTime);
    if (recencyBonus > 0) {
      score += recencyBonus;
      reasons.push(`bonus:recent+${recencyBonus}`);
    }
  }

  return {
    score,
    matchedTokenCount,
    reasons: [...new Set(reasons)],
    entry,
  };
}

const server = new Server(
  {
    name: "notes-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_notes",
      description: "Search memory notes by tag, date, or keyword",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query (keyword or tag like #todo)" },
          tag: { type: "string", description: "Filter by specific tag (without #)" },
          date: { type: "string", description: "Filter by date (YYYY-MM-DD)" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
    {
      name: "get_recent_notes",
      description: "Get the most recent memory entries",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: { type: "number", description: "Number of entries (default 5)" },
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
      name: "get_reminders",
      description: "Get notes with upcoming reminders (@YYYY-MM-DD format)",
      inputSchema: {
        type: "object" as const,
        properties: {
          days_ahead: { type: "number", description: "Days to look ahead (default 7)" },
        },
      },
    },
    {
      name: "list_tags",
      description: "List all unique tags in the memory file",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "structure_search_notes",
      description: "Structure-aware search with score/reasons, synonym expansion, and tunable weights",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query (e.g. '#todo 2026-02 経費')" },
          limit: { type: "number", description: "Max results (default 10, range 1-200)" },
          include_recency_bonus: { type: "boolean", description: "Apply recency bonus (default true)" },
          synonyms: {
            type: "array",
            items: { type: "string" },
            description: "Custom synonym rules, format: key:syn1,syn2",
          },
          weights: {
            type: "object",
            description: "Score weight overrides",
            properties: {
              tagExact: { type: "number" },
              dateMatch: { type: "number" },
              monthMatch: { type: "number" },
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const memoryPath = getMemoryPath();
  const entries = parseMemoryFile(memoryPath);

  switch (request.params.name) {
    case "search_notes": {
      const { query, tag, date, limit = 10 } = request.params.arguments as {
        query?: string;
        tag?: string;
        date?: string;
        limit?: number;
      };

      let filtered = entries;

      if (tag) {
        filtered = filtered.filter((e) => e.tags.includes(`#${tag}`));
      }

      if (date) {
        filtered = filtered.filter((e) => e.dateTime.startsWith(date));
      }

      if (query) {
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter(
          (e) =>
            e.content.toLowerCase().includes(lowerQuery) ||
            e.tags.some((t) => t.toLowerCase().includes(lowerQuery))
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(filtered.slice(0, limit), null, 2),
          },
        ],
      };
    }

    case "get_recent_notes": {
      const { limit = 5 } = request.params.arguments as { limit?: number };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(entries.slice(0, limit), null, 2),
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
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    }

    case "get_reminders": {
      const { days_ahead = 7 } = request.params.arguments as { days_ahead?: number };
      const today = new Date();
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + days_ahead);

      const todayStr = today.toISOString().split("T")[0];
      const futureStr = futureDate.toISOString().split("T")[0];

      const reminders = entries.filter(
        (e) => e.reminder && e.reminder >= todayStr && e.reminder <= futureStr
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(reminders, null, 2),
          },
        ],
      };
    }

    case "list_tags": {
      const allTags = entries.flatMap((e) => e.tags);
      const uniqueTags = [...new Set(allTags)].sort();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(uniqueTags, null, 2),
          },
        ],
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
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "query is empty" }, null, 2),
            },
          ],
        };
      }

      const safeLimit = toBoundedInt(limit, 10, 1, 200);
      const synonymMap = getSynonymMap(synonyms);
      const expandedTokens = expandTokens(queryTokens, synonymMap);
      const effectiveWeights = getEffectiveWeights(weights);

      const ranked = entries
        .map((entry) => scoreEntry(entry, expandedTokens, effectiveWeights, include_recency_bonus))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.dateTime.localeCompare(a.entry.dateTime))
        .slice(0, safeLimit);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                query,
                queryTokens,
                expandedTokens,
                totalMatches: ranked.length,
                results: ranked,
              },
              null,
              2
            ),
          },
        ],
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
