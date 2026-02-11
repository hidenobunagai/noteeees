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

Create templates with `Noteeees: Create Template`. Templates are stored in `.noteeees/templates/` and support these variables:

| Variable | Replaced with |
|---|---|
| `{{title}}` | Note title |
| `{{date}}` | Current date (YYYY-MM-DD) |
| `{{datetime}}` | Current date and time (YYYY-MM-DD HH:mm) |

Example template:
```markdown
---
tags:
  - meeting
title: "{{title}}"
date: "{{date}}"
---

# {{title}}

## Attendees

## Agenda

## Notes

## Action Items
```

## Settings

| Setting | Description |
|-----|------|
| `notes.notesDirectory` | Directory where notes are stored |
| `notes.defaultNoteTitle` | Filename format (`{dt}_{title}.{ext}`) |
| `notes.noteTitleConvertSpaces` | Character to replace spaces (default: `_`) |
| `notes.defaultTemplate` | Default template name (empty = show picker) |
| `notes.dateFormat` | Date format for memory entries |
| `notes.entryPosition` | Insertion position for new memory entries (top/bottom) |
| `notes.structureSearchMaxResults` | Maximum Structure Search results (10-200) |
| `notes.structureSearchWeightTagExact` | Weight for exact tag match |
| `notes.structureSearchWeightDate` | Weight for date match |
| `notes.structureSearchWeightMonth` | Weight for month match |
| `notes.structureSearchWeightTagPartial` | Weight for partial tag match |
| `notes.structureSearchWeightContent` | Weight for content keyword match |
| `notes.structureSearchBonusMultiToken` | Bonus when multiple tokens match |
| `notes.structureSearchBonusAllTokens` | Bonus when all tokens match |
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
