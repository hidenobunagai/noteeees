# Change Log

All notable changes to the "notes" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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