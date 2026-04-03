# Task Dashboard Listboard Redesign

**Date:** 2026-04-03  
**Status:** Approved  
**Scope:** `src/dashboardPanel.ts`, related dashboard tests, dashboard webview layout/CSS/JS

---

## Problem Statement

The current Task Dashboard is not meeting its primary job.

Observed issues:

- The dashboard is meant to help users organize all tasks, but the current screen feels card-first rather than list-first.
- The initial view can look broken or empty even when tasks exist, because `Attention`-style visibility and weak empty states make task presence unclear.
- Large card surfaces and wide spacing consume vertical and horizontal space that should belong to the task list.
- The right-side composer rail takes too much width away from the list.
- The overall look does not feel close enough to a native VS Code operational surface.

---

## User-Approved Direction

- Primary job: `Organize all tasks in one list`
- Density: `High density, but not cramped`
- Initial filter: `All`
- AI extracted candidates: `Dedicated top section in the main list`
- Input placement: `Move Quick Add and AI Extract to the top bar`
- KPI treatment: `Compact chips`
- Analytics: `Thin strip at the bottom`
- Saved task actions: `Done always visible, other actions on hover/selection`
- Tone: `VS Code native, quiet, practical, with a small amount of dashboard feel`

---

## Design Summary

The dashboard should be rebuilt as a **Listboard**.

This means the screen is no longer a set of large cards around a central list. Instead, it becomes a compact control surface with one dominant list area.

Layout order:

1. Header
2. Search and filters toolbar
3. Action bar (`Quick Add` + `AI Extract`)
4. Main list
5. Analytics strip

The list becomes the clear center of gravity.

---

## Navigation Model

The dashboard uses top-level filter chips.

Filter chips:

- `All`
- `Attention`
- `Candidate`
- `Overdue`
- `Today`
- `Upcoming`
- `Scheduled`
- `Backlog`
- `Done`

Rules:

- these are all filter chips, not section names only
- `All` renders the full sectioned list
- `Attention` is a filter view, not a section inside `All`
- `Candidate` is a filter view, while `Candidates` is the section title shown in the list
- under `All`, rows are rendered in this section order:
  1. `Candidates`
  2. `Overdue`
  3. `Today`
  4. `Upcoming`
  5. `Scheduled`
  6. `Backlog`
  7. `Done`
- non-`All` filters render as flat filtered lists rather than sectioned lists
- `Attention` renders a flat list containing items from `Overdue`, `Today`, and `Upcoming`
- `Candidate` renders a flat list containing candidate rows only
- `Overdue`, `Today`, `Upcoming`, `Scheduled`, `Backlog`, and `Done` each render a flat list for their own matching saved tasks
- saved task ordering within sections and flat filtered views keeps the current implementation logic unchanged
- candidate ordering keeps extraction order unchanged
- search does not introduce a new ranking model; it preserves the underlying order of the active view

---

## Layout

### 1. Header

The header is compact and quiet.

- Left side:
  - `Task Dashboard`
- Right side:
  - current date label
  - KPI chips
  - refresh action

KPI chips:

- `Open`
- `Attention`
- `Done %`

These are chips, not large cards.

KPI chip behavior:

- `Open` switches to `All`
- `Attention` switches to `Attention`
- `Done %` switches to `Done`
- KPI and analytics calculations keep the current implementation logic unchanged

Header narrow-width behavior:

- when the right side cannot fit in one row, it wraps into two rows rather than hiding content

### 2. Toolbar

The main toolbar is always visible directly above the list.

Contents:

- search input
- filter chips

Rules:

- default filter is `All`
- toolbar should remain compact and single-purpose
- it should not be wrapped in a large visual card

### 3. Action Bar

Quick Add and AI Extract move into the top action area instead of living in a heavy right rail.

Contents:

- Quick Add controls
  - task text
  - save target date
  - due date
  - add / clear
- AI Extract controls
  - Moments extract controls
  - Notes extract controls
  - status lines below each extraction control group

Rules:

- both Quick Add and AI Extract remain always visible
- they should feel secondary to the main list, not equal in visual weight
- at `1000px` and above, the horizontal layout uses approximately `60 / 40` width distribution:
  - Quick Add: `60`
  - AI Extract: `40`
- on narrow widths they stack vertically in this order:
  1. Quick Add
  2. AI Extract
- they remain above the list rather than becoming a side column
- status lines remain directly under the related extract controls
- narrow-width stacking begins before horizontal overflow would occur, using a fixed responsive breakpoint in the dashboard layout rather than waiting for broken wrapping
- the fixed breakpoint for vertical stacking is `1000px`

### 4. Main List

The main list uses most of the page width and height.

Section order under `All`:

1. `Candidates`
2. `Overdue`
3. `Today`
4. `Upcoming`
5. `Scheduled`
6. `Backlog`
7. `Done`

Rules:

- all section headers remain visible even when the section count is `0`
- zero-count sections render header only, with no section body placeholder
- this avoids the screen feeling unstable or ambiguous
- the list should visually read as a continuous operational surface, not a stack of large cards

### 5. Analytics Strip

Analytics remain visible but become clearly secondary.

Contents:

- `Next 7 days`
- `Category balance`

Rules:

- sit at the bottom of the dashboard
- lower height and lower emphasis than the list
- no large card feel
- when analytics data is zero or sparse, the strip still renders with zero-value mini charts rather than disappearing or switching to a separate empty-state block

---

## List Behavior

### Initial State

- The dashboard opens to `All`
- users should immediately see the full landscape of work
- the first screen should never look empty if open tasks exist elsewhere in the list

### Candidate Section

AI extracted candidates are shown only in the dedicated `Candidates` section at the top of the main list.

Rules:

- candidate rows are not mixed inline into saved-task sections
- candidate rows remain in the main list rather than a separate right-side result area
- candidate rows support:
  - `Add`
  - `Dismiss`
- rows already represented by existing tasks display `Already exists`
- `Add` is disabled for those duplicate rows
- duplicate candidate rows still keep `Dismiss`

### Saved Task Sections

Saved-task sections still represent scheduling state:

- `Overdue`
- `Today`
- `Upcoming`
- `Scheduled`
- `Backlog`
- `Done`

The dashboard is primarily a listboard, so these sections are the dominant structural element.

---

## Row Design

### Saved Task Row

Each saved task row uses a dense two-line layout.

Line 1:

- checkbox
- task title
- secondary actions available on hover/selection:
  - `Edit`
  - `Open`
  - `Delete`

Line 2:

- existing task date
- due date
- tags
- source path

Rules:

- rows must feel tighter than the current design
- rows should still be readable in VS Code narrow panels
- title remains the visual focus
- the checkbox is the only control used for done / undone state changes
- the task title remains an `Open` control for click and keyboard activation
- `Edit / Open / Delete` appear when the row is hovered or when focus exists inside the row
- keyboard focus inside row controls must reveal the same secondary actions as hover
- keyboard entry points for revealing secondary actions are the row checkbox and the task title control
- the displayed `date` keeps the current task-date meaning already used by the dashboard

### Candidate Row

Candidate rows use the same overall rhythm as saved rows, but with a slightly lighter emphasis.

Line 1:

- candidate label
- task title
- actions:
  - `Add`
  - `Dismiss`
  - `Already exists` when relevant

Line 2:

- source label
- due date if available
- category / priority when present in extracted data

Rules:

- candidate rows should look related to saved rows, not like a separate product surface
- they must still be visually distinguishable as uncommitted suggestions

### Metadata Priority And Overflow

Saved task metadata priority under constrained width:

1. title
2. due/date
3. tags
4. source path

Candidate metadata priority under constrained width:

1. title
2. due/date
3. category / priority labels
4. source

Rules:

- higher-priority fields remain visible first
- source is the first metadata field allowed to truncate aggressively or disappear
- metadata should not wrap in uncontrolled ways that destroy list density

---

## Empty-State Rules

Current behavior makes the screen feel broken when the active filter has no rows. The redesign must make that state explicit and calm.

Required empty states:

### `All`

If all sections are empty:

- show a compact message explaining that there are no tasks yet
- point to the next action: Quick Add or AI Extract
- replace the sectioned list entirely rather than leaving zero-count headers visible

### `Attention`

If `Attention` has no rows:

- explicitly say there is nothing urgent right now
- do not leave the user with a large empty void that looks like a rendering failure

### `Candidate`

If there are no candidates:

- show `No candidates yet`
- explain that extraction results will appear in this section after AI extraction
- under `All`, the `Candidates` header still remains visible even when its count is `0`

### Search Empty State

If search removes all visible rows:

- show `No search results`
- avoid implying that data itself is missing
- when the active filter is `All` and search returns zero rows, render only the search empty state rather than zero-count section headers

### Search And Filter Composition

Rules:

- search always applies within the active filter
- `All` keeps section structure under search, but only for sections that still contain visible rows
- non-`All` filters do not preserve empty headers under search; they remain flat filtered lists

---

## Visual Direction

### Personality

- quiet
- practical
- VS Code native
- only a small amount of dashboard styling

### Spacing Policy

- remove large card gaps and oversized panel padding
- keep spacing tight but breathable
- prioritize row density over decorative whitespace

### Surface Policy

- use one dominant list surface
- toolbar and analytics can use light surface separation
- avoid multiple equally heavy cards competing for attention

### Color Policy

- neutral base + one accent
- semantic colors only for status meaning
- no decorative gradients or glow

### Typography Policy

- smaller title treatment than the current build
- row titles carry the most weight
- metadata stays subdued
- KPI numbers use tabular alignment

### Header Date Label

- the header date label uses the current local date with a compact weekday marker when space allows
- it updates through normal dashboard rerender or refresh behavior rather than a separate live timer

### Analytics Strip Format

- `Next 7 days` uses a compact mini bar chart
- `Category balance` uses a compact horizontal bar list
- both stay visually light and secondary to the main list
- zero-value states still render at fixed height with zero-value visuals rather than switching to a separate empty-state card

---

## Functional Requirements

- Quick Add save behavior remains unchanged:
  - empty save target date -> `tasks/inbox.md`
  - filled save target date -> `tasks/YYYY-MM-DD.md`
- AI extraction controls remain available without switching to another view
- candidate add/dismiss flows continue to work in the top `Candidates` section
- duplicate prevention remains intact
- default filter becomes `All`
- empty states must prevent false impressions of data loss
- search works across saved tasks and candidates together
- section headers remain visible only for sections that still have visible rows under an active search
- row `selection` refers to hover or focus-within state, not a separate persistent click-selected row state

---

## Success Criteria

- [ ] The screen reads as a task list first, not a card dashboard first
- [ ] Opening the dashboard with existing tasks does not feel empty or broken
- [ ] `All` clearly shows the full task landscape
- [ ] `Candidates` appears as the dedicated top section
- [ ] Quick Add and AI Extract no longer steal width through a right rail
- [ ] KPI presentation becomes compact chips rather than large summary cards
- [ ] Analytics remain available but visually secondary
- [ ] Saved task rows are denser and cleaner
- [ ] Hover-only secondary actions reduce clutter while preserving control
- [ ] The design feels closer to a native VS Code operational surface

---

## Verification Expectations

- `bun run check-types`
- `bun run lint`
- `bun run compile-tests`
- `bun x vscode-test`
- manual dashboard verification in VS Code

Manual checks must include:

- initial `All` visibility with existing tasks
- `Attention` empty state clarity
- `Candidates` section position and behavior
- Quick Add from the top action bar
- Moments extraction from the top action bar
- Notes extraction from the top action bar
- hover/selection behavior for secondary saved-task actions
- dark theme readability
- narrow panel width behavior
