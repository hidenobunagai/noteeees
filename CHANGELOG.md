# Change Log

All notable changes to the "notes" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- No unreleased changes.

## [0.0.20] - 2026-03-18

- Memory posts: make every memory entry checkable from the sidebar.
- Memory format: persist checked state in entry headers with `[ ]` / `[x]` while keeping older entries compatible.
- Sidebar/search/reminders: use the shared memory-entry parser so checked and unchecked posts render consistently.

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
