# <img src="assets/icon.png" width="50" vertical-align="middle" /> Noteeees

[![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hidenobunagai/noteeees)

Simple markdown notes extension with two-tier note management: individual notes with templates and a unified memory log.

## Features

### Individual Notes
- **New Note** (`Cmd+Alt+N`): Create a new markdown note with configurable filename tokens
- **Templates**: Create and use custom templates with variable substitution (`{{title}}`, `{{date}}`, `{{datetime}}`)
- **Subfolder Support**: Use `/` in title to auto-create subfolders (e.g., `projects/MyNote`)
- **List Notes**: Browse all notes sorted by modification date

### Memory Log
- **Quick Add** (`Cmd+Shift+N`): Quickly add a one-line note to `memory.md`
- **Add Entry** (`Cmd+Shift+M`): Add a note entry with a snippet
- **Tag Autocomplete**: Suggests previously used tags
- **Search**: Filter by tags and dates
- **Structure Search** (`Cmd+Shift+G`): Rank entries by query relevance (tags/date/month/keywords)
- **Reminders**: Set due dates with `@YYYY-MM-DD`

### Sidebar
- **Notes**: Browse individual note files
- **Tags**: View memory entries grouped by tags
- **Structure**: Navigate notes by month and tag (`YYYY-MM → #tag → entries`)

## Usage

1. Run `Noteeees: Run Setup` to configure the storage directory
2. Press `Cmd+Alt+N` to create a new individual note
3. Press `Cmd+Shift+N` to quickly add to memory log
4. Check entries and notes in the Sidebar

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
| `notes.dateFormat` | Date format for memory entries |
| `notes.entryPosition` | Insertion position for new memory entries (top/bottom) |
| `notes.structureSearchMaxResults` | Maximum Structure Search results (10-200) |
| `notes.structureSearchSynonyms` | Synonym rules (`key:syn1,syn2`) |

## Supercharge with MCP

Turn Noteeees into an external memory for your AI agents (like GitHub Copilot, Claude Desktop, Cursor, etc.) by using the **Model Context Protocol (MCP)**.

This repository includes `notes-mcp/`, an MCP server that exposes your notes to AI agents.

### Setup

1. Build the MCP server:
   ```bash
   cd notes-mcp && bun install && bun run build
   ```

2. Add to your MCP configuration:

**Example (GitHub Copilot `.vscode/mcp.json`)**:

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

### What You Can Do

- **Context Awareness**: "Read my `memory.md` and summarize what I did last week."
- **Auto-Journaling**: "Save the summary of this conversation to my `memory.md`."
- **Structure-aware Retrieval**: Use `structure_search_notes` to get scored results with reasons, synonym expansion, and tunable weights.
