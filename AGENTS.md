# AGENTS.md - Noteeees Development Guide

## Release Process

### Pre-release Checklist
- [ ] All tests passing (`bun run test`)
- [ ] TypeScript compiles without errors (`bun run check-types`)
- [ ] CHANGELOG.md updated with new version
- [ ] Version bumped in package.json

### Publishing Steps

1. **Update version and changelog**
   ```bash
   # Edit package.json - bump version
   # Edit CHANGELOG.md - move Unreleased to new version section
   ```

2. **Build and test**
   ```bash
   bun run compile
   ```

3. **Commit version bump**
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): bump version to X.Y.Z"
   ```

4. **Create git tag**
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z - Brief description"
   git push origin main --tags
   ```

5. **Publish to VS Code Marketplace**
   ```bash
   vsce publish
   ```
   - Requires: `vsce` CLI installed
   - Authentication: Azure DevOps Personal Access Token configured

6. **Publish to Open VSX Registry**
   ```bash
   npx ovsx publish
   ```
   - Requires: `OVSX_PAT` environment variable set
   - Get token from: https://open-vsx.org/user-settings/tokens

### Post-release
- [ ] Verify both marketplaces show new version
- [ ] Test installation from marketplace

## Development Notes

### Project Structure
- `src/` - VS Code extension source
- `shared/` - Modules shared by extension features (task syntax, note collection, path safety)
- `webview/` - Real webview scripts/styles inlined into `src/webview/generated.ts` by `scripts/embed-webview.mjs`
- `dist/` - Compiled extension (generated)
- `CHANGELOG.md` - Release history and Unreleased section

### Testing
```bash
# Extension tests
bun run test
```

### Build Commands
```bash
bun run compile        # Full build with type check
bun run package        # Production build for publishing
bun run watch          # Development build with watcher
```

## Project-Specific Conventions

### Commit Message Format
- `feat: ` - New features
- `fix: ` - Bug fixes
- `refactor: ` - Code refactoring
- `test: ` - Adding or updating tests
- `docs: ` - Documentation updates
- `chore: ` - Maintenance tasks
- `chore(release): ` - Version bumps

### Branch Strategy
- `main` - Production-ready code
- Feature branches for development
- All changes via PR or direct commit to main for small fixes

### VS Code Extension Specifics
- Extension ID: `HidenobuNagai.noteeees`
- Display Name: Noteeees
- Publisher: HidenobuNagai
- Icon: `assets/icon.png`

<!-- headroom:memory-instructions -->
## Memory

Use the `headroom_memory` MCP server for persistent cross-session knowledge.

**Before** answering questions about prior decisions, conventions, project context,
architecture, user preferences, org info, codenames, debugging history, or anything
from past sessions — call `memory_search` first.

**After** making durable decisions, discovering conventions, or learning important
facts — call `memory_save` to persist them for future sessions.

Memory is your first source of truth for anything not visible in the current conversation.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
