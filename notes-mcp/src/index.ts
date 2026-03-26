#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { closeDb, startFileWatcher, stopFileWatcher, queryTasks, getTaskById, setTaskDone, getTaskStats, syncTasksForFile } from "./db.js";
import { parseTasksFromFile, syncTasksIndex, extractDueDate } from "./tasks.js";
import {
  clearSearchIndexCache,
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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function nowTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sanitizeTitle(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function buildNoteContent(title: string, content: string | undefined, tags: string[] | undefined): string {
  const tagLines =
    tags && tags.length > 0
      ? `tags:\n${tags.map((t) => `  - ${t.replace(/^#/, "")}`).join("\n")}\n`
      : "";
  const frontMatter = tagLines ? `---\n${tagLines}---\n\n` : "";
  if (content !== undefined && content !== "") {
    return `${frontMatter}${content}`;
  }
  return `${frontMatter}# ${title}\n\n`;
}

function getMomentsFilePath(notesDir: string, date: string): string {
  return path.join(notesDir, "moments", `${date}.md`);
}

const MOMENTS_FRONT_MATTER_TEMPLATE = (date: string) =>
  `---\ntype: moments\ndate: ${date}\n---\n\n`;

function ensureMomentsFile(filePath: string, date: string): void {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, MOMENTS_FRONT_MATTER_TEMPLATE(date), "utf8");
  }
}

function currentTime(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const server = new Server({ name: "notes-mcp", version: "3.0.0" }, { capabilities: { tools: {} } });

// Sync tasks index for all .md files in the notes directory (non-moments only)
function _syncTasksIfNeeded(notesDir: string): void {
  if (!fs.existsSync(notesDir)) return;
  const diskFiles: { filePath: string; mtime: number; content: string }[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // skip moments subfolder — Moments are tweet-style, no tasks
        if (entry.name === "moments") continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const stat = fs.statSync(full);
        diskFiles.push({ filePath: full, mtime: stat.mtimeMs, content: fs.readFileSync(full, "utf8") });
      }
    }
  }
  walk(notesDir);
  // syncTasksIndex only rewrites files whose mtime changed
  syncTasksIndex(notesDir, diskFiles);
}

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
    {
      name: "create_note",
      description:
        "Create a new markdown note file. The filename is auto-generated from the title and current timestamp (YYYY-MM-DD_HH-mm-ss_title.md).",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Note title (used in filename and as H1 heading)" },
          content: {
            type: "string",
            description:
              "Full markdown content to write. If omitted, a minimal template with the title is used.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to include in YAML front matter (without #)",
          },
          subfolder: {
            type: "string",
            description: "Optional subfolder within the notes directory (e.g. 'projects')",
          },
        },
        required: ["title"],
      },
    },
    {
      name: "append_to_note",
      description: "Append markdown content to the end of an existing note.",
      inputSchema: {
        type: "object" as const,
        properties: {
          filename: {
            type: "string",
            description: "Relative filename of the note (as returned by other tools)",
          },
          content: { type: "string", description: "Markdown content to append" },
        },
        required: ["filename", "content"],
      },
    },
    {
      name: "add_moment",
      description: "Add a new entry to today's (or a specified date's) Moments timeline.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "The moment text to record" },
          is_task: {
            type: "boolean",
            description: "Deprecated. Moments are now always created as unchecked posts.",
          },
          date: {
            type: "string",
            description:
              "Target date in YYYY-MM-DD format. Defaults to today if omitted.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "get_tasks",
      description: "Notes全体からタスク（- [ ] / - [x]）を取得。ステータス・日付でフィルタ可能。",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            enum: ["all", "open", "done"],
            description: "フィルタするステータス (デフォルト: open)",
          },
          date_from: { type: "string", description: "開始日 YYYY-MM-DD" },
          date_to: { type: "string", description: "終了日 YYYY-MM-DD" },
          limit: { type: "number", description: "最大件数 (デフォルト: 50)" },
        },
      },
    },
    {
      name: "get_task_stats",
      description: "タスク統計: 合計・完了数・未完了数・日付別集計を返す。",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "update_task_status",
      description: "指定タスクの完了/未完了を切り替え、Markdownファイルも更新する。",
      inputSchema: {
        type: "object" as const,
        required: ["task_id", "done"],
        properties: {
          task_id: { type: "string", description: "タスクID ({file_path}:{line_index})" },
          done: { type: "boolean", description: "true=完了, false=未完了" },
        },
      },
    },
    {
      name: "add_task",
      description: "Notesに新しいタスクを追加する（- [ ] 形式）。tasks/{date}.md に書き込む。",
      inputSchema: {
        type: "object" as const,
        required: ["text"],
        properties: {
          text: { type: "string", description: "タスクのテキスト" },
          date: { type: "string", description: "YYYY-MM-DD（省略時: 今日）" },
        },
      },
    },
    {
      name: "get_reminders",
      description: "期日付きタスク（#due:YYYY-MM-DD または due:YYYY-MM-DD）を取得。",
      inputSchema: {
        type: "object" as const,
        properties: {
          days_ahead: { type: "number", description: "今日から何日先までを取得するか（デフォルト: 7）" },
        },
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

    case "create_note": {
      const {
        title,
        content,
        tags,
        subfolder,
      } = request.params.arguments as {
        title: string;
        content?: string;
        tags?: string[];
        subfolder?: string;
      };

      const timestamp = nowTimestamp();
      const safeName = sanitizeTitle(title);
      const filename = `${timestamp}_${safeName}.md`;
      const targetDir = subfolder ? path.join(notesDir, subfolder) : notesDir;
      fs.mkdirSync(targetDir, { recursive: true });
      const filePath = path.join(targetDir, filename);
      const body = buildNoteContent(title, content, tags);
      fs.writeFileSync(filePath, body, "utf8");
      clearSearchIndexCache();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ created: path.relative(notesDir, filePath), filename }),
          },
        ],
      };
    }

    case "append_to_note": {
      const { filename: targetFilename, content: appendContent } = request.params.arguments as {
        filename: string;
        content: string;
      };

      const filePath = path.join(notesDir, targetFilename);
      if (!fs.existsSync(filePath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Note not found: ${targetFilename}` }),
            },
          ],
        };
      }

      const existing = fs.readFileSync(filePath, "utf8");
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      fs.writeFileSync(filePath, `${existing}${separator}${appendContent}\n`, "utf8");
      clearSearchIndexCache();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ appended: targetFilename }),
          },
        ],
      };
    }

    case "add_moment": {
      const { text, date } = request.params.arguments as {
        text: string;
        is_task?: boolean;
        date?: string;
      };

      const targetDate = date ?? todayDate();
      const filePath = getMomentsFilePath(notesDir, targetDate);
      ensureMomentsFile(filePath, targetDate);

      const time = currentTime();
      const line = `- ${time} ${text}`;
      const existing = fs.readFileSync(filePath, "utf8");
      const separator = existing.endsWith("\n") ? "" : "\n";
      fs.writeFileSync(filePath, `${existing}${separator}${line}\n`, "utf8");
      clearSearchIndexCache();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ added: line, date: targetDate }),
          },
        ],
      };
    }

    case "get_tasks": {
      const {
        status = "open",
        date_from,
        date_to,
        limit = 50,
      } = (request.params.arguments ?? {}) as {
        status?: "all" | "open" | "done";
        date_from?: string;
        date_to?: string;
        limit?: number;
      };
      _syncTasksIfNeeded(notesDir);
      const tasks = queryTasks(notesDir, { status, dateFrom: date_from, dateTo: date_to, limit });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }],
      };
    }

    case "get_task_stats": {
      _syncTasksIfNeeded(notesDir);
      const stats = getTaskStats(notesDir);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
      };
    }

    case "update_task_status": {
      const { task_id, done } = request.params.arguments as { task_id: string; done: boolean };
      _syncTasksIfNeeded(notesDir);
      const task = getTaskById(notesDir, task_id);
      if (!task) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Task not found: ${task_id}` }) }],
        };
      }
      const filePath = task.filePath;
      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `File not found: ${filePath}` }) }],
        };
      }
      const fileLines = fs.readFileSync(filePath, "utf8").split("\n");
      const line = fileLines[task.lineIndex];
      if (!line) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Line ${task.lineIndex} not found in file` }) }],
        };
      }
      const updatedLine = done
        ? line.replace(/^- \[ \]/, "- [x]")
        : line.replace(/^- \[[xX]\]/, "- [ ]");
      fileLines[task.lineIndex] = updatedLine;
      fs.writeFileSync(filePath, fileLines.join("\n"), "utf8");
      setTaskDone(notesDir, task_id, done);
      clearSearchIndexCache();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ updated: task_id, done }) }],
      };
    }

    case "add_task": {
      const { text: taskText, date: taskDate } = (request.params.arguments ?? {}) as {
        text: string;
        date?: string;
      };
      const targetDate = taskDate ?? todayDate();
      const taskDir = path.join(notesDir, "tasks");
      fs.mkdirSync(taskDir, { recursive: true });
      const taskFilePath = path.join(taskDir, `${targetDate}.md`);
      if (!fs.existsSync(taskFilePath)) {
        fs.writeFileSync(taskFilePath, `---\ntype: tasks\ndate: ${targetDate}\n---\n\n`, "utf8");
      }
      const taskLine = `- [ ] ${taskText}`;
      const existingTaskContent = fs.readFileSync(taskFilePath, "utf8");
      const sep = existingTaskContent.endsWith("\n") ? "" : "\n";
      fs.writeFileSync(taskFilePath, `${existingTaskContent}${sep}${taskLine}\n`, "utf8");
      const taskMtime = fs.statSync(taskFilePath).mtimeMs;
      const taskFileContent = fs.readFileSync(taskFilePath, "utf8");
      const newTasks = parseTasksFromFile(taskFilePath, taskFileContent, taskMtime);
      syncTasksForFile(notesDir, taskFilePath, newTasks);
      clearSearchIndexCache();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ added: taskLine, date: targetDate }) }],
      };
    }

    case "get_reminders": {
      const { days_ahead = 7 } = (request.params.arguments ?? {}) as { days_ahead?: number };
      _syncTasksIfNeeded(notesDir);
      const today = todayDate();
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() + Math.max(0, days_ahead));
      const dateTo = `${limitDate.getFullYear()}-${pad(limitDate.getMonth() + 1)}-${pad(limitDate.getDate())}`;
      const allOpen = queryTasks(notesDir, { status: "open", limit: 0 });
      const reminders = allOpen
        .map((t) => ({ ...t, dueDate: extractDueDate(t.text) }))
        .filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= dateTo)
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(reminders, null, 2) }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const notesDir = process.env.NOTES_DIRECTORY;
  if (notesDir) {
    startFileWatcher(notesDir, () => {
      clearSearchIndexCache();
    });
  }

  console.error("Notes MCP server running on stdio");

  process.on("SIGINT", () => {
    stopFileWatcher();
    closeDb();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopFileWatcher();
    closeDb();
    process.exit(0);
  });
}

main().catch(console.error);
