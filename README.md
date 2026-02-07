# <img src="assets/icon.png" width="50" vertical-align="middle" /> Noteeees

[![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hidenobunagai/noteeees)

Simple single-file Markdown notes extension with tags, search, and reminders.

## Features

- **Quick Add** (`Cmd+Shift+N`): Quickly add a one-line note
- **Add Entry** (`Cmd+Shift+M`): Add a note entry with a snippet
- **Tag Autocomplete**: Suggests previously used tags
- **Search**: Filter by tags and dates
- **Structure Search** (`Cmd+Shift+G`): Rank entries by query relevance (tags/date/month/keywords)
- **Sidebar**: View entries grouped by tags
- **Structure Sidebar**: Navigate notes by month and tag (`YYYY-MM -> #tag -> entries`) like a lightweight TOC
- **Reminders**: Set due dates with `@YYYY-MM-DD`

## Usage

1. Run `Notes: Run Setup` to configure the storage directory
2. Press `Cmd+Shift+N` to add a note
3. Check entries grouped by tags in the Sidebar

## Settings

| Setting | Description |
|-----|------|
| `notes.notesDirectory` | Directory where notes are stored |
| `notes.dateFormat` | Date format |
| `notes.entryPosition` | Insertion position for new entries (top/bottom) |
| `notes.structureSearchMaxResults` | Maximum Structure Search results (10-200) |

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
