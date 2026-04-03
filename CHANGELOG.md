# Change Log

All notable changes to the "notes" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.6.0] - 2026-04-03

### Changed
- **Task Dashboard listboard redesign**: Rebuilt the dashboard into a denser list-first workspace with `All` as the default view, a dedicated top `Candidates` section, compact KPI chips, and a thin analytics strip so the full task landscape is visible immediately.
- **Task Dashboard capture flow**: Moved `Quick Add` and AI extraction into a shared top action bar, tightened saved-task and candidate rows into a denser two-line rhythm, and kept duplicate candidates dismissible while clearly disabling duplicate adds.

### Fixed
- **Task Dashboard empty states**: Added clearer empty-state guidance for `All`, `Attention`, and `Candidate`, preserved legacy `focus` compatibility during the filter transition, and kept zero-value analytics visuals visible instead of collapsing away.

## [0.5.1] - 2026-04-03

### Fixed
- **Extension packaging**: Excluded local `.worktrees/` directories from the published VSIX so marketplace releases no longer ship temporary development worktrees or their extra weight.

## [0.5.0] - 2026-04-03

### Changed
- **Task Dashboard redesign**: Rebuilt the dashboard as a denser command-center workspace with a compact header, KPI strip, unified task/candidate list, and analytics moved into a supporting lower band for faster scanning.
- **AI candidate intake**: Moments and Notes candidates now live directly in the main list with a dedicated `Candidate` filter, shared duplicate handling, and rollback-safe add behavior when saving fails.

## [0.4.13] - 2026-04-02

### Changed
- **Extension packaging**: Trimmed the published VSIX by excluding `.opencode/`, `AGENTS.md`, and source maps from marketplace builds so installs stay cleaner and lighter.

### Fixed
- **Build quality**: Removed the remaining ESLint curly-brace warnings so the extension now packages with a clean lint pass.

## [0.4.12] - 2026-04-02

### Fixed
- **Task Dashboard UI**: Reworked the AI Extract inputs so each `Extract` button now sits on its own row below the date field(s). This avoids the cramped side-by-side layout in the Composer sidebar and keeps clear spacing even in narrow panel widths.

## [0.4.11] - 2026-04-02

### Fixed
- **Task Dashboard UI**: Fixed flexbox spacing issues where "Extract" buttons and calendar inputs touched each other without a margin. Used native `gap` and `flex-shrink: 0` to ensure buttons remain correctly sized without squishing in narrow panels.

## [0.4.10] - 2026-04-02

### Fixed
- **Task Dashboard UI**: Fixed spacing and alignment issues for date input fields and "Extract" buttons in the "From Moments" and "From Notes" sections within the Composer card. The input boxes and buttons no longer touch each other, and layout components behave as expected without flexbox spacing squish issues.

## [0.4.9] - 2026-04-01

### Fixed
- **Task Dashboard UI**: Fixed layout issues in the AI Extracted Tasks results. Titles, metadata, and badges are now stacked vertically, and action buttons cleanly align to the bottom right. Input fields in the "From Notes" section now scale correctly without horizontal squishing or unwanted wrapping.

## [0.4.8] - 2026-04-01

### Changed
- **Task Dashboard UI**: Merged the "Extract from Moments" and "Extract from Notes" cards into the main Composer section. The unified interface is cleaner and makes it easier to add new tasks or pull candidates via AI without jumping between separate cards.

## [0.4.7] - 2026-04-01

### Fixed
- **Task Dashboard layout**: Extracted the Analytics section (Next 7 days & Category balance) out of the right side-column. It now spans horizontally below the top summary metrics to balance the page weight. The layout is significantly cleaner and more structured, preventing all cards from stacking awkwardly in a single column when the main task workspace is short.

## [0.4.6] - 2026-04-01

### Fixed
- **Task Dashboard layout**: Fixed "Next 7 days" card spacing and alignment. The right sidebar width is now correctly constrained, and the graph layout expands naturally without artificial gaps. Unused spacing variables for zero-value tasks in charts were also refined for a cleaner look.

## [0.4.5] - 2026-04-01

### Fixed
- **Task Dashboard card spacing**: Removed duplicate spacing caused by `.card + .card` margin-top conflicting with flex `gap` in `.analytics-grid`. Removed extra `margin-top` inline style from "Notes Intake" card for consistent 16px spacing throughout.
- **Composer card spacing**: Introduced `.composer-body` flex wrapper with uniform `gap: 12px`, eliminating inconsistent spacing from mixed `margin-bottom` and inline `margin-top` styles.
- **Task add bug**: After clicking "Add Task", the textarea is now immediately cleared. The filter automatically switches to `backlog` (date-less tasks) or `all` (dated tasks) so the newly created task is always visible instead of being hidden by the default Attention filter.

## [0.4.4] - 2026-03-30

### Fixed
- **Task Dashboard spacing**: Added `margin-top` to `.analytics-grid` for proper spacing above "Next 7 days" card. Unified `.inline-fields` margin-bottom to 12px for consistent button spacing.

## [0.4.3] - 2026-03-30

### Fixed
- **Task Dashboard spacing**: Added `margin-bottom: 12px` to `.field-compact` and `margin-bottom: 16px` to `.inline-fields` CSS classes to ensure proper spacing between input fields and buttons.

## [0.4.1] - 2026-03-30

### Fixed
- **Task Dashboard spacing**: Increased margin-top for "Extract Tasks" and "Extract from Notes" buttons from 16px to 24px for better visual separation from input fields.

## [0.4.0] - 2026-03-29

### Added
- **Extract from Notes**: New AI feature to extract tasks from regular notes (not just Moments) with date range filtering. The Task Dashboard now includes a "Notes Intake" section alongside "Moments Intake" for extracting actionable items from your note archives.
- Cross-source deduplication: Tasks extracted from notes are automatically checked against existing tasks to prevent duplicates, using the same filtering logic as Moments extraction.

### Changed
- AI Extract functionality now supports both Moments and regular notes as sources, using the same UI patterns and extraction logic for consistency.

## [0.3.1] - 2026-03-29

### Fixed
- **Task Dashboard layout**: Added proper spacing between the "Moments Source Date" field and the "Extract Tasks" button for better visual separation.

## [0.3.0] - 2026-03-28

### Changed
- **Task Dashboard simplification**: Removed the `Plan My Day` workflow and refocused the dashboard on manual task management, workload visibility, and task extraction from Moments.
- **Task dashboard naming**: The main dashboard entry points now use `Task Dashboard` / `Tasks` labels for a simpler mental model in the command palette, status bar, and Moments shortcut.

## [0.2.4] - 2026-03-28

### Changed
- **Upcoming load chart**: The dashboard's weekly analytics card now shows the next 7 days of scheduled task load instead of the previous 7 days, using each task's due date when present so forward planning is more actionable.

## [0.2.3] - 2026-03-27

### Fixed
- **Moments inline due date highlighting**: `@YYYY-MM-DD` mentions in Moments now render with the same inline highlight treatment that was intended for due dates inside the feed cards.

## [0.2.2] - 2026-03-27

### Changed
- **AI Extract de-duplication**: Extracted task candidates now suppress items that already exist in your task files, so older posts do not keep resurfacing as the same suggestion.
- **Candidate snoozing**: AI Extract now lets you hide a suggestion for now, and the dashboard remembers that choice per notes vault for 30 days.

### Fixed
- **Workspace noise**: Removed the tracked `excalidraw.log` file from the repository and added it to `.gitignore`, because it is an external Excalidraw MCP runtime log rather than an extension asset.

## [0.2.1] - 2026-03-27

### Changed
- **Extension icon refresh**: Replaced the previous rounded-square app tile with a transparent layered-notes icon so the marketplace listing reads more like a native extension icon.

## [0.2.0] - 2026-03-27

### Added
- **AI Task Composer**: Create new tasks directly from the dashboard into `tasks/inbox.md` or any `tasks/YYYY-MM-DD.md` file, so task capture is no longer limited to the current day.
- **Dashboard task triage**: Tasks are now grouped into Overdue, Today, Upcoming, Scheduled, Backlog, and Done sections with search and one-tap filters for faster review.
- **Dashboard editing workflow**: Existing tasks can now be edited inline, including text and due date updates, then opened at the source line when deeper editing is needed.

### Changed
- **AI Task Dashboard rebuilt**: The dashboard is now a full task cockpit instead of a passive summary panel, with clearer hierarchy, compact analytics, and dedicated creation / AI assist areas.
- **Plan My Day**: Planning now prioritizes overdue, current, upcoming, and backlog work instead of only tasks tied to today's note.
- **AI Extract**: You can now choose which day's Moments file to analyze and add extracted tasks into the current dashboard save target.

### Fixed
- **Task management bottlenecks**: Resolved the practical blockers where tasks could only be added for the current day, could not be edited from the dashboard, and were hard to scan in larger lists.

## [0.1.21] - 2026-03-27

### Fixed
- **Moments due date highlighting**: `@YYYY-MM-DD` due dates in Moments entries are now displayed with an inline orange pill badge, matching the style of `#tag` highlighting.

## [0.1.17] - 2026-03-26

### Added
- **Due date syntax in Moments**: Write `@2026-03-31` anywhere in a Moments entry (or existing `📅YYYY-MM-DD` / `due:YYYY-MM-DD`) to set a due date. The date is shown as a badge in the AI Task Dashboard and is preserved when adding extracted tasks to `tasks/YYYY-MM-DD.md`.
- AI Extract now returns a `dueDate` field for each task and includes the date in the AI prompt context.

## [0.1.16] - 2026-03-26

### Fixed
- **AI Task Dashboard buttons**: Refresh, Plan My Day, AI Extract, and Add task buttons were silently blocked by Content Security Policy. Replaced all inline `onclick`/`onchange` event handlers with `addEventListener` and event delegation to comply with the webview CSP.

## [0.1.15] - 2026-03-26

### Added
- **AI Task Dashboard** (`Cmd+Shift+T`): New editor panel showing today's tasks, a 7-day weekly overview bar chart, and category breakdown from all your Notes files. Powered by GitHub Copilot — no separate API key required.
- **Plan My Day**: Button inside the dashboard that asks Copilot to generate a time-blocked schedule from today's open tasks.
- **AI Extract**: Button inside the dashboard that scans today's Moments for hidden action items and adds them to `tasks/YYYY-MM-DD.md`.
- **AI status bar item**: Shows `AI Tasks` in the VS Code status bar; updates to a spinner while AI is processing. Click to open the dashboard.
- **Auto-refresh**: Dashboard automatically refreshes whenever a `.md` file changes in your notes directory.
- **MCP task tools**: Five new MCP tools — `get_tasks`, `get_task_stats`, `update_task_status`, `add_task`, `get_reminders` — let AI agents read and mutate your task list over the Model Context Protocol.
- **AI settings**: `notes.ai.autoEnrich` and `notes.ai.autoPlanDay` configuration properties added.
- New commands: `Noteeees: AI - Plan My Day` and `Noteeees: AI - Extract Tasks from Today's Moments`.

### Changed
- **Moments**: Posts are now plain timeline entries (`- HH:MM text`) with no checkboxes. Task management moves entirely to the AI Task Dashboard. Existing `- [ ]` / `- [x]` entries remain readable but are no longer created by the composer.

## [0.1.14] - 2026-03-25

### Changed
- **Moments composer**: The quick-capture input now stays pinned directly below the topbar, so posting feels more like a social feed while the timeline scrolls underneath it.

## [0.1.13] - 2026-03-21

### Changed
- **Moments cards**: Task checkboxes now align with the header metadata instead of sitting in a separate left gutter, which improves scanability in the narrow panel.
- **Moments polish**: The active hashtag filter now appears as a chip beside search, and the time / due / action header treatments are more compact and consistent in the narrow webview.

### Fixed
- **Moments setup edge cases**: Infinite scroll no longer gets stuck, and task toggles now surface a setup error instead of appearing to succeed when the notes directory has not been configured yet.

## [0.1.12] - 2026-03-19

### Fixed
- **Moments feed performance**: Lazy loading no longer reads every older Moments file on each refresh, which keeps the feed responsive on larger histories.

## [0.1.11] - 2026-03-19

### Changed
- **Moments feed**: Older days load automatically as you scroll downward, so the recent feed is no longer capped to a fixed day window.

## [0.1.10] - 2026-03-19

### Changed
- **Moments**: Multiline posts now preserve internal line breaks in the feed, editor, and inbox instead of losing everything after the first line.
- **Moments header**: The All, Open, and Inbox controls now use compact icon buttons so hashtag filters have more room.

### Fixed
- **Moments parsing**: Entry parsing and mutation now treat a post as a block, so editing and deleting multiline entries keeps the full text intact.

## [0.1.9] - 2026-03-18

### Fixed
- **Extension packaging**: The published VSIX now excludes local-only `.github/` and `.superset/` folders, so marketplace packages no longer ship machine-specific tooling metadata.

## [0.1.8] - 2026-03-18

### Changed
- **Moments card actions**: Regular posts now show `Edit`, `Pin`, and `Delete` in a steadier order, and the Pin action stays subtly visible at rest so the header no longer leaves a dead gap on the far right.
- **Pinned Moments**: The active Pin button keeps its accent treatment while sharing the same tighter header rhythm as regular posts.

## [0.1.7] - 2026-03-18

### Changed
- **Moments cards**: Edit, Delete, and Pin controls now sit in the card header beside the time metadata, keeping actions in the top-right while preserving the left checkbox column.
- **Pinned Moments**: Pinned cards follow the same header action placement as regular Moments cards for a more consistent layout.

## [0.1.6] - 2026-03-18

### Fixed
- **Pinned Moments**: Pinned posts now keep the same checkbox column and left alignment as regular Moments entries, so pinning no longer makes checkability disappear or shifts content left.
- **Pinned state sync**: Pinned posts now resolve their latest text, time, and open/done state from the live Moments feed, keeping the pinned section visually consistent with the source entry.

## [0.1.5] - 2026-03-18

### Changed
- **Moments**: Every Moment is now treated as a checkable post, so the feed keeps a consistent left edge and any item can be marked open or done inline.
- **Moments Inbox**: The `Open` view and Inbox now work from post completion state instead of a separate task-only entry type.

### Fixed
- **Moments compatibility**: Legacy `- HH:mm text` lines are still read as unchecked posts, but new writes and edits normalize to checkbox-based lines so the format stays consistent over time.
- **MCP write path**: `add_moment` now writes the unified checkbox-based Moments format instead of reintroducing legacy non-checkbox lines.

## [0.1.4] - 2026-03-14

### Changed
- **Moments**: Pinned entries are now hidden from the regular timeline. They appear only in the Pinned section at the top. Day sections where all entries are pinned are omitted entirely.

## [0.1.3] - 2026-03-14

### Changed
- **Moments**: Each entry is now displayed as a card with a border and rounded corners, matching the input area style. Cards have horizontal margins and gap between them for clearer visual separation.

## [0.1.2] - 2026-03-14

### Fixed
- **Moments**: Pinned entries now show a uniform blue highlight on all 4 sides. Previously `border-left: 2px` caused an L-shaped artifact (left + bottom corner appeared blue; top and right had nothing) and slightly reduced inner content width. Replaced with `box-shadow: inset` which is layout-neutral.

## [0.1.1] - 2026-03-14

### Fixed
- **Moments**: Clicking Send no longer fails to post. A missing `if (editingEntryKey)` guard in the render loop caused a JavaScript ReferenceError on every panel update, preventing entries from appearing after sending.

## [0.1.0] - 2026-03-14

### Added
- **Wiki-style links**: `[[Note Title]]` syntax with click navigation, Cmd+Click definition provider, `[[` autocomplete, and a Backlinks sidebar panel showing all notes that link to the current file (#2)
- **Full-text search in Moments**: Real-time search box in the Moments panel header; works alongside hashtag filters with AND logic (#3)
- **Moments → Note export**: Select mode with per-entry checkboxes; "Export as Note" creates a grouped markdown note and opens it in the editor (#5)
- **Daily Note**: `notes.openDailyNote` command (`Cmd+Shift+D` / `Ctrl+Shift+D`) opens today's note or creates it from a configurable template; supports `{date}`, `{weekday}`, `{time}` tokens (#4)
- **Moments entry pinning**: 📌 pin button per entry; pinned entries appear in a dedicated section at the top of the feed; persisted via extension globalState (#9)
- **Task due dates**: `📅YYYY-MM-DD` or `due:YYYY-MM-DD` syntax in tasks; overdue tasks highlighted in red, today's tasks in orange; new "Overdue" inbox filter (#10)
- **MCP write tools**: `create_note`, `append_to_note`, `add_moment` tools for AI agents to write notes and moments (#1)
- **MCP SQLite index**: Search index persisted in `.noteeees-index.db`; only changed files are re-read on each query (#12)
- **MCP file watcher**: Automatic cache invalidation when `.md` files change in the notes directory (#6)
- **Workspace notes directory**: `notes.workspaceNotesDirectory` setting (resource scope) overrides the global notes directory per workspace (#8)
- **Moments archiving**: `notes.archiveMoments` command moves Moments files older than `notes.momentsArchiveAfterDays` (default 90) to `moments/archive/YYYY-MM/` (#13)

### Changed
- **`momentsPanel.ts` refactored**: Split 1800-line file into `src/moments/types.ts`, `config.ts`, `fileIo.ts`, `taskOverview.ts`, `dueDates.ts`, and `panel.ts`; `momentsPanel.ts` is now a re-export barrel (#7)
- **Timestamp collision prevention**: Note filenames now include seconds (`HH-mm-ss`); a `-2`, `-3`… suffix is appended if a collision still occurs (#14)
- **Inbox filter cycle extended**: "All → Open → Done → Overdue → All"

### Fixed
- Increased unit test coverage for pure functions in `noteCommands.ts`, `moments/fileIo.ts`, `moments/config.ts`, and `moments/dueDates.ts` (#11)

## [0.0.47] - 2026-03-13

### Fixed
- **Moments UI**: Fixed an alignment issue where the task checkbox got pinned to the top instead of remaining vertically centered with the text.

## [0.0.46] - 2026-03-13

### Changed
- **Moments UX**: Unified the Enter-key behavior: Editing a moment now follows your configured "Send on Enter" setting (matching the new message input area).
- **Moments UI**: Removed redundant hints about shortcut keys to clean up vertical space.

## [0.0.45] - 2026-03-13

### Changed
- **Moments UI**: Aligned non-task moments text with tasks for a cleaner feed and replaced inline action text buttons ("Edit", "Delete", "Make Task") with sleek SVG icons corresponding to native VS Code Codicons.

## [0.0.44] - 2026-03-13

### Changed
- **Moments UI**: Redesigned the Moments input area to a modern, unified container, mimicking the GitHub Copilot Chat layout. Features a clean outline focus state, an embedded "Add as task" checkbox, and a send icon button.

## [0.0.43] - 2026-03-13

### Added
- **Walkthrough Guide**: Added a welcoming step-by-step walkthrough to help new users configure settings and start taking notes quickly.
- **Improved Empty States**: Moments panel now displays better empty states and clearer instructional hints.
- **Search and Create Flow**: You can now seamlessly create a new note directly from the Quick Pick search if no matching note exists.
- **Rich Sidebar Tooltips**: Extension sidebar now uses Markdown to preview file paths, tags, recent updates, and excerpts neatly while hovering.

### Improved
- Webview UI Toolkit was integrated into the Moments UI for better native VS Code feeling.
- Various icons across the sidebar (Pinned/Recent/Tags) have been updated to represent content types correctly.
- Action icons correctly display inline and hover correctly for standard Context Menus.

## [0.0.42] - 2026-03-13

### Improved: Moments task card polish and Japanese hashtags

- Task checkboxes in Moments cards are now vertically centered against the full card content for a cleaner scan line.
- Moments, inline note tags, and notes-mcp search now support Japanese hashtags.
- Full-width and compatibility hyphens in hashtags are normalized, so visually similar tag variants resolve to the same tag.

## [0.0.41] - 2026-03-12

### Improved: Moments note-task toggle

- Task entries now expose `Make Note`, so Moments can move both directions between regular notes and tasks without retyping.

## [0.0.40] - 2026-03-11

### Improved: Moments can become tasks later

- Regular Moments now expose a `Make Task` action in the feed, so you can promote an existing thought into an open task without retyping it.

## [0.0.39] - 2026-03-11

### Improved: Moments hashtag feed filters

- Hashtags inside Moments entries are now clickable, so you can jump into a tag-specific recent feed directly from the post body.
- Active hashtag filters are shown in the header and can be cleared without leaving the Moments view.

## [0.0.38] - 2026-03-10

### Fix: Notes directory stays local per machine again

- `Run Setup` now stores the selected notes folder in extension-local machine storage again, instead of relying on the synced settings path as the primary source.
- Older `notes.notesDirectory` values are migrated into local storage and then cleared so Mac and Windows setups stop overriding each other.

### Changed: Moments continuous feed

- The Moments panel no longer uses left-right day navigation and now behaves like a continuous recent feed from today backward.
- The top bar now keeps only feed-level actions, and the editor shortcut opens today's raw Moments file.

## [0.0.37] - 2026-03-10

### Improved: Moments multi-day feed layout

- The Moments panel now shows a stacked multi-day feed instead of a single-day-only timeline, so recent days are easier to scan in one pass.
- Header actions such as `Inbox`, `Open`, and `Today` are now centered for a more balanced layout in narrow sidebar widths.
- Day labels now stay sticky while scrolling, and the feed window can be adjusted with the new `notes.momentsFeedDays` setting.
- Task creation and completion now use simpler checkbox-style controls in both the composer and the feed, reducing the need for separate Task / Mark Done button labels.

### Improved: notes-mcp search strategy and ranking

- `structure_search_notes` now supports `search_strategy` with `auto`, `classic`, and `hybrid_bm25` modes.
- Hybrid ranking now uses BM25-style body scoring while keeping tag, filename, title, and recency signals from the classic strategy.
- notes-mcp now reuses an in-process search index cache so repeated MCP searches avoid re-reading every Markdown file on each request.
- `structure_search_notes` now supports `explain` and `bm25` options for controlling explanation verbosity and BM25 tuning.
- Added notes-mcp dedicated search tests so MCP ranking changes are verified independently from the VS Code extension test suite.
- Root scripts now include `compile:mcp` and `test:mcp`, and the main compile / pretest flow also validates notes-mcp.

## [0.0.36] - 2026-03-09

### Fix: Moments narrow-width header and delete action

- The Moments header now wraps into a tighter two-row layout so the date and actions fit narrow sidebar widths more cleanly.
- Non-today dates are shown as plain dates, without the extra Yesterday label.
- Deleting a Moment entry now uses a host-side confirmation dialog so the action works reliably from the panel.

## [0.0.35] - 2026-03-08

### Improved: Moments feed interactions and editing

- Moments entries now render in a cleaner feed-style layout that makes each post easier to scan.
- You can edit a Moment inline without leaving the panel and save or cancel directly in place.
- You can delete a Moment from the panel with confirmation, and task rows now share a more consistent active-state treatment.

## [0.0.34] - 2026-03-07

### Fix: Moments Task button label no longer reverts to a checkbox-style state

- The input-area Task button now keeps the label fixed as `Task` and no longer switches to `✓ Task`, which also prevents the button width from growing when task mode is enabled.

## [0.0.33] - 2026-03-07

### Improved: Faster note discovery and Moments triage

- Search results now show query-aware excerpts so matching terms are easier to spot before opening a note.
- The sidebar is richer and more actionable, with pinned-note ordering shortcuts, recent-note limits, and tag context that highlights activity and matching note excerpts.
- The Moments Inbox now supports all/open/done filters, inline task toggles, exact line jumps, and remembers the selected filter between launches.

## [0.0.31] - 2026-03-03

## [0.0.32] - 2026-03-06

### Fix: Moments task rows no longer shift on toggle

Task items in the Moments timeline no longer render with a checkbox control. Instead,
the task text itself acts as the toggle target and the done state is shown with subtle
blue text/background treatment only. This keeps the row height and alignment stable
when toggling a task while preserving the underlying Markdown storage format.

## [0.0.31] - 2026-03-03

### Fix: Task toggle (checkmark) had no effect

Root cause: `ensureMomentsFile` creates files with a blank line after the front matter
(`---\n\n`). `readMoments` called `.trim()` on the body, removing that blank line, so
`entry.index = 0` pointed to the first task line. But `toggleTask` computed
`fileLineIdx = bodyStart + 0` which landed on the blank line — not the task line —
so no `[ ]` → `[x]` replacement ever happened.

Fix: remove `.trim()` from body parsing in `readMoments`. Blank lines are already
skipped in the parse loop, so `entry.index` now correctly reflects the raw body
line position, which matches what `toggleTask` computes.

## [0.0.30] - 2026-03-02

### Fix: Task toggle button checkmark

The `□` in "□ Task" button was static HTML (`&#9744;`) and never changed on click.
Only the button color changed (blue `.active` class). Fixed by:
- Removing the static `□` from the HTML
- Updating `textContent` in the click handler: inactive = `Task`, active = `✓ Task`

## [0.0.29] - 2026-03-02

### Fix: Task checkbox SVG rendering

Previous Unicode character approach (`☑`/`☐`) was unreliable because VS Code WebView's
default font does not include these characters (rendered as tofu □). Replaced with inline SVG
drawn via `createElementNS` — completely font-independent:
- Undone: hollow rounded square outline
- Done: filled rounded square with white polyline checkmark

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
