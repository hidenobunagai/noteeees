# <img src="assets/icon.png" width="50" vertical-align="middle" /> Noteeees

[![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)](https://github.com/hidenobunagai/noteeees)

Simple single-file Markdown notes extension with tags, search, and reminders.

## Features

- **Quick Add** (`Cmd+Shift+N`): Quickly add a one-line note
- **Add Entry** (`Cmd+Shift+M`): Add a note entry with a snippet
- **Tag Autocomplete**: Suggests previously used tags
- **Search**: Filter by tags and dates
- **Sidebar**: View entries grouped by tags
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

## Supercharge with MCP

Turn Noteeees into an external memory for your AI agents (like Claude Desktop, Cursor, etc.) by using the **Model Context Protocol (MCP)**.

Since Noteeees manages everything in a single `memory.md` file, you can easily expose it to AI agents using the [Filesystem MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem).

### Setup

1. Install the `@modelcontextprotocol/server-filesystem`.
2. Add your notes directory to the server configuration.

**Example (`claude_desktop_config.json`)**:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/your/notes/directory"
      ]
    }
  }
}
```

### What You Can Do

- **Context Awareness**: "Read my `memory.md` and summarize what I did last week."
- **Auto-Journaling**: "Save the summary of this conversation to my `memory.md`."
