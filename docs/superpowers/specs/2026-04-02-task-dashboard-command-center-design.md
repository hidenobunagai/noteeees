# Task Dashboard Command Center Redesign

**Date:** 2026-04-02  
**Status:** Approved  
**Scope:** `src/dashboardPanel.ts`, `src/dashboardExtractLayout.ts`, related dashboard tests

---

## Problem Statement

The current Task Dashboard has improved incrementally, but it still feels like several separate surfaces placed next to each other rather than one strong task workstation.

Current issues:

- The screen does not clearly prioritize bulk task triage.
- AI extraction results live in separate result cards, so reviewing candidates and managing real tasks happens in two different places.
- The layout weight is spread too evenly across hero, analytics, list, and composer, which weakens hierarchy.
- The visual language is still plain and card-heavy instead of feeling like a precise, dense operational console.
- Analytics are useful, but they currently compete too much with the main job of processing tasks.

---

## User-Approved Direction

- Personality: `Precise & dense`
- Primary jobs:
  - Bulk task organization
  - Better AI extraction workflow
- Change strength: `Strong` (full layout rework is acceptable)
- Chosen layout direction: `Command Center`
- Chosen list density: `Dense with meta lane`
- AI extracted candidates: `Mixed into the main list`
- Analytics: `Supportive, not primary`

---

## Design Decisions

### Direction

The dashboard becomes a task command center.

The main list is the primary surface. The right rail supports capture and extraction. Analytics remain available, but they move into a low-profile strip below the main work area.

### Layout

**Compact header + KPI strip -> main workspace + support rail -> analytics strip**

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Header: title / compact context / refresh                           │
├───────────────────────────────────────┬───────────┬───────────┬──────┤
│ Main task focus                       │ Open      │ Attention │ Done │
├───────────────────────────────────────┴───────────┴───────────┴──────┤
│ Toolbar: filters / counts / search / sort                           │
├───────────────────────────────────────────────┬──────────────────────┤
│ Main list                                     │ Quick Add            │
│ saved tasks + AI candidates                   │ AI Intake Controls   │
│ dense two-line rows / inline edit             │ status / errors      │
├───────────────────────────────────────────────┴──────────────────────┤
│ Analytics strip: Next 7 days / Category balance                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Visual Personality

The look should feel like a serious work surface, not a marketing card layout.

- Neutral dark/light theme-compatible surfaces using VS Code variables
- One main accent color for interaction and focus: `--vscode-textLink-foreground`
- Semantic colors remain limited to status meanings such as success, warning, and error
- No large gradients, no glow, no decorative hero styling
- Borders and surface contrast create hierarchy instead of heavy shadows
- Radius system is fixed to a narrow range (`10px` to `12px`)
- Data values use `tabular-nums`

### Typography Policy

- Use the existing VS Code font stack
- Keep headings compact and utility-oriented
- Use uppercase micro-labels sparingly for KPI and section metadata
- Prioritize readability over display styling
- Remove the large explanatory hero copy block from the current layout

### Header And KPI Strip

The top of the screen becomes compact and operational.

- Header contains the title, current date context, and refresh action
- KPI strip remains visible above the main work area
- KPI cards are compact, not decorative
- Recommended KPI set:
  - `Open`
  - `Attention`
  - `Completion %`
- `Completion %` is the existing completion rate metric: `totalDone / (totalOpen + totalDone) * 100`, rounded to an integer
- KPI cards should support quick scanning rather than deep explanation

### Main Workspace

The main workspace is the center of gravity of the dashboard.

- The toolbar sits directly above the list
- The list receives the most horizontal and vertical space on desktop
- The list keeps sectioned grouping for saved tasks:
  - `Overdue`
  - `Today`
  - `Upcoming`
  - `Scheduled`
  - `Backlog`
  - `Done`
- A new top-level pseudo-section `Candidates` is added when AI candidate rows exist

### Task Row Design

Each row uses a dense two-line layout.

Line 1:

- Checkbox
- Task title
- Primary state/action area on the right

Line 2:

- Meta lane with compact badges and source details
- Tags
- Date / due date
- Source file or source note
- Candidate state when relevant

This preserves high density while keeping the contextual information visible.

### Saved Task Actions

Saved task rows keep the current operational actions, with no workflow expansion.

- `Done`
- `Edit`
- `Open file`
- `Delete`

Inline edit continues to happen inside the list row rather than opening a separate details panel.

### Candidate Task Model

AI extraction candidates are not rendered as separate cards in the right rail anymore.

Instead:

- Candidates are rendered as virtual rows inside the main list
- Candidate rows visually match saved task rows, but are distinguishable with a `Candidate` badge and lighter emphasis
- Candidate rows use the same two-line structure as saved tasks
- Candidate row primary actions are:
  - `Add`
  - `Dismiss`
- After `Add` succeeds while the `Candidate` filter is active, the dashboard stays on `Candidate`; the added candidate row disappears immediately and the newly saved task is not forced into view
- The newly saved task appears later through normal dashboard refresh and the saved-task filters that already exist

This keeps all task review activity in one place.

### Candidate Filters And Routing

The filter row becomes:

- `Attention`
- `All`
- `Candidate`
- `Overdue`
- `Today`
- `Upcoming`
- `Scheduled`
- `Backlog`
- `Done`

Rules:

- `Attention` only targets saved tasks in `overdue`, `today`, and `upcoming`
- `All` includes saved tasks and candidate rows
- `Candidate` shows only candidate rows
- Candidate rows do not appear inside `Overdue`, `Today`, `Upcoming`, `Scheduled`, `Backlog`, or `Done` filters even if their metadata would match
- After a successful extraction, the dashboard automatically switches to the `Candidate` filter
- When `All` is active, candidate rows appear above saved-task sections
- When `All` is active, candidate rows render inside a labeled `Candidates` section above all saved-task sections
- When `Candidate` is active, the list still renders with the same `Candidates` section header rather than switching to an unsectioned flat list

### Candidate Duplicate Handling

Current extraction filtering drops candidates that already exist as saved tasks. That behavior changes.

New rule:

- Existing-task duplicates should remain visible as disabled candidate rows with an `Already exists` state
- `Add` is disabled for those rows
- `Dismiss` remains available
- Internal duplicate candidates should still be collapsed
- Previously dismissed candidates should still remain hidden via the existing dismissal store

This gives users feedback about what the extractor found without creating accidental duplicate tasks.

### Search And Sorting

The search box is always visible above the list.

Search should match across both saved tasks and candidate rows using:

- Task text
- Tags
- File path or source note
- Date
- Due date
- Candidate-related metadata where present

Sorting rules:

- Saved tasks continue to use the existing section-based ordering logic
- Candidate rows keep extraction order so the AI result priority is preserved

### Right Rail

The right rail becomes a compact support column with only two jobs.

1. `Quick Add`
1. `AI Intake Controls`

Quick Add:

- Task text
- Save target date
- Due date
- Add / Clear actions
- Save target date is optional
- If save target date is empty, save to `tasks/inbox.md`
- If save target date is set, save to `tasks/YYYY-MM-DD.md`
- Saved-task section placement continues to follow the existing classification rule based on `dueDate ?? date`

AI Intake Controls:

- Moments extraction controls
- Notes extraction controls
- Inline processing/error status under each control block
- No extracted candidate cards in the rail

### Analytics Strip

Analytics remain visible but clearly secondary.

- Two compact cards below the main workspace
- Content remains:
  - `Next 7 days`
  - `Category balance`
- Lower visual weight than the main list and right rail
- Smaller heights and tighter copy than the current implementation

### Empty States

Three empty states are required:

1. `No search results`
2. `No items in this filter`
3. `No candidates yet`

The candidate-specific empty state should be distinct from the generic list empty state so the extraction workflow remains understandable.

Rules:

- `No candidates yet` appears when the active filter is `Candidate` and there are no candidate rows to render
- `All` never uses the candidate-specific empty state; if there are saved tasks but no candidates, it simply renders the saved-task sections

### Error Handling

- Extraction errors render under the relevant extractor block in the right rail
- The main list should remain stable even when extraction fails
- Candidate rows should only appear after a successful extraction response

### Responsive Behavior

Desktop:

- Main list is primary
- Right rail remains visible beside it
- Analytics sit below

Narrow widths:

- Stack in this order:
  1. Main list
  1. Right rail
  1. Analytics strip
- Filters wrap without horizontal scrolling
- Dense rows remain dense, but action clusters may wrap beneath the title when needed

---

## Implementation Approach

### General Approach

Use a focused rewrite of the dashboard webview rather than broad extension-side changes.

- Keep markdown task storage format unchanged
- Keep extraction model calls unchanged
- Keep task collection and saved-task classification logic largely intact
- Rebuild the webview structure, styling, and client-side rendering pipeline around the new command-center layout

### Data And Rendering Changes

The largest functional change is candidate integration.

Implementation requirements:

- Extend extraction post-processing so existing-task duplicates are no longer discarded completely
- Preserve enough candidate metadata for Webview rendering and filtering
- Merge candidate rows into the client-side list renderer as virtual rows
- Keep saved tasks as the source of truth for persisted task actions
- Keep candidate rows client-side only until `Add` is executed

Expected impact area:

- `filterExtractedTasksForDisplay()` and related extraction status logic
- `_runAiExtract()` and `_extractFromNotes()` payload handling
- `_getHtml()` layout, CSS, and client-side render pipeline
- filter/search state handling inside the webview script

### Files Likely To Change

| File | Change |
|------|--------|
| `src/dashboardPanel.ts` | Main layout rewrite, candidate-row rendering, filter/search behavior, extraction result handling |
| `src/dashboardExtractLayout.ts` | Simplify right-rail extraction markup to controls + status only |
| `src/test/dashboardExtractLayout.test.ts` | Update test expectations for the extraction controls markup |

### Files Expected To Stay Unchanged

- `src/aiTaskProcessor.ts`
- `src/extension.ts`
- task markdown file format under `tasks/*.md`
- notes storage conventions

---

## Visual System

| Role | Source |
|------|--------|
| Background | `--vscode-editor-background` |
| Main surface | `--vscode-editorWidget-background` |
| Borders | `--vscode-panel-border` |
| Primary text | `--vscode-foreground` |
| Secondary text | `--vscode-descriptionForeground` |
| Accent | `--vscode-textLink-foreground` |
| Success | `--vscode-testing-iconPassed` |
| Warning | `--vscode-editorWarning-foreground` |
| Error | `--vscode-errorForeground` |

Rules:

- Structure is built primarily with grays and surfaces
- Accent is reserved for focus, active filter states, and key actions
- Semantic colors are reserved for status meaning only

---

## Success Criteria

- [ ] The dashboard reads as one command-center screen rather than separate cards
- [ ] The central task list is visually dominant on desktop
- [ ] Saved tasks and AI candidates can be reviewed in the same main list
- [ ] Candidate rows support `Add` and `Dismiss`
- [ ] Existing-task duplicates appear as disabled `Already exists` candidate rows instead of disappearing completely
- [ ] The `Candidate` filter exists and becomes active after extraction
- [ ] `Attention` continues to represent only saved tasks that need action soon
- [ ] The right rail no longer renders full extracted-result cards
- [ ] Analytics remain visible but clearly secondary
- [ ] Empty states distinguish between no search results, no filter items, and no candidates yet
- [ ] The dashboard remains usable on narrow VS Code panel widths without horizontal overflow
- [ ] Dark and light VS Code themes both maintain readable contrast

---

## Verification Expectations

- `bun run check-types`
- `bun test`
- Manual dashboard verification in VS Code Webview
- Manual checks must include:
  - dark theme
  - light theme
  - extraction from Moments
  - extraction from Notes
  - candidate `Add`
  - candidate `Dismiss`
  - duplicate candidate disabled state
  - saved task `Done / Edit / Open file / Delete`
  - filter switching
  - search behavior
  - narrow-width responsive layout
