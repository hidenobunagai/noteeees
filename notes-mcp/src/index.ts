#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import {
  closeDb,
  getTaskById,
  getTaskStats,
  queryTasks,
  setTaskDone,
  startFileWatcher,
  stopFileWatcher,
  syncTasksForFile,
} from "./db.js";
import { enforceMaxContentSize, isPathInside, resolveSafeFilePath, sanitizeTitle } from "./pathSafety.js";
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
import { extractDueDate, parseTasksFromFile, syncTasksIndex } from "./tasks.js";
import { MCP_TOOL_DEFINITIONS } from "./toolDefinitions.js";

function getNotesDir(): string {
  const notesDir = process.env.NOTES_DIRECTORY;
  if (!notesDir) {
    throw new Error("NOTES_DIRECTORY environment variable not set");
  }
  return path.resolve(notesDir);
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

function buildNoteContent(
  title: string,
  content: string | undefined,
  tags: string[] | undefined,
): string {
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

async function ensureMomentsFile(filePath: string, date: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, MOMENTS_FRONT_MATTER_TEMPLATE(date), "utf8");
  }
}

function currentTime(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const server = new Server({ name: "notes-mcp", version: "3.0.0" }, { capabilities: { tools: {} } });

// Sync tasks index for all .md files in the notes directory (non-moments only)
async function _syncTasksIfNeeded(notesDir: string): Promise<void> {
  try {
    await fs.access(notesDir);
  } catch {
    return;
  }
  const diskFiles: { filePath: string; mtime: number; content: string }[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "moments") continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const stat = await fs.stat(full);
        const content = await fs.readFile(full, "utf8");
        diskFiles.push({
          filePath: full,
          mtime: stat.mtimeMs,
          content,
        });
      }
    }
  }
  await walk(notesDir);
  syncTasksIndex(notesDir, diskFiles);
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: MCP_TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const notesDir = getNotesDir();
  const searchIndex = await getCachedSearchIndex(notesDir);
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
      if (!resolveSafeFilePath(notesDir, filename)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Invalid filename: ${filename}` }),
            },
          ],
        };
      }
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
      const { title, content, tags, subfolder } = request.params.arguments as {
        title: string;
        content?: string;
        tags?: string[];
        subfolder?: string;
      };

      if (!title.trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Title must not be empty" }),
            },
          ],
        };
      }

      if (content !== undefined) {
        const sizeCheck = enforceMaxContentSize(content);
        if (!sizeCheck.valid) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: sizeCheck.error }) }],
          };
        }
      }

      const timestamp = nowTimestamp();
      const safeName = sanitizeTitle(title);
      const filename = `${timestamp}_${safeName}.md`;
      const targetDir = subfolder ? path.join(notesDir, subfolder) : notesDir;
      if (!isPathInside(notesDir, targetDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Invalid subfolder: ${subfolder}` }),
            },
          ],
        };
      }
      await fs.mkdir(targetDir, { recursive: true });
      const filePath = path.join(targetDir, filename);
      const body = buildNoteContent(title, content, tags);
      await fs.writeFile(filePath, body, "utf8");
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

      const appendSizeCheck = enforceMaxContentSize(appendContent);
      if (!appendSizeCheck.valid) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: appendSizeCheck.error }) }],
        };
      }

      const filePath = resolveSafeFilePath(notesDir, targetFilename);
      if (!filePath) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Invalid filename: ${targetFilename}` }),
            },
          ],
        };
      }
      try {
        await fs.access(filePath);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Note not found: ${targetFilename}` }),
            },
          ],
        };
      }

      const existing = await fs.readFile(filePath, "utf8");
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      await fs.writeFile(filePath, `${existing}${separator}${appendContent}\n`, "utf8");
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
        date?: string;
      };

      const momentSizeCheck = enforceMaxContentSize(text);
      if (!momentSizeCheck.valid) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: momentSizeCheck.error }) }],
        };
      }

      const targetDate = date ?? todayDate();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Invalid date format: ${date}. Use YYYY-MM-DD.` }),
            },
          ],
        };
      }
      const filePath = getMomentsFilePath(notesDir, targetDate);
      if (!isPathInside(notesDir, filePath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Invalid moments path for date: ${targetDate}` }),
            },
          ],
        };
      }
      await ensureMomentsFile(filePath, targetDate);

      const time = currentTime();
      const line = `- ${time} ${text}`;
      const existing = await fs.readFile(filePath, "utf8");
      const separator = existing.endsWith("\n") ? "" : "\n";
      await fs.writeFile(filePath, `${existing}${separator}${line}\n`, "utf8");
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
      await _syncTasksIfNeeded(notesDir);
      const tasks = queryTasks(notesDir, { status, dateFrom: date_from, dateTo: date_to, limit });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }],
      };
    }

    case "get_task_stats": {
      await _syncTasksIfNeeded(notesDir);
      const stats = getTaskStats(notesDir);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
      };
    }

    case "update_task_status": {
      const { task_id, done } = request.params.arguments as { task_id: string; done: boolean };
      await _syncTasksIfNeeded(notesDir);
      const task = getTaskById(notesDir, task_id);
      if (!task) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Task not found: ${task_id}` }),
            },
          ],
        };
      }
      if (!isPathInside(notesDir, task.filePath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Invalid file path for task: ${task_id}` }),
            },
          ],
        };
      }
      try {
        await fs.access(task.filePath);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `File not found: ${task.filePath}` }),
            },
          ],
        };
      }
      const fileContent = await fs.readFile(task.filePath, "utf8");
      const fileLines = fileContent.split("\n");
      const line = fileLines[task.lineIndex];
      if (!line) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Line ${task.lineIndex} not found in file` }),
            },
          ],
        };
      }
      const updatedLine = done
        ? line.replace(/^- \[ \]/, "- [x]")
        : line.replace(/^- \[[xX]\]/, "- [ ]");
      fileLines[task.lineIndex] = updatedLine;
      await fs.writeFile(task.filePath, fileLines.join("\n"), "utf8");
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
      const taskSizeCheck = enforceMaxContentSize(taskText);
      if (!taskSizeCheck.valid) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: taskSizeCheck.error }) }],
        };
      }

      const targetDate = taskDate ?? todayDate();
      const taskDir = path.join(notesDir, "tasks");
      await fs.mkdir(taskDir, { recursive: true });
      const taskFilePath = path.join(taskDir, `${targetDate}.md`);
      try {
        await fs.access(taskFilePath);
      } catch {
        await fs.writeFile(taskFilePath, `---\ntype: tasks\ndate: ${targetDate}\n---\n\n`, "utf8");
      }
      const taskLine = `- [ ] ${taskText}`;
      const existingTaskContent = await fs.readFile(taskFilePath, "utf8");
      const sep = existingTaskContent.endsWith("\n") ? "" : "\n";
      await fs.writeFile(taskFilePath, `${existingTaskContent}${sep}${taskLine}\n`, "utf8");
      const taskStat = await fs.stat(taskFilePath);
      const taskFileContent = await fs.readFile(taskFilePath, "utf8");
      const newTasks = parseTasksFromFile(taskFilePath, taskFileContent, taskStat.mtimeMs);
      syncTasksForFile(notesDir, taskFilePath, newTasks);
      clearSearchIndexCache();
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ added: taskLine, date: targetDate }) },
        ],
      };
    }

    case "get_reminders": {
      const { days_ahead = 7 } = (request.params.arguments ?? {}) as { days_ahead?: number };
      await _syncTasksIfNeeded(notesDir);
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
