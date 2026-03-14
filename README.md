# <img src="assets/icon.png" width="50" vertical-align="middle" /> Noteeees

[![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hidenobunagai/noteeees)

Simple markdown notes extension. Accumulate individual note files and search them instantly via MCP.

## Features

### Moments
A quick-capture timeline panel for fleeting thoughts, tasks, and ideas — always one keypress away.

- **`Cmd+Shift+M`**: Open the Moments panel from the Activity Bar (⚡ lightning icon)
- **Timeline view**: Entries displayed as a continuous recent feed with timestamps, task status, and quick actions
- **Quick input**: Type a thought, press `Enter` to save instantly
- **Task checkboxes**: Use the input checkbox to add the next item as a task, then tick tasks directly in the feed to mark them done or open
- **Task type toggle**: Switch a Moment between note and task later with `Make Task` and `Make Note`
- **Inline editing**: Edit a Moment in place and save without leaving the panel
- **Safe deletion**: Delete a Moment from the panel with a confirmation step
- **Open-task filter**: Toggle `Open` to focus only on unfinished tasks across the recent feed
- **Inbox overview**: Open `Inbox` to browse all Moments tasks, switch between all/open/done views, remember that filter between launches, toggle done or undone inline, or jump to the exact line
- **Sticky date markers**: Each day label stays visible while you scroll through the feed
- **Hashtag feed filters**: Click a `#tag` in Moments to filter the current feed to that hashtag, then clear it from the header
- **Open in editor**: `↗` opens today's raw Markdown file for editing

#### Storage format

Each day creates a plain Markdown file at `{NotesDirectory}/moments/YYYY-MM-DD.md`:

```markdown
---
type: moments
date: 2026-03-01
---

- 09:15 Great idea for the API design #idea
- [ ] 10:30 Follow up with the team #todo
- [x] 11:00 Completed task
- 14:22 Interesting article https://example.com
```

Moments are excluded from the regular Notes sidebar but are **fully searchable via MCP** since they're plain `.md` files.

### Individual Notes
- **New Note** (`Cmd+Shift+N`): Create a new markdown note with configurable filename tokens
- **Templates**: Create and use custom templates with VS Code snippets
- **Subfolder Support**: Use `/` in title to auto-create subfolders (e.g., `projects/MyNote`)
- **Search Notes**: Search notes by title, path, or tag from the command palette
- **Preview-rich search**: Search results include timestamps, tags, and query-aware content excerpts so matches are easier to scan

### Sidebar
- **Pinned**: Pin frequently used notes from the sidebar context menu
- **Pinned ordering**: Move pinned notes up or down from the sidebar context menu or with `Cmd+Opt+↑ / ↓`
- **Recent**: Browse your latest notes with a configurable item limit
- **Tags**: Open notes grouped by tag, with usage counts and latest-note context in the sidebar, scan tag-aware excerpts inside each tag group, toggle sort order, search tags directly, and preview likely matches before opening a note

## Usage

1. Run `Noteeees: Run Setup` to configure the storage directory
2. Press `Cmd+Shift+N` to create a new note
3. Browse notes in the Sidebar

The notes directory selected by `Run Setup` is stored in extension-local machine storage, so you only need to choose it once per machine and it does not bounce across your devices through synced settings.

## Templates

Templates use **VS Code snippets**. When you create a new note, the configured snippet is automatically inserted.

### Setup

1. Open Command Palette → `Preferences: Configure Snippets` → `markdown.json`
2. Add your snippets with the `noteeees_template_` prefix:

```json
{
  "noteeees_template_default": {
    "prefix": "noteeees_default",
    "body": [
      "# ${1:${TM_FILENAME_BASE}}",
      "",
      "$0"
    ],
    "description": "Default note template"
  },
  "noteeees_template_meeting": {
    "prefix": "noteeees_meeting",
    "body": [
      "---",
      "tags:",
      "  - meeting",
      "date: \"${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}\"",
      "---",
      "",
      "# ${1:Meeting Title}",
      "",
      "## Attendees",
      "",
      "- $2",
      "",
      "## Agenda",
      "",
      "- $3",
      "",
      "## Notes",
      "",
      "$0"
    ],
    "description": "Meeting note template"
  }
}
```

3. (Optional) Register custom templates in settings:

```json
{
  "notes.templates": ["meeting"]
}
```

When `notes.templates` is set, a picker will appear on note creation to choose between the default, empty note, and custom templates. If no custom templates are configured, Noteeees creates the note immediately with the default snippet.

## Settings

| Setting | Description |
| --- | --- |
| `notes.notesDirectory` | Directory where notes are stored |
| `notes.defaultNoteTitle` | Filename format (`{dt}_{title}.{ext}`) |
| `notes.noteTitleConvertSpaces` | Character to replace spaces (default: `_`) |
| `notes.defaultSnippet` | Default snippet to insert (`{ langId, name }`) |
| `notes.templates` | Custom template names (maps to `noteeees_template_{name}` snippets) |
| `notes.sidebarRecentLimit` | Number of notes shown in the sidebar Recent section (`0` = all) |
| `notes.sidebarTagSort` | Sort mode for the sidebar Tags section (`frequency` or `alphabetical`) |
| `notes.momentsInboxFilter` | Default filter for the Moments Inbox (`all`, `open`, or `done`) |
| `notes.momentsFeedDays` | Number of days shown in the stacked Moments feed (`1`-`30`) |

## Supercharge with MCP

Turn Noteeees into an external memory for your AI agents (like GitHub Copilot, Claude Desktop, Cursor, etc.) by using the **Model Context Protocol (MCP)**.

This repository includes `notes-mcp/`, an MCP server that exposes your notes to AI agents.

### Setup

1. Build the MCP server:
   ```bash
   cd notes-mcp && bun install && bun run build
   ```

For repository-level validation from the root, you can also run:

```bash
bun run compile:mcp
bun run test:mcp
```

2. Add to your MCP configuration:

**Example (GitHub Copilot `mcp.json`)**:

```json
{
  "servers": {
    "notes-mcp": {
      "type": "stdio",
      "command": "bun",
      "args": ["/path/to/noteeees/notes-mcp/dist/index.js"],
      "env": {
        "NOTES_DIRECTORY": "/path/to/your/notes/directory"
      }
    }
  }
}
```

### Available Tools

| Tool | Description |
| --- | --- |
| `search_notes` | Search across all notes by keyword, tag, or filename. Returns snippet around each match. |
| `get_recent_notes` | Get most recently modified notes (metadata only) |
| `get_notes_by_tag` | Get all notes with a specific tag |
| `get_notes_by_date` | Filter notes by date range (`from`/`to` YYYY-MM-DD) using filename date or mtime |
| `list_notes` | Lightweight metadata-only listing of all notes (filename, title, tags, createdAt, mtime) |
| `list_tags` | List all unique tags with usage counts sorted by frequency |
| `structure_search_notes` | Score-ranked search with `auto` / `classic` / `hybrid_bm25` strategies, tunable weights, BM25 body ranking, recency bonus, synonym expansion, and optional explanations |
| `get_note_content` | Get the full content of a specific note by filename |
| `create_note` | **Write** — Create a new note with title, content, tags, and optional subfolder |
| `append_to_note` | **Write** — Append markdown content to the end of an existing note |
| `add_moment` | **Write** — Add an entry to today's (or a specified date's) Moments timeline |

### What You Can Do

- **Context Awareness**: "Search my notes for anything about last week's deployment."
- **Tag-based Retrieval**: "Show me all notes tagged #todo."
- **Date-based Lookup**: "Show me notes from January."
- **Smart Search**: Use `structure_search_notes` to get scored results with reasons, synonym expansion (e.g. 経費→精算), tunable weights, and `search_strategy` set to `auto`, `classic`, or `hybrid_bm25`.
- **Full Content Access**: Use `get_note_content` to read a specific note in full.

`structure_search_notes` defaults to `search_strategy: "auto"`. In `auto`, smaller or tag-heavy searches stay on the legacy classic ranking, while broader free-text searches on larger corpora switch to `hybrid_bm25` for stronger body relevance. Set `explain: false` to keep the same response shape while omitting verbose ranking reasons.

### Tags

Notes support tags in two ways:
- **YAML front matter**: `tags: [todo, meeting]`
- **Inline**: `#todo` anywhere in the note body

