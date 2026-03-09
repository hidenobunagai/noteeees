#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  executeStructuredSearch,
  extractSnippet,
  getCachedSearchIndex,
  getSearchIndexNotes,
  noteMatchesDateRange,
  toBoundedInt,
  tokenizeQuery,
  type Bm25Options,
  type SearchStrategy,
  type SearchWeights,
} from "./search.js";

function getNotesDir(): string {
  const notesDir = process.env.NOTES_DIRECTORY;
  if (!notesDir) {
    throw new Error("NOTES_DIRECTORY environment variable not set");
  }
  return notesDir;
}

const server = new Server({ name: "notes-mcp", version: "3.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_notes",
      description:
        "Search notes by keyword, tag, or filename. Returns metadata + a snippet around each match.",
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
      description:
        "Get notes created within a date range (based on filename date or modification time)",
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
      description:
        "List all notes with metadata only (filename, title, tags, createdAt, mtime). Lightweight overview.",
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
      description:
        "Score-ranked search with strategy selection, tunable weights, synonym expansion, optional explanations, and recency bonus. Returns snippet per result.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query (e.g. '#todo meeting 経費')" },
          limit: { type: "number", description: "Max results (default 10, range 1-200)" },
          include_recency_bonus: {
            type: "boolean",
            description: "Apply recency bonus (default true)",
          },
          search_strategy: {
            type: "string",
            enum: ["auto", "classic", "hybrid_bm25"],
            description:
              "Ranking strategy. auto chooses classic for small or tag-heavy searches and hybrid_bm25 for larger free-text searches.",
          },
          explain: {
            type: "boolean",
            description: "Whether to include detailed ranking reasons (default true).",
          },
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
          bm25: {
            type: "object",
            description: "BM25 tuning options used by hybrid_bm25 and auto.",
            properties: {
              k1: { type: "number" },
              b: { type: "number" },
              minDocumentCountForAuto: { type: "number" },
              minQueryTokensForAuto: { type: "number" },
              momentsPenalty: { type: "number" },
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
          filename: {
            type: "string",
            description: "Relative filename of the note (as returned by other tools)",
          },
        },
        required: ["filename"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const notesDir = getNotesDir();
  const searchIndex = getCachedSearchIndex(notesDir);
  const entries = getSearchIndexNotes(searchIndex);

  switch (request.params.name) {
    case "search_notes": {
      const {
        query,
        tag,
        limit = 10,
      } = request.params.arguments as {
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
          return tokens.some(
            (t) => lc.includes(t) || fn.includes(t) || ti.includes(t) || tg.includes(t),
          );
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              filtered.slice(0, limit).map(({ filePath: _, content, ...rest }) => ({
                ...rest,
                snippet: extractSnippet(content, tokens),
              })),
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
              filtered.map(({ filePath: _, content, ...rest }) => ({
                ...rest,
                snippet: extractSnippet(content, []),
              })),
              null,
              2,
            ),
          },
        ],
      };
    }

    case "get_notes_by_date": {
      const {
        from,
        to,
        limit = 20,
      } = request.params.arguments as {
        from?: string;
        to?: string;
        limit?: number;
      };
      const filtered = entries.filter((e) => noteMatchesDateRange(e, from, to));
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

    case "list_notes": {
      const { limit = 50 } = request.params.arguments as { limit?: number };
      const items = limit === 0 ? entries : entries.slice(0, limit);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              items.map(({ filePath: _, content: __, ...rest }) => rest),
              null,
              2,
            ),
          },
        ],
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
        search_strategy,
        explain = true,
        synonyms,
        weights,
        bm25,
      } = request.params.arguments as {
        query: string;
        limit?: number;
        include_recency_bonus?: boolean;
        search_strategy?: SearchStrategy;
        explain?: boolean;
        synonyms?: string[];
        weights?: Partial<SearchWeights>;
        bm25?: Partial<Bm25Options>;
      };

      const response = executeStructuredSearch(searchIndex, {
        query,
        limit: toBoundedInt(limit, 10, 1, 200),
        include_recency_bonus,
        search_strategy,
        explain,
        synonyms,
        weights,
        bm25,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    case "get_note_content": {
      const { filename } = request.params.arguments as { filename: string };
      const entry = entries.find((e) => e.filename === filename);
      if (!entry) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Note not found: ${filename}` }),
            },
          ],
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
