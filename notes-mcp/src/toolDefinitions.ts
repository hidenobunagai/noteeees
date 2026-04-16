export const MCP_TOOL_DEFINITIONS = [
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
        date: {
          type: "string",
          description: "Target date in YYYY-MM-DD format. Defaults to today if omitted.",
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
        days_ahead: {
          type: "number",
          description: "今日から何日先までを取得するか（デフォルト: 7）",
        },
      },
    },
  },
];
