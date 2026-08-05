import * as vscode from "vscode";

export type Locale = "en" | "ja";
export type LocaleSetting = "auto" | Locale;

const en = {
  // --- Extension host ---
  notesDirNotConfigured: "Notes directory is not configured. Run 'Notes: Run Setup' first.",
  selectNotesDirectory: "Select Notes Directory",
  setNotesDirFor: "Set notes directory for...",
  globalScope: "$(globe) Global (all workspaces)",
  globalScopeDesc: "Stored in machine-local extension storage",
  workspaceScope: "$(folder) This Workspace only",
  workspaceScopeDesc: "Stored in workspace settings (.vscode/settings.json)",
  notesDirSet: "Notes directory set ({scope}): {dir}",
  noTagsFound: "No tags found.",
  tagSortSet: "Sidebar tag sort: {mode}",
  archiveConfirm: "Move Moments files older than {days} days to archive?",
  archiveBtn: "Archive",
  cancelBtn: "Cancel",
  noMomentsToArchive: "No Moments files to archive ({skipped} recent files kept).",
  archivedMoments: "Archived {count} Moments files ({skipped} recent files kept).",
  tasksStatusBar: "Tasks",
  tasksAnalyzing: "Tasks: analyzing…",
  noteTitlePrompt: "Enter note title (use / for subfolders)",
  noteTitlePlaceholder: "Meeting Notes  or  projects/ProjectX",
  overwriteConfirm: 'File "{name}" already exists. Overwrite?',
  yesBtn: "Yes",
  noBtn: "No",
  noteCreated: "Note created: {name}",
  selectTemplate: "Select a template",
  templateDefault: "$(file) Default",
  templateEmpty: "$(file-text) Empty",
  noNotesFound: "No notes found.",
  notesFound: "{count} notes found. Search by title, path, tag, or body text.",
  searchTagsPlaceholder: "Search tags",
  notesTagged: "Notes tagged {tag}",
  createNewNote: 'Create new note: "{title}"',
  momentsInboxTitle: "Moments Inbox • {filter}",
  inboxFilterAllMoments: "All Moments",
  inboxFilterOpenOnly: "Open Only",
  inboxFilterDoneOnly: "Done Only",
  inboxFilterOverdue: "Overdue",
  switchInboxFilter: "Switch inbox filter ({label})",
  noMomentsFound: "No moments found across all days.",
  noOpenTasksMatch:
    "No {filter} match the current filter. Type to search by text, date, state, or file.",
  openDoneSummary:
    "{open} open • {done} done across Moments. Type to filter by text, date, state, or file.",
  markAsOpen: "Mark as open",
  markAsDone: "Mark as done",
  open: "Open",
  done: "Done",
  taskTextEmpty: "Task text cannot be empty.",
  addCandidateFailed: "Failed to add candidate task.",
  aiMomentsProcessing: "Analyzing Moments from {from} to {to}...",
  aiNotesProcessing: "Analyzing notes from {from} to {to}...",
  noMomentsInRange: "No Moments found in the range {from} to {to}.",
  noNotesInRange: "No notes found in the range {from} to {to}.",
  extractedMomentsCount: "Extracted {count} task candidate(s) from {days} day(s) of Moments.",
  extractedNotesCount: "Extracted {count} task candidate(s) from {notes} note(s).",
  hiddenDismissed: "{count} temporarily hidden",
  hiddenDuplicates: "{count} duplicate candidates",
  noNewCandidates: "No new candidates. Excluded as {hidden}.",
  noActionableTasks: "No actionable tasks found.",
  candidatesShown: "Showing {count} candidates. Excluded as {hidden}.",
  candidatesShownSimple: "Showing {count} candidates.",
  modelUnavailable: "AI extraction failed. Check your GitHub Copilot Chat availability.",
  requestFailed: "AI extraction failed. Please try again in a moment.",

  // --- Moments webview ---
  allMoments: "All moments",
  taskInbox: "Task inbox",
  openTodayFile: "Open today's file",
  exportSelected: "Export selected entries",
  jumpToDate: "Jump to date",
  backToToday: "Back to today",
  todaySuffix: "· Today",
  pinnedHeader: "Pinned",
  emptyToday: "No moments yet today",
  emptyHint: "Capture ideas, or add #tags to categorize",
  capturePlaceholder: "Capture a thought... (#tag to categorize)",
  searchPlaceholder: "Search moments...",
  clearSearch: "Clear search",
  sendBtn: "Send (Enter)",
  exportAsNote: "Export as Note",
  selectedCount: "{count} selected",
  noMomentsSearchTag: 'No moments tagged {tag} matching "{query}"',
  noMomentsSearch: 'No moments matching "{query}"',
  noMomentsTagged: "No moments tagged {tag} in this recent feed",
  noMomentsEmpty: "No moments yet — capture your first thought!",
  edit: "Edit",
  save: "Save",
  delete: "Delete",
  pin: "Pin",
  unpin: "Unpin",
  momentTextEmpty: "Moment text must not be empty.",
  todayBadge: "Today",

  // --- Dashboard webview ---
  dashboardTitle: "Task Dashboard",
  kpiOpen: "Open",
  kpiToday: "Today",
  kpiDone: "Done",
  refresh: "Refresh",
  addTaskPlaceholder: "Add a task… (Enter to save)",
  addBtn: "Add",
  fromMoments: "From Moments",
  fromNotes: "From Notes",
  advanced: "Advanced",
  aiModelLabel: "AI model:",
  autoSelect: "Auto select",
  periodLabel: "Period:",
  searchTasksPlaceholder: "Search tasks…",
  sectionToday: "Today",
  sectionPlanned: "Planned",
  sectionUnsorted: "Unsorted",
  sectionDone: "Done",
  sectionTodayDesc: "Today and overdue",
  sectionPlannedDesc: "Within 7 days and later",
  sectionUnsortedDesc: "Inbox or undated backlog",
  sectionDoneDesc: "Completed",
  filterAll: "All",
  filterToday: "Today",
  filterPlanned: "Planned",
  filterDone: "Done",
  noTasksYet: "No tasks yet",
  noTasksYetBody: "Use Add Task or AI Extract to create your first task.",
  nothingScheduledToday: "Nothing scheduled for today",
  noPlannedTasks: "No planned tasks",
  noCompletedTasks: "No completed tasks",
  noItemsInFilter: "No items in this filter",
  noMatchingTasks: "No matching tasks",
  filteredItems: "filtered items",
  taskField: "Task",
  dueField: "Due",
  sourceField: "Source",
  openFile: "Open File",
  more: "More",
  candidate: "Candidate",
  dismiss: "Dismiss",
  alreadyExists: "Already exists",
  noCandidatesYet: "No candidates yet",
  noCandidatesBody:
    "Use AI Extract or From Notes to find task candidates from your Moments and notes.",
  aiBadge: "AI",
  taskTextRequired: "Task text is required.",
  due: "Due",
  noDate: "No date",
  dismissError: "Dismiss error",

  // --- AI prompts ---
  promptExtractTasks:
    'Extract only actionable tasks / action items from the following daily journal text as a JSON array.\nIgnore greetings, impressions, and purely emotional statements.\n\nEach task must be an object with these fields:\n- "text": task description (concise, starting with a verb)\n- "category": one of "work" | "personal" | "health" | "learning" | "admin"\n- "priority": one of "high" | "medium" | "low"\n- "timeEstimateMin": estimated time in minutes (integer)\n- "dueDate": "YYYY-MM-DD" string if the text contains a date in @YYYY-MM-DD / 📅YYYY-MM-DD / due:YYYY-MM-DD form, otherwise null\n\nReturn only the JSON array. No explanations.\n\nText:\n',
  promptEnrichTasks:
    'For each task in the list below, determine its category, priority, and estimated time.\nNever change the original task text. Output the input task text exactly in the "text" field.\n\nEach task must be an object with these fields:\n- "text": the input task text (unchanged)\n- "category": one of "work" | "personal" | "health" | "learning" | "admin"\n- "priority": one of "high" | "medium" | "low"\n- "timeEstimateMin": estimated time in minutes (integer)\n\nReturn only the JSON array. No explanations or markdown formatting (```json etc.).\n\nTasks:\n',
};

const ja: Record<keyof typeof en, string> = {
  notesDirNotConfigured:
    "ノートディレクトリが設定されていません。最初に「Notes: Run Setup」を実行してください。",
  selectNotesDirectory: "ノートディレクトリを選択",
  setNotesDirFor: "ノートディレクトリを設定...",
  globalScope: "$(globe) グローバル（すべてのワークスペース）",
  globalScopeDesc: "マシンローカルの拡張機能ストレージに保存",
  workspaceScope: "$(folder) このワークスペースのみ",
  workspaceScopeDesc: "ワークスペース設定（.vscode/settings.json）に保存",
  notesDirSet: "ノートディレクトリを設定しました（{scope}）: {dir}",
  noTagsFound: "タグが見つかりません。",
  tagSortSet: "サイドバーのタグ並び替え: {mode}",
  archiveConfirm: "{days} 日より古い Moments ファイルをアーカイブに移動しますか？",
  archiveBtn: "アーカイブ",
  cancelBtn: "キャンセル",
  noMomentsToArchive:
    "アーカイブ対象の Moments ファイルはありません（{skipped} 件の新しいファイルを保持）。",
  archivedMoments:
    "{count} 件の Moments ファイルをアーカイブしました（{skipped} 件の新しいファイルを保持）。",
  tasksStatusBar: "タスク",
  tasksAnalyzing: "タスク: 解析中…",
  noteTitlePrompt: "ノートのタイトルを入力してください（/ でサブフォルダ指定）",
  noteTitlePlaceholder: "ミーティングメモ または projects/プロジェクトX",
  overwriteConfirm: "ファイル「{name}」は既に存在します。上書きしますか？",
  yesBtn: "はい",
  noBtn: "いいえ",
  noteCreated: "ノートを作成しました: {name}",
  selectTemplate: "テンプレートを選択",
  templateDefault: "$(file) デフォルト",
  templateEmpty: "$(file-text) 空",
  noNotesFound: "ノートが見つかりません。",
  notesFound: "{count} 件のノートが見つかりました。タイトル・パス・タグ・本文で検索できます。",
  searchTagsPlaceholder: "タグを検索",
  notesTagged: "タグ「{tag}」のノート",
  createNewNote: "「{title}」の新しいノートを作成",
  momentsInboxTitle: "Moments 受信箱 • {filter}",
  inboxFilterAllMoments: "すべてのモーメント",
  inboxFilterOpenOnly: "未完了のみ",
  inboxFilterDoneOnly: "完了のみ",
  inboxFilterOverdue: "期限超過",
  switchInboxFilter: "受信箱フィルターを切り替え（{label}）",
  noMomentsFound: "全期間でモーメントが見つかりません。",
  noOpenTasksMatch:
    "「{filter}」に一致する項目がありません。テキスト・日付・状態・ファイルで検索できます。",
  openDoneSummary:
    "Moments 全体で未完了 {open} 件 • 完了 {done} 件。テキスト・日付・状態・ファイルで絞り込めます。",
  markAsOpen: "未完了に戻す",
  markAsDone: "完了にする",
  open: "未完了",
  done: "完了",
  taskTextEmpty: "タスクのテキストを入力してください。",
  addCandidateFailed: "候補タスクの追加に失敗しました。",
  aiMomentsProcessing: "{from} ～ {to} の Moments を分析しています...",
  aiNotesProcessing: "{from} ～ {to} のノートを分析しています...",
  noMomentsInRange: "{from} ～ {to} の期間に該当する Moments が見つかりません。",
  noNotesInRange: "{from} ～ {to} の期間に該当するノートが見つかりません。",
  extractedMomentsCount: "{days}日分の Moments から{count}件のタスク候補を抽出しました。",
  extractedNotesCount: "{notes}件のノートから{count}件のタスク候補を抽出しました。",
  hiddenDismissed: "{count}件は一時非表示",
  hiddenDuplicates: "{count}件は候補内で重複",
  noNewCandidates: "新しい候補はありません。{hidden}として除外しました。",
  noActionableTasks: "実行可能なタスクは見つかりませんでした。",
  candidatesShown: "{count}件の候補を表示しています。{hidden}として除外しました。",
  candidatesShownSimple: "{count}件の候補を表示しています。",
  modelUnavailable:
    "AI 抽出を実行できませんでした。GitHub Copilot Chat の利用状態を確認してください。",
  requestFailed: "AI 抽出に失敗しました。少し待ってからもう一度お試しください。",

  allMoments: "すべてのモーメント",
  taskInbox: "タスク受信箱",
  openTodayFile: "今日のファイルを開く",
  exportSelected: "選択した項目をエクスポート",
  jumpToDate: "日付へジャンプ",
  backToToday: "今日に戻る",
  todaySuffix: "・今日",
  pinnedHeader: "固定",
  emptyToday: "今日はまだモーメントがありません",
  emptyHint: "アイデアを記録するか、#タグ で分類しましょう",
  capturePlaceholder: "ひらめきをメモ...（#タグで分類）",
  searchPlaceholder: "モーメントを検索...",
  clearSearch: "検索をクリア",
  sendBtn: "送信（Enter）",
  exportAsNote: "ノートとしてエクスポート",
  selectedCount: "{count} 件選択中",
  noMomentsSearchTag: "「{tag}」タグの「{query}」に一致するモーメントはありません",
  noMomentsSearch: "「{query}」に一致するモーメントはありません",
  noMomentsTagged: "最近のフィードに「{tag}」タグのモーメントはありません",
  noMomentsEmpty: "まだモーメントがありません — 最初のひらめきを記録しましょう！",
  edit: "編集",
  save: "保存",
  delete: "削除",
  pin: "固定",
  unpin: "固定解除",
  momentTextEmpty: "モーメントのテキストを入力してください。",
  todayBadge: "今日",

  dashboardTitle: "タスクダッシュボード",
  kpiOpen: "未完了",
  kpiToday: "今日",
  kpiDone: "完了",
  refresh: "更新",
  addTaskPlaceholder: "タスクを追加…（Enter で保存）",
  addBtn: "追加",
  fromMoments: "Moments から抽出",
  fromNotes: "ノートから抽出",
  advanced: "詳細設定",
  aiModelLabel: "AIモデル:",
  autoSelect: "自動選択",
  periodLabel: "期間:",
  searchTasksPlaceholder: "タスクを検索…",
  sectionToday: "今日",
  sectionPlanned: "予定",
  sectionUnsorted: "未分類",
  sectionDone: "完了",
  sectionTodayDesc: "今日と期限超過",
  sectionPlannedDesc: "7日以内と先の予定",
  sectionUnsortedDesc: "inbox や日付なしの棚卸し待ち",
  sectionDoneDesc: "完了済み",
  filterAll: "すべて",
  filterToday: "今日",
  filterPlanned: "予定",
  filterDone: "完了",
  noTasksYet: "まだタスクがありません",
  noTasksYetBody: "Add Task または AI Extract で最初のタスクを作成しましょう。",
  nothingScheduledToday: "今日の予定はありません",
  noPlannedTasks: "予定されたタスクはありません",
  noCompletedTasks: "完了したタスクはありません",
  noItemsInFilter: "このフィルターに項目はありません",
  noMatchingTasks: "一致するタスクはありません",
  filteredItems: "絞り込み結果",
  taskField: "タスク",
  dueField: "期限",
  sourceField: "ソース",
  openFile: "ファイルを開く",
  more: "その他",
  candidate: "候補",
  dismiss: "破棄",
  alreadyExists: "既に存在",
  noCandidatesYet: "まだ候補はありません",
  noCandidatesBody:
    "AI Extract または From Notes で Moments とノートからタスク候補を見つけましょう。",
  aiBadge: "AI",
  taskTextRequired: "タスクのテキストを入力してください。",
  due: "期限",
  noDate: "日付なし",
  dismissError: "エラーを閉じる",

  promptExtractTasks:
    '以下は日常のつぶやき・日記テキストです。実行可能なタスク・アクションアイテムのみを JSON 配列で抽出してください。\n挨拶、感想、感情表現のみの文は無視してください。\n\n各タスクは以下のフィールドを持つオブジェクトにしてください:\n- "text": タスク内容（簡潔に、動詞で始める）\n- "category": "work" | "personal" | "health" | "learning" | "admin" のいずれか\n- "priority": "high" | "medium" | "low" のいずれか\n- "timeEstimateMin": 所要時間の見積もり（分、整数）\n- "dueDate": テキスト中に @YYYY-MM-DD / 📅YYYY-MM-DD / due:YYYY-MM-DD 形式の日付があれば "YYYY-MM-DD" 文字列、なければ null\n\nJSON 配列のみ返してください。説明文は不要です。\n\nテキスト:\n',
  promptEnrichTasks:
    '以下のタスク一覧の各項目について、カテゴリ、優先度、および所要時間（見積もり）を判定してください。\nタスクの元の文字列は「絶対に」変更しないでください。JSON配列の "text" フィールドには、入力されたタスクのテキストをそのまま正確に出力してください。\n\n各タスクについて以下のフィールドを持つオブジェクトのJSON配列として返してください:\n- "text": 入力されたタスクのテキスト（変更せずそのまま）\n- "category": "work" | "personal" | "health" | "learning" | "admin" のいずれか\n- "priority": "high" | "medium" | "low" のいずれか\n- "timeEstimateMin": 所要時間の見積もり（分、整数）\n\nJSON 配列のみ返してください。その他の説明文や markdown 記法（```json など）は不要です。\n\nタスク一覧:\n',
};

export const STRINGS: Record<Locale, Record<string, string>> = { en, ja };

export function getLocaleSetting(): LocaleSetting {
  return vscode.workspace.getConfiguration("notes").get<LocaleSetting>("locale") ?? "auto";
}

export function resolveLocale(): Locale {
  const setting = getLocaleSetting();
  if (setting === "en" || setting === "ja") {
    return setting;
  }

  const vscodeLang = (vscode.env.language || "en").toLowerCase();
  return vscodeLang.startsWith("ja") ? "ja" : "en";
}

export function t(key: string, params?: Record<string, string | number>): string {
  const table = STRINGS[resolveLocale()] ?? STRINGS.en;
  let str = table[key] ?? STRINGS.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      str = str.split(`{${name}}`).join(String(value));
    }
  }
  return str;
}

/**
 * JavaScript helper embedded into webviews: defines I18N tables plus a UI(key)
 * lookup that follows the locale carried in extension messages.
 */
export function buildWebviewI18nScript(): string {
  return `const I18N = ${JSON.stringify(STRINGS)};
let currentLocale = 'en';
function UI(key, params) {
  const table = I18N[currentLocale] || I18N.en;
  let str = table[key] || I18N.en[key] || key;
  if (params) {
    for (const name of Object.keys(params)) {
      str = str.split('{' + name + '}').join(String(params[name]));
    }
  }
  return str;
}`;
}
