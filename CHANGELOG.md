# Change Log

All notable changes to the "notes" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.28] - 2026-03-02

### Fix: Task checkbox and folder sync

- **Task checkbox**: Replaced CSS pseudo-element/color approach with Unicode characters
  (`☐` = undone, `☑` = done). Completely CSS-independent, works reliably in any VS Code theme.
- **Notes directory no longer syncs**: Folder selected via "Run Setup" is now stored in
  `context.globalState` (VS Code extension storage, 100% machine-local, never touched by
  Settings Sync). Previously used VS Code configuration which could sync between machines.
  Old config values are automatically migrated on first use.

## [0.0.27] - 2026-03-02

### Fix: Moments task checkbox checkmark not appearing

Replaced CSS `::after` pseudo-element approach (unreliable in VS Code WebView) with
JS-injected `✓` text inside a `.checked` class span. The checkmark now appears correctly
when a task is marked done.

## [0.0.26] - 2026-03-01

### Fix: Moments panel bug fixes

- **Checkbox**: Task checkboxes in the timeline now display correctly and toggle properly. Replaced native `<input>` custom styling (which doesn't support `::after` in WebView) with `<label>` + hidden `<input>` + `<span>` pattern.
- **Japanese IME**: Pressing Enter to confirm CJK input (IME composition) no longer accidentally submits the Moment. Uses `compositionstart`/`compositionend` events to guard the send handler.
- **Layout**: Input area redesigned to vertical stack — textarea full-width on top, Task toggle + Send button in a row below. Looks correct at any sidebar width.

## [0.0.25] - 2026-03-01

### New feature: Moments

A quick-capture timeline panel inspired by stream-of-consciousness note-taking tools.
- **Activity Bar entry**: A dedicated lightning-bolt icon opens the Moments panel from any context.
- **Timeline view**: Timestamped entries displayed in chronological order (chat-style, newest at bottom).
- **Quick input**: Type a thought and press Enter (or Cmd+Enter) to save instantly.
- **Task support**: Toggle task mode to prefix entries with `[ ]`; click checkboxes in the timeline to mark as done.
- **Date navigation**: Browse previous/next days with `◀ ▶` buttons or jump back to Today.
- **Tag highlighting**: `#tag` tokens are rendered as color badges.
- **Open in editor**: `↗` button opens the raw daily Markdown file for editing.
- **Storage**: One file per day at `{NOTES_DIRECTORY}/moments/YYYY-MM-DD.md` (plain Markdown list).
- **MCP-friendly**: Moments files are plain `.md` — the existing `search_notes` / `structure_search_notes` tools already find them.
- **Configurable**: `notes.momentsSubfolder` and `notes.momentsSendOnEnter` settings added.
- **Keybinding**: `Cmd+Shift+M` / `Ctrl+Shift+M` focuses the Moments panel.
- Moments subfolder is excluded from the regular Notes sidebar and `listNotes` quick-pick.

## [0.0.24] - 2026-03-01

### MCP server improvements (notes-mcp v3.0.0)

- **Fix**: Tag extraction now merges front matter tags AND inline `#tags` (previously mutually exclusive).
- **New**: `createdAt` field extracted from filename pattern `YYYY-MM-DD_HH-mm_title.md`; added to all note metadata.
- **New**: Match `snippet` (~200 chars around first match) included in `search_notes`, `get_notes_by_tag`, and `structure_search_notes` results — no need to call `get_note_content` just to see context.
- **New tool**: `get_notes_by_date` — filter notes by date range using `from`/`to` (YYYY-MM-DD).
- **New tool**: `list_notes` — lightweight metadata-only listing (filename, title, tags, createdAt, mtime); ideal for getting an overview.
- **Improved**: `list_tags` now returns tag usage counts sorted by frequency.
- **Improved**: `structure_search_notes` now supports `synonyms` parameter for custom synonym rules (in addition to built-in Japanese synonyms: 経費, 会議, タスク, etc.).
- **Improved**: Content scoring is frequency-aware (occurrence count, capped at 4×) instead of binary.

## [0.0.23] - 2026-02-28

- Update README: remove memory feature references, add MCP tools table and tag documentation.

## [0.0.22] - 2026-02-28

- Remove memory feature (memory.md single-file accumulation) entirely.
- Simplify sidebar to individual note file list only (Tags/Structure views removed).
- Update MCP server to scan all .md files in the notes directory for search (no longer depends on memory.md). Added `get_note_content` tool.

## [0.0.19] - 2026-02-11

- Fix: Snippet name prefix mismatch (notes_ → noteeees_) causing template insertion to silently fail.
- Always show template picker (Default / Empty / custom) when creating new notes.
- Update default bundled snippet template with frontmatter (tags/title/date).

## [0.0.18] - 2026-02-11

- Fix: Snippet template not inserted when creating new notes (added contributes.snippets and fallback mechanism).

## [0.0.17] - 2026-02-11

- Sidebar: Strip date prefix from note filenames for better readability (date shown in description).
- Sidebar: Add search icon to Structure Search button in view header.

## [0.0.12] - 2026-02-01

- Renamed UI elements to "Noteeees" for consistency.

## [Unreleased]

- Initial release