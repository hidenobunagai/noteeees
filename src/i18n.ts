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
  invalidNotePath: "Invalid note path: subfolder must stay inside the notes directory.",
  cancelBtn: "Cancel",
  noMomentsToArchive: "No Moments files to archive ({skipped} recent files kept).",
  archivedMoments: "Archived {count} Moments files ({skipped} recent files kept).",
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

  // --- Moments webview ---
  allMoments: "All moments",
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
  clearTagFilter: "Clear tag filter",
  sendBtn: "Send (Enter)",
  exportAsNote: "Export as Note",
  selectedCount: "{count} selected",
  selectEntryLabel: "Select entry for export",
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
  momentEditInvalid: "Invalid Moment edit parameters.",
  momentSaveFailed: "Could not save that Moment entry.",
  momentDeleteFailed: "Could not delete that Moment entry.",
  momentDeleteConfirm: "Delete this Moment entry?",
  momentDeleteBtn: "Delete",
  momentsExported: "Exported {count} moment(s) to {name}",
  momentCount: "{count} moment(s)",
  todayBadge: "Today",

  // --- Sidebar ---
  sidebarPinned: "Pinned",
  sidebarRecent: "Recent",
  sidebarTags: "Tags",
  tagNoteCount: "{count} note(s)",
  tagLatest: "Latest: {title}",
  tagUpdated: "Updated {date}",
  openNoteBtn: "Open Note",

  // --- Wiki links / backlinks ---
  openTooltip: "Open: {name}",
  backlinkCount: "{count} link(s)",
  backlinkLine: "Line {line}: {text}",
  openBtn: "Open",
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
  invalidNotePath:
    "無効なノートパスです。サブフォルダはノートディレクトリ内に収める必要があります。",
  cancelBtn: "キャンセル",
  noMomentsToArchive:
    "アーカイブ対象の Moments ファイルはありません（{skipped} 件の新しいファイルを保持）。",
  archivedMoments:
    "{count} 件の Moments ファイルをアーカイブしました（{skipped} 件の新しいファイルを保持）。",
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

  allMoments: "すべてのモーメント",
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
  clearTagFilter: "タグフィルタを解除",
  sendBtn: "送信（Enter）",
  exportAsNote: "ノートとしてエクスポート",
  selectedCount: "{count} 件選択中",
  selectEntryLabel: "エクスポートする項目を選択",
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
  momentEditInvalid: "モーメントの編集パラメータが不正です。",
  momentSaveFailed: "そのモーメントを保存できませんでした。",
  momentDeleteFailed: "そのモーメントを削除できませんでした。",
  momentDeleteConfirm: "このモーメントを削除しますか？",
  momentDeleteBtn: "削除",
  momentsExported: "{count} 件のモーメントを {name} にエクスポートしました。",
  momentCount: "{count} 件のモーメント",
  todayBadge: "今日",

  // --- Sidebar ---
  sidebarPinned: "固定",
  sidebarRecent: "最近",
  sidebarTags: "タグ",
  tagNoteCount: "{count} 件のノート",
  tagLatest: "最新: {title}",
  tagUpdated: "更新: {date}",
  openNoteBtn: "ノートを開く",

  // --- Wiki links / backlinks ---
  openTooltip: "開く: {name}",
  backlinkCount: "{count} 件のリンク",
  backlinkLine: "{line} 行目: {text}",
  openBtn: "開く",
};

export const STRINGS: Record<Locale, Record<keyof typeof en, string>> = { en, ja };

export type I18nKey = keyof typeof en;

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

/** BCP 47 tag for `Date#toLocale*`, so dates follow the resolved locale too. */
export function localeTag(locale: Locale = resolveLocale()): string {
  return locale === "ja" ? "ja-JP" : "en-US";
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
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
