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
