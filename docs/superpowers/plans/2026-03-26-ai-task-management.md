# AI Task Management Dashboard — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moments/Notes の殴り書きをトリガーに AI が自動でタスクを抽出・整理し、Tiimo 風のビジュアルダッシュボードで管理できるようにする。

**Design Decision:** Moments は Twitter のようなつぶやき専用（チェックボックスなし）。タスク管理は完全に AI/Dashboard 側で行う。Notes は従来通り `- [ ]` 記法を使った明示的タスクをサポート。

**Architecture:** Markdown ファイルをソース・オブ・トゥルースとして維持しながら、既存の SQLite キャッシュ DB にタスクテーブルを追加し、VS Code Language Model API (GitHub Copilot) を使って AI 分析を行う。ファイル変更 → AI 処理 → SQLite 更新 → Dashboard Webview リフレッシュという反応的パイプラインを構築する。

**Tech Stack:** TypeScript / VS Code Extension API / VS Code Language Model API (vscode.lm) / Bun SQLite (bun:sqlite) / MCP SDK / vscode-webview-ui-toolkit

---

## 全体アーキテクチャ図

```
Notes (Markdown + - [ ] tasks)  ←── 明示的タスク記述
Moments (Twitter-style free text) ←── つぶやき、チェックボックスなし
         │
         │ ファイル保存イベント
         ▼
  VS Code File Watcher
         │
         ├──► Task Indexer (src/aiTaskIndexer.ts)
         │         └── Notes の [ ] / [x] を即時抽出
         │                    │
         │             SQLite tasks_cache テーブル
         │
         └──► AI Processor (src/aiTaskProcessor.ts)
                   └── vscode.lm (GitHub Copilot) へ問い合わせ
                             │ ・Moments 自由テキストからアクションを抽出
                             │ ・Notes タスクにカテゴリ/優先度を付与
                             │ ・所要時間推定
                             │ ・今日の計画生成
                             ▼
                    SQLite ai_tasks テーブル (AI 推定値をキャッシュ)
                             │
                             ▼
                  Dashboard Webview (src/dashboardPanel.ts)
                             ├── 今日のタスク一覧
                             ├── カテゴリ別ビュー
                             ├── 週間カレンダー
                             └── "Plan My Day" ボタン

MCP Server (notes-mcp) ← AI エージェント (Claude 等) からも操作可能
  └── 新 MCP ツール群
        ├── get_tasks
        ├── get_task_stats
        ├── update_task_status
        ├── add_task
        └── get_reminders
```

---

## ファイル変更マップ

### 新規作成

| ファイル                       | 責務                                              |
| ------------------------------ | ------------------------------------------------- |
| `notes-mcp/src/tasks.ts`       | タスク DB スキーマ定義、CRUD、Markdown パース     |
| `src/aiTaskIndexer.ts`         | ファイル変更 → SQLite タスク即時同期（AI なし）   |
| `src/aiTaskProcessor.ts`       | VS Code LM API を使った AI タスク抽出・エンリッチ |
| `src/dashboardPanel.ts`        | ダッシュボード Webview パネル                     |
| `src/dashboard/`               | Webview フロントエンド (HTML/CSS/JS)              |
| `notes-mcp/test/tasks.test.ts` | タスク DB と MCP ツールのテスト                   |

### 変更

| ファイル                         | 変更内容                                               |
| -------------------------------- | ------------------------------------------------------ |
| `src/moments/fileIo.ts`          | appendMoment を plain format に変更、checkbox 書き込み廃止 |
| `src/moments/panel.ts`           | チェックボックス UI・open フィルター・inboxBtnを削除   |
| `notes-mcp/src/db.ts`            | `tasks_cache` / `ai_tasks` テーブルスキーマを追加      |
| `notes-mcp/src/index.ts`         | 新 MCP ツール 5 本を追加                               |
| `src/extension.ts`               | Dashboard コマンド登録、AI プロセッサの初期化          |
| `package.json`                   | 新コマンド・設定項目の登録                             |

---

## Phase 0: Moments Twitter 化（チェックボックス廃止）

### 概要
Moments をつぶやきツールに純化する。新規エントリは `- HH:MM text` のみ。既存ファイルの `- [ ]`/`- [x]` は読み取り互換性のため認識するが、UI にチェックボックスは表示しない。タスク管理は Phase 1+ の AI/Dashboard 層が担う。

### Task 0: fileIo.ts — チェックボックス書き込みを廃止

**Files:**
- Modify: `src/moments/fileIo.ts`

変更点:
1. `appendMoment`: `- [ ] ${time} ${text}` → `- ${time} ${text}`
2. `buildMomentEntryLines` (saveEdit 用): regular エントリ編集時に `- [ ]` に変換しない — `- time text` そのままに保つ
3. `replaceMomentEntryText`: 同上

- [ ] **Step 1: `appendMoment` の `- [ ] ` プレフィックスを削除する**
- [ ] **Step 2: `buildMomentEntryLines` の regular→task 変換を削除する**
- [ ] **Step 3: `replaceMomentEntryText` の regular→task 変換を削除する**
- [ ] **Step 4: `bun run check-types` でコンパイルが通ることを確認する**

### Task 0b: panel.ts — チェックボックス UI・フィルターを削除

**Files:**
- Modify: `src/moments/panel.ts`

変更点:
1. `toggleTask` メッセージハンドラーを削除
2. `showOpenTasksOverview` メッセージハンドラーを削除
3. HTML: `#openBtn` (○) を削除
4. HTML: `#inboxBtn` (📨) の click ハンドラーを削除（後の Phase 3 でダッシュボードボタンに置き換え）
5. JS renderTimeline: `checkbox` 要素を生成しない
6. JS renderTimeline: `task-done` クラス付与を削除
7. JS renderTimeline: `activeFilter === 'open'` フィルターを削除 (常に all)
8. CSS: `.entry-checkbox`, `.task-done` などの関連スタイルを削除

- [ ] **Step 1: TypeScript 側の `toggleTask` / `showOpenTasksOverview` ハンドラーを削除する**
- [ ] **Step 2: JS の checkbox 生成・toggleTask 送信コードを削除する**
- [ ] **Step 3: `activeFilter === 'open'` フィルターと `openBtn` を削除する**
- [ ] **Step 4: `inboxBtn` click ハンドラーを削除（ボタン自体はあとでダッシュボード用に再利用）**
- [ ] **Step 5: CSS の `.entry-checkbox`, `.task-done` を削除する**
- [ ] **Step 6: `bun run check-types && node esbuild.js` で確認する**
- [ ] **Step 7: commit "refactor(moments): remove checkbox/task UI, pure tweet mode"**

---

### 概要
Markdown の `- [ ]` / `- [x]` を全ファイルからインデックス化し、MCP ツールで読み書きできるようにする。AI なし・Webview なし。テスト可能。

### Task 1: SQLite tasks_cache スキーマ

**Files:**
- Modify: `notes-mcp/src/db.ts`
- Create: `notes-mcp/test/tasks.test.ts`

```sql
CREATE TABLE IF NOT EXISTS tasks_cache (
  id           TEXT PRIMARY KEY,  -- "{file_path}:{line_index}"
  file_path    TEXT NOT NULL,
  line_index   INTEGER NOT NULL,
  text         TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,  -- SQLite boolean
  date         TEXT,             -- YYYY-MM-DD (ファイル名 or frontmatter)
  time         TEXT,             -- HH:MM (Moments のタイムスタンプ)
  source_type  TEXT NOT NULL,    -- "moments" | "note"
  tags_json    TEXT NOT NULL DEFAULT '[]',
  mtime        REAL NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_tasks (
  task_id      TEXT PRIMARY KEY REFERENCES tasks_cache(id),
  category     TEXT,             -- "work" | "personal" | "health" | "learning" | "admin"
  priority     TEXT,             -- "high" | "medium" | "low"
  time_estimate_min INTEGER,
  ai_summary   TEXT,
  enriched_at  TEXT NOT NULL
);
```

- [ ] **Step 1: tasks_cache スキーマを `db.ts` の SCHEMA 定数に追記する**
- [ ] **Step 2: ai_tasks スキーマも追記する**
- [ ] **Step 3: `bun run compile:mcp` でコンパイルが通ることを確認する**
- [ ] **Step 4: commit "feat(mcp): add tasks_cache and ai_tasks schema"**

---

### Task 2: Markdown タスクパーサー (`notes-mcp/src/tasks.ts`)

Notes / Moments ファイルから `- [ ]` / `- [x]` 行を抽出し SQLite に同期する。

```typescript
export interface TaskEntry {
  id: string;          // `${filePath}:${lineIndex}`
  filePath: string;
  lineIndex: number;
  text: string;        // チェックボックス以降のテキスト（タイムスタンプ除く）
  done: boolean;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM（Moments のみ）
  sourceType: "moments" | "note";
  tags: string[];
  mtime: number;
}

// Markdown ファイル 1 本からタスクを抽出
export function parseTasksFromFile(
  filePath: string,
  content: string,
  mtime: number,
  sourceType: "moments" | "note",
  date: string | null
): TaskEntry[]

// notes-mcp の syncNotesIndex と同じ増分同期パターン
export function syncTasksIndex(
  notesDir: string,
  diskFiles: { filePath: string; mtime: number; content: string }[]
): TaskEntry[]
```

- [ ] **Step 1: 失敗するテストを `notes-mcp/test/tasks.test.ts` に書く**

```typescript
describe("parseTasksFromFile", () => {
  it("extracts open and done tasks", () => {
    const content = `- [ ] 09:30 レポートを書く\n- [x] 10:00 MTG\n- 通常の行`;
    const tasks = parseTasksFromFile("/p/2026-03-26.md", content, 0, "moments", "2026-03-26");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].done).toBe(false);
    expect(tasks[0].text).toBe("レポートを書く");
    expect(tasks[1].done).toBe(true);
  });

  it("ignores non-task lines", () => {
    const content = `# 日記\n通常の行\n- 通常リスト`;
    expect(parseTasksFromFile("/p/note.md", content, 0, "note", null)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを `bun run test:mcp` で確認する**
- [ ] **Step 3: `notes-mcp/src/tasks.ts` を実装する（parseTasksFromFile）**
- [ ] **Step 4: テストが通ることを確認する**
- [ ] **Step 5: syncTasksIndex を実装する（db.ts の syncNotesIndex パターンを踏襲）**
- [ ] **Step 6: syncTasksIndex のテストを追加して通ることを確認する**
- [ ] **Step 7: commit "feat(mcp): task parser and sync logic"**

---

### Task 3: 新 MCP ツール — get_tasks / get_task_stats / update_task_status / add_task / get_reminders

**Files:**
- Modify: `notes-mcp/src/index.ts`
- Modify: `notes-mcp/test/tasks.test.ts`

#### `get_tasks`
```json
{
  "name": "get_tasks",
  "description": "Notes と Moments 全体からタスクを取得。ステータス・日付・カテゴリでフィルタ可能。",
  "inputSchema": {
    "properties": {
      "status": { "enum": ["all","open","done"], "default": "open" },
      "date_from": { "type": "string", "description": "YYYY-MM-DD" },
      "date_to":   { "type": "string", "description": "YYYY-MM-DD" },
      "source_type": { "enum": ["all","moments","note"], "default": "all" },
      "limit": { "type": "number", "default": 50 }
    }
  }
}
```

#### `get_task_stats`
```json
{
  "name": "get_task_stats",
  "description": "タスク統計: 合計・完了数・開放数・カテゴリ別・日付別集計。"
}
```

#### `update_task_status`
```json
{
  "name": "update_task_status",
  "description": "指定タスクの完了/未完了を切り替え、Markdown ファイルも更新する。",
  "inputSchema": {
    "required": ["task_id", "done"],
    "properties": {
      "task_id": { "type": "string" },
      "done":    { "type": "boolean" }
    }
  }
}
```

#### `add_task`
```json
{
  "name": "add_task",
  "description": "今日の Moments ファイルに新タスクを追加する。",
  "inputSchema": {
    "required": ["text"],
    "properties": {
      "text":     { "type": "string" },
      "date":     { "type": "string", "description": "YYYY-MM-DD (省略時: 今日)" },
      "time":     { "type": "string", "description": "HH:MM (省略時: 現在時刻)" }
    }
  }
}
```

#### `get_reminders`
```json
{
  "name": "get_reminders",
  "description": "期日付きタスク（#due:YYYY-MM-DD タグ or due:YYYY-MM-DD パターン）を取得。",
  "inputSchema": {
    "properties": {
      "days_ahead": { "type": "number", "default": 7 }
    }
  }
}
```

- [ ] **Step 1: get_tasks のテストを書く（DB を直接準備してツールを呼ぶ形）**
- [ ] **Step 2: テストが失敗することを確認する**
- [ ] **Step 3: get_tasks を index.ts に実装する**
- [ ] **Step 4: テストが通ることを確認する**
- [ ] **Step 5: get_task_stats / update_task_status / add_task / get_reminders を同様に TDD で実装する**
- [ ] **Step 6: `bun run test:mcp` で全テスト通過を確認する**
- [ ] **Step 7: commit "feat(mcp): add 5 new task management tools"**

---

## Phase 2: AI エンリッチメント（VS Code LM API）

### 概要
VS Code Language Model API (GitHub Copilot が提供) を使い、自由テキストからタスク抽出・カテゴリ推定・時間見積もりを行う。追加 API キー不要。

### Task 4: aiTaskProcessor.ts の基盤

**Files:**
- Create: `src/aiTaskProcessor.ts`

```typescript
// VS Code LM API wrapper
export class AiTaskProcessor {
  // Moments の自由テキストから実行可能なタスクを抽出
  async extractTasksFromFreeText(
    text: string,
    date: string
  ): Promise<ExtractedTask[]>

  // 既存タスクにカテゴリ・優先度・時間見積もりを付与
  async enrichTask(
    task: { text: string; date: string }
  ): Promise<TaskEnrichment>

  // 今日のタスク群から「今日の計画」を生成
  async planDay(
    date: string,
    tasks: TaskEntry[]
  ): Promise<DayPlan>
}

interface ExtractedTask {
  text: string;
  category: TaskCategory;
  priority: "high" | "medium" | "low";
  timeEstimateMin: number;
}

interface DayPlan {
  summary: string;
  scheduledItems: Array<{
    time: string;  // 推奨開始時刻
    task: string;
    durationMin: number;
  }>;
}
```

**実装ポイント:**
- `vscode.lm.selectChatModels({ vendor: 'copilot' })` で利用可能なモデルを取得
- JSON モードで応答を要求し `JSON.parse()` で構造化データを得る
- LM API が使えない場合（モデルなし）はフォールバックして処理をスキップ
- `extractTasksFromFreeText` のプロンプト例:
  ```
  以下の日記テキストから、実行可能なタスクを JSON 配列で抽出してください。
  各タスクは { text, category, priority, timeEstimateMin } を持つこと。
  カテゴリ: work | personal | health | learning | admin
  優先度: high | medium | low
  テキスト: {{content}}
  ```

- [ ] **Step 1: `src/aiTaskProcessor.ts` を作成、ファイル構造だけ定義（型・インターフェース）**
- [ ] **Step 2: `extractTasksFromFreeText` を実装する（vscode.lm を使う）**
- [ ] **Step 3: `enrichTask` を実装する**
- [ ] **Step 4: `planDay` を実装する**
- [ ] **Step 5: `bun run check-types` でコンパイルエラーがないことを確認する**
- [ ] **Step 6: commit "feat: AI task processor using vscode.lm API"**

---

### Task 5: ファイル変更 → AI 処理パイプライン (`src/aiTaskIndexer.ts`)

**Files:**
- Create: `src/aiTaskIndexer.ts`
- Modify: `src/extension.ts`

```typescript
// ファイル保存時に呼ばれるオーケストレーター
export class AiTaskIndexer {
  // 1. Markdown -> タスク即時同期（AI なし）
  async syncTasksFromFile(filePath: string): Promise<void>

  // 2. AI エンリッチメント（デバウンス 2 秒）
  async scheduleEnrichment(filePath: string): Promise<void>

  // 3. 今日 Moments が更新されたら "Plan my day" を自動更新
  async refreshDayPlanIfToday(filePath: string): Promise<void>
}
```

**設定項目（package.json の contributes.configuration に追加）:**
```json
"noteeees.ai.autoEnrich": {
  "type": "boolean",
  "default": false,
  "description": "ファイル保存時に自動で AI タスクエンリッチを実行する"
},
"noteeees.ai.autoPlanDay": {
  "type": "boolean",
  "default": false,
  "description": "今日の Moments 更新時に自動で今日の計画を再生成する"
}
```

- [ ] **Step 1: `aiTaskIndexer.ts` の骨格を作成する**
- [ ] **Step 2: `syncTasksFromFile` を実装する（MCP の notes-mcp HTTP API 経由か直接 SQLite 書き込み）**
- [ ] **Note:** VS Code extension と MCP サーバーが別プロセスなので、DB 書き込みは MCP 経由（MCPClient または子プロセス）かextension 側で直接 DB を開く必要がある。**推奨は extension 側でも同じ bun:sqlite を使いDB に直接書き込む**（MCP はあくまで AI エージェント向けインターフェース）。
- [ ] **Step 3: `scheduleEnrichment` を実装する（デバウンス付き）**
- [ ] **Step 4: `extension.ts` の `activate` で `AiTaskIndexer` を初期化し、ファイルウォッチャーに接続する**
- [ ] **Step 5: `bun run check-types && node esbuild.js` で確認する**
- [ ] **Step 6: commit "feat: reactive AI task indexing pipeline"**

---

## Phase 3: ダッシュボード UI

### 概要
新しい VS Code Webview パネル。今日のタスク・カテゴリ別・週間カレンダーを表示し、"Plan My Day" などのアクションを提供する。

### Task 6: ダッシュボードパネルの骨格 (`src/dashboardPanel.ts`)

`momentsPanel.ts` と同じ構造で作成する。

**Files:**
- Create: `src/dashboardPanel.ts`
- Create: `src/dashboard/webview.html`（ベース HTML テンプレート）

**パネル機能 (MVP):**
1. **Today's Tasks** — 今日のタスク一覧（checkbox 付き、クリックで done toggle）
2. **Categories** — カテゴリ別タスク数（work / personal / health / learning / admin）
3. **Weekly Overview** — 過去7日のタスク完了率グラフ（SVG または CSS バー）
4. **Plan My Day** ボタン — `aiTaskProcessor.planDay()` を呼んで結果をモーダル表示
5. **AI Extract** ボタン — 今日の Moments を AI 分析してタスクを抽出

#### メッセージプロトコル（Extension ↔ Webview）

```typescript
// Extension → Webview
type DashboardMessage =
  | { type: "updateTasks"; tasks: TaskEntry[]; stats: TaskStats; dayPlan?: DayPlan }
  | { type: "updateAiStatus"; status: "idle" | "processing" | "done"; message?: string }

// Webview → Extension
type DashboardCommand =
  | { type: "toggleTask"; taskId: string; done: boolean }
  | { type: "planDay" }
  | { type: "aiExtract"; date: string }
  | { type: "openFile"; filePath: string; lineIndex: number }
```

- [ ] **Step 1: `src/dashboardPanel.ts` を作成（パネル表示のみ、空 HTML）**
- [ ] **Step 2: `package.json` に `noteeees.openDashboard` コマンドを追加する**
- [ ] **Step 3: `extension.ts` にコマンドを登録してパネルが開くことを確認する**
- [ ] **Step 4: commit "feat: dashboard panel skeleton"**

---

### Task 7: ダッシュボード Webview フロントエンド

**Files:**
- Modify: `src/dashboard/webview.html`
- Create: `src/dashboard/main.ts`（esbuild でバンドル）

**UI 構成（バニラ TypeScript + CSS、フレームワーク不使用）:**

```
┌─────────────────────────────────────────────┐
│  📋 AI Task Dashboard           [Refresh] [⚙] │
├──────────────────┬──────────────────────────┤
│  TODAY (3/26)    │  WEEKLY OVERVIEW          │
│  ┌────────────── │  Mon ████████ 8/10        │
│  │ [x] レポート  │  Tue ██████   6/12        │
│  │ [ ] MTG       │  Wed ████     4/8         │
│  │ [ ] 運動      │  ...                      │
│  └────────────── │                           │
├──────────────────┴──────────────────────────┤
│  CATEGORIES                                  │
│  work [███████   ] 7  personal [████  ] 4    │
│  health [██    ] 2  learning [█     ] 1      │
├─────────────────────────────────────────────┤
│  [✨ Plan My Day]  [🤖 AI Extract from Notes]│
└─────────────────────────────────────────────┘
```

- [ ] **Step 1: 今日のタスク一覧を表示するシンプルな HTML/CSS を作成する**
- [ ] **Step 2: toggleTask メッセージを Extension に送る JS を実装する（Webview → Extension）**
- [ ] **Step 3: Extension 側で toggleTask を受けて Markdown ファイルを更新する**
- [ ] **Step 4: Weekly Overview のバーグラフ（CSS grid ベース）を追加する**
- [ ] **Step 5: カテゴリビューを追加する**
- [ ] **Step 6: "Plan My Day" ボタンと結果表示モーダルを実装する**
- [ ] **Step 7: "AI Extract" ボタンを実装する**
- [ ] **Step 8: `bun run check-types && node esbuild.js` で確認する**
- [ ] **Step 9: commit "feat: dashboard webview UI"**

---

## Phase 4: リアルタイム更新と仕上げ

### Task 8: ステータスバー統合

- [ ] **Step 1: ステータスバー項目を追加（「🤖 AI: idle」→ 処理中は「⏳ AI: 解析中…」）**
- [ ] **Step 2: AI 処理の開始・完了時に更新する**
- [ ] **Step 3: クリックでダッシュボードを開く**
- [ ] **Step 4: commit "feat: AI status bar item"**

### Task 9: 設定と UX の仕上げ

- [ ] **Step 1: `noteeees.ai.autoEnrich` 設定を package.json に追加する**
- [ ] **Step 2: `noteeees.ai.autoPlanDay` 設定を追加する**
- [ ] **Step 3: コマンドパレットに "Noteeees: AI - Plan My Day" を追加する**
- [ ] **Step 4: コマンドパレットに "Noteeees: AI - Extract Tasks from Today" を追加する**
- [ ] **Step 5: CHANGELOG.md を更新する**
- [ ] **Step 6: README.md の AI 機能セクションを追加する**
- [ ] **Step 7: 全バリデーション: `bun run check-types && bun run lint && bun run compile-tests && node esbuild.js && bun run compile:mcp && bun run test:mcp && bun x vscode-test`**
- [ ] **Step 8: commit "feat: AI task management v1.0"**

---

## 技術的考慮事項

### VS Code LM API の使い方

```typescript
// 利用可能なモデルを取得（GitHub Copilot が必要）
const [model] = await vscode.lm.selectChatModels({
  vendor: 'copilot',
  family: 'gpt-4o'  // または 'claude-3.5-sonnet'
});

if (!model) {
  // AI 機能は graceful degradation — AI なしでも動作する
  return null;
}

const messages = [
  vscode.LanguageModelChatMessage.User(prompt)
];

const response = await model.sendRequest(messages, {}, token);
let text = '';
for await (const chunk of response.text) {
  text += chunk;
}
return JSON.parse(text);
```

### Extension ↔ MCP DB 共有の注意点

- MCP サーバーと Extension は別プロセスなので SQLite への同時書き込みは WAL モードが必要
- **推奨**: Extension 側は `aiTaskIndexer.ts` で直接 SQLite に書き込む（MCP のコードを import する形）
- MCP は AI エージェント向け読み取り/操作インターフェースとして位置付ける
- DB ファイルは既存の `.noteeees-index.db` に統合する（別ファイルにしない）

### セキュリティ

- LM API に送るテキストはノート内容のみ（外部送信なし、Copilot の通常利用範囲内）
- タスク ID は `{filePath}:{lineIndex}` 形式 — パストラバーサル対策で `path.resolve()` で検証する
- Webview は `nonce` を使った CSP を設定する（`momentsPanel.ts` と同じパターン）

---

## 実装優先度の提案

| Phase                   | 依存               | 工数（概算） | 独立完結度  |
| ----------------------- | ------------------ | ------------ | ----------- |
| Phase 1: データレイヤー | なし               | 2-3日        | ✅ 完全独立 |
| Phase 2: AI エンリッチ  | Phase 1 のスキーマ | 1-2日        | ⬤ 部分依存 |
| Phase 3: Dashboard UI   | Phase 1 のデータ   | 2-3日        | ⬤ 部分依存 |
| Phase 4: 仕上げ         | Phase 2+3          | 1日          | ❌ 依存あり |

**推奨実施順序:** Phase 1 → Phase 3 (UI 骨格) → Phase 2 (AI) → Phase 3 (AI ボタン) → Phase 4

Phase 1 だけでも「MCP でタスク管理できる」という大きな価値が生まれます。

---

## 将来拡張アイデア（スコープ外）

- **カレンダー連携**: iCal 形式でエクスポート、Google Calendar 同期
- **リマインダー通知**: VS Code notifications / macOS native notification
- **音声入力**: VS Code Speech API（将来的に追加予定）
- **繰り返しタスク**: `every:monday` タグによるルーティン管理
- **ポモドーロタイマー**: フォーカスタイマー機能（Tiimo の Focus Timer）
- **チーム共有**: Git コミット経由でタスクを共有
