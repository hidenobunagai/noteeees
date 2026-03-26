# AI Task Dashboard Redesign

**Date:** 2026-03-26  
**Status:** Approved  
**Scope:** `src/dashboardPanel.ts` — `_getHtml()` rewrite + `_update()` filter update

---

## Problem Statement

The current AI Task Dashboard webview is visually plain. Specific issues:

- No summary statistics visible at a glance (Open / Done / completion rate)
- Weekly Overview bar chart shows only day-of-week labels (Mon/Tue…) with no dates, making it impossible to know which week is shown
- "Today's Tasks" only shows tasks dated today or undated — excludes tasks with near-future due dates that need attention now
- Cards lack visual hierarchy and polish; everything looks the same weight

---

## Design Decisions

### Direction
**Modern & Polished** — gradient accent colors, rounded cards with colored borders, visual hierarchy through color and weight. All colors use VS Code CSS variables to remain theme-compatible, with carefully chosen fallback values that render well on both dark and light themes.

### Layout
**Stats bar → 2-column grid → full-width sections**

```
┌─────────────────────────────────────────┐
│  Header (title · date · refresh button) │
├──────────────┬──────────────┬───────────┤
│  📌 Open     │  ✅ Done     │ 🎯 Rate   │  ← KPI cards (3-col)
├──────────────┴──────────────┴───────────┤
│  Upcoming Tasks   │  Weekly Overview    │  ← 2-col grid
├───────────────────┴─────────────────────┤
│  Categories (open tasks)                │  ← full width
├─────────────────────────────────────────┤
│  AI Actions                             │  ← full width
└─────────────────────────────────────────┘
```

### Section: KPI Stats Row (new)
Three gradient stat cards in a 3-column row, each with an icon, large number, and label:
- **Open** (blue `#89b4fa`) — total open tasks
- **Done** (green `#a6e3a1`) — total done tasks
- **Completion rate** (purple `#cba6f7`) — `done / (open + done) * 100`

Cards use a subtle gradient background (`color @ 15–25% opacity`) with a matching border (`color @ 35% opacity`) to remain readable on any VS Code theme.

### Section: Upcoming Tasks (renamed from "Today's Tasks")
**Filter logic** — a task is included if ANY of:
1. `task.date === today`
2. `task.date === null` (undated)
3. `task.dueDate` is set and `dueDate <= today + 7 days`

Tasks are sorted: open first (sorted by due date ascending, then text), done tasks last.

**Per-task display:**
- Checkbox (squares with rounded corners, hover glow)
- Task text (clickable → opens file at line)
- Meta badges row:
  - `#tag` badge (blue tint) for each matched category tag
  - `Today` badge (green tint) if `task.date === today`
  - `📅 MMM DD` due date badge (amber tint); red tint if overdue

### Section: Weekly Overview (updated)
Bar chart with Done (green) stacked below Open (blue), both shown per day.

**Date labels:** Each column shows two lines — `Mon` and `3/20` — so the exact date is always visible.  
**Today column:** subtle blue background tint + blue-colored date labels.  
**Legend:** small Done/Open color key at bottom-right.

Bar heights are proportional to `weekMax = max(open + done across 7 days, 1)`.

### Section: Categories
Unchanged functionality. Visual update: bar fill changes from flat color to a `linear-gradient(90deg, #89b4fa, #cba6f7)`.

### Section: AI Actions
Background changes to `linear-gradient(135deg, editorWidget-bg, a slightly purple-tinted dark)` with a faint purple border, visually distinguishing it from other cards.

Button styles:
- **Plan My Day** — gradient primary button (`#89b4fa → #cba6f7`, dark text)
- **AI Extract** — secondary button (dark bg, border, light text)

---

## Implementation Approach

**Approach B: `_getHtml()` full rewrite**

- Rewrite `_getHtml()` in `src/dashboardPanel.ts` with new HTML/CSS/JS
- Update `_update()` to compute `upcomingTasks` using the new filter (today + undated + due ≤ today+7)
- Keep `collectTasksFromNotes()`, `DashTask`, `WeekDay` interfaces, and all message handlers unchanged
- Keep CSP nonce pattern unchanged
- All colors use VS Code CSS variables with carefully tested fallbacks

### Files changed
| File | Change |
|------|--------|
| `src/dashboardPanel.ts` | `_getHtml()` full rewrite, `_update()` filter update |

### Files unchanged
- `src/aiTaskProcessor.ts`
- `src/aiTaskIndexer.ts`
- `src/extension.ts`
- `src/noteCommands.ts`
- All other files

---

## Color Palette (VS Code variable mapping)

| Role | VS Code variable | Dark fallback |
|------|-----------------|---------------|
| Background | `--vscode-editor-background` | `#1e1e2e` |
| Card background | `--vscode-editorWidget-background` | `#1e1e2e` |
| Card border | `--vscode-panel-border` | `#313244` |
| Primary text | `--vscode-foreground` | `#cdd6f4` |
| Muted text | `--vscode-descriptionForeground` | `#6c7086` |
| Accent blue | `--vscode-textLink-foreground` | `#89b4fa` |
| Success green | `--vscode-testing-iconPassed` | `#a6e3a1` |
| Warning amber | `--vscode-editorWarning-foreground` | `#fab387` |
| Error red | `--vscode-errorForeground` | `#f38ba8` |
| Badge bg | `--vscode-badge-background` | `#313244` |
| Progress bar | `--vscode-progressBar-background` | `#89b4fa` |

---

## Success Criteria

- [ ] KPI row shows Open, Done, completion% in gradient cards
- [ ] Upcoming Tasks shows today + undated + due-within-7-days tasks
- [ ] Tasks display tag badges, Today/due date badges
- [ ] Weekly chart shows `Mon 3/20` style labels; today column is highlighted
- [ ] Weekly chart shows Done (green) and Open (blue) stacked bars with legend
- [ ] Category bars use gradient fill
- [ ] AI Actions card has distinct purple-tinted background
- [ ] Primary button uses gradient; secondary button uses bordered style
- [ ] No regressions: checkbox toggle, file open, plan day, AI extract all work
- [ ] Renders acceptably on VS Code light themes (no invisible text)
