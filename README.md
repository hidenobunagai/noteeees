# <img src="assets/icon.png" width="50" vertical-align="middle" /> Noteeees

[![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hidenobunagai/noteeees)

Simple markdown notes extension. Accumulate individual note files and search them instantly via MCP.

## Features

### Individual Notes
- **New Note** (`Cmd+Shift+N`): Create a new markdown note with configurable filename tokens
- **Templates**: Create and use custom templates with VS Code snippets
- **Subfolder Support**: Use `/` in title to auto-create subfolders (e.g., `projects/MyNote`)
- **List Notes**: Browse all notes sorted by modification date

### Sidebar
- **Notes**: Browse individual note files sorted by modification date

## Usage

1. Run `Noteeees: Run Setup` to configure the storage directory
2. Press `Cmd+Shift+N` to create a new note
3. Browse notes in the Sidebar

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

When `notes.templates` is set, a picker will appear on note creation to choose between the default and custom templates.

## Settings

| Setting | Description |
| --- | --- |
| `notes.notesDirectory` | Directory where notes are stored |
| `notes.defaultNoteTitle` | Filename format (`{dt}_{title}.{ext}`) |
| `notes.noteTitleConvertSpaces` | Character to replace spaces (default: `_`) |
| `notes.defaultSnippet` | Default snippet to insert (`{ langId, name }`) |
| `notes.templates` | Custom template names (maps to `noteeees_template_{name}` snippets) |

## Supercharge with MCP

Turn Noteeees into an external memory for your AI agents (like GitHub Copilot, Claude Desktop, Cursor, etc.) by using the **Model Context Protocol (MCP)**.

This repository includes `notes-mcp/`, an MCP server that exposes your notes to AI agents.

### Setup

1. Build the MCP server:
   ```bash
   cd notes-mcp && bun install && bun run build
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
| `structure_search_notes` | Score-ranked search with tunable weights, recency bonus, and synonym expansion |
| `get_note_content` | Get the full content of a specific note by filename |

### What You Can Do

- **Context Awareness**: "Search my notes for anything about last week's deployment."
- **Tag-based Retrieval**: "Show me all notes tagged #todo."
- **Date-based Lookup**: "Show me notes from January."
- **Smart Search**: Use `structure_search_notes` to get scored results with reasons, synonym expansion (e.g. 経費→精算), and tunable weights.
- **Full Content Access**: Use `get_note_content` to read a specific note in full.

### Tags

Notes support tags in two ways:
- **YAML front matter**: `tags: [todo, meeting]`
- **Inline**: `#todo` anywhere in the note body

