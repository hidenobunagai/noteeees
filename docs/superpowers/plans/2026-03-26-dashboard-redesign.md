# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the AI Task Dashboard webview with a Modern & Polished aesthetic: KPI stat cards, Upcoming Tasks (broader filter), date-labelled weekly bar chart, gradient card styling, and a differentiated AI Actions card.

**Architecture:** All changes are confined to `src/dashboardPanel.ts`. `_update()` gains a new `upcomingTasks` filter and `completionRate` stat. `_getHtml()` is fully rewritten with new CSS and HTML. All existing message handlers, file I/O, and public interfaces remain unchanged.

**Tech Stack:** TypeScript 5.9, VS Code Webview API, inline HTML/CSS/JS string generation, esbuild, bun

---

## Task 1: Update `_update()` — Upcoming Tasks filter + KPI data

**Files:**
- Modify: `src/dashboardPanel.ts` (the `_update()` method, ~lines 200–256)

### Context

The current code builds `todayTasks` by filtering `task.date === today || task.date === null`.
We need to:
1. Rename to `upcomingTasks` and expand the filter to also include tasks whose `dueDate` falls within the next 7 days.
2. Sort: open tasks first (due-dated by date ASC, then undated alphabetically), done tasks last.
3. Compute `completionRate` as a percentage integer.
4. Pass these new fields into `_getHtml()`.

- [ ] **Step 1: Replace the todayTasks block and the data object in `_update()`**

Find this existing block in `_update()` (around line 224):

```typescript
    const todayTasks = tasks
      .filter((t) => t.date === today || t.date === null)
      .sort((a, b) => (a.done === b.done ? a.text.localeCompare(b.text) : a.done ? 1 : -1));

    const openTasks = tasks.filter((t) => !t.done);
```

Replace it with:

```typescript
    const openTasks = tasks.filter((t) => !t.done);

    // Compute the cutoff date string (today + 7 days, YYYY-MM-DD)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + 7);
    const cutoffStr = `${cutoffDate.getFullYear()}-${pad2(cutoffDate.getMonth() + 1)}-${pad2(cutoffDate.getDate())}`;

    const upcomingTasks = tasks
      .filter((t) => {
        if (t.date === today || t.date === null) return true;
        if (t.dueDate && t.dueDate <= cutoffStr) return true;
        return false;
      })
      .sort((a, b) => {
        // Open tasks come before done tasks
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.done) {
          // Both open: tasks with due dates first (ascending), then undated alphabetically
          const aDue = a.dueDate ?? null;
          const bDue = b.dueDate ?? null;
          if (aDue && bDue) return aDue.localeCompare(bDue);
          if (aDue) return -1;
          if (bDue) return 1;
          return a.text.localeCompare(b.text);
        }
        // Both done: alphabetical
        return a.text.localeCompare(b.text);
      });
```

- [ ] **Step 2: Update the `data` object passed to `_getHtml()`**

Find the current `data` object (around line 246):

```typescript
    const data = {
      today,
      todayTasks,
      week,
      catCount,
      totalOpen: openTasks.length,
      totalDone: tasks.filter((t) => t.done).length,
    };
```

Replace with:

```typescript
    const totalDone = tasks.filter((t) => t.done).length;
    const totalAll = tasks.length;
    const completionRate = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

    const data = {
      today,
      upcomingTasks,
      week,
      catCount,
      totalOpen: openTasks.length,
      totalDone,
      completionRate,
    };
```

- [ ] **Step 3: Update the `_getHtml()` signature**

Find the `_getHtml` method signature (around line 473):

```typescript
  private _getHtml(data: {
    today: string;
    todayTasks: DashTask[];
    week: WeekDay[];
    catCount: Record<string, number>;
    totalOpen: number;
    totalDone: number;
  }): string {
```

Replace with:

```typescript
  private _getHtml(data: {
    today: string;
    upcomingTasks: DashTask[];
    week: WeekDay[];
    catCount: Record<string, number>;
    totalOpen: number;
    totalDone: number;
    completionRate: number;
  }): string {
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
bun run check-types
```

Expected: no errors. If there are errors about `todayTasks` not existing, check that all references inside `_getHtml()` still refer to the old name — they will be updated in later tasks. Temporarily rename occurrences in `_getHtml()` to `upcomingTasks` if needed.

- [ ] **Step 5: Commit**

```bash
git add src/dashboardPanel.ts
git commit -m "refactor: add upcomingTasks filter and completionRate to dashboard data"
```

---

## Task 2: Replace CSS in `_getHtml()`

**Files:**
- Modify: `src/dashboardPanel.ts` (inside `_getHtml()`, the `<style>` block ~lines 546–610)

### Context

The existing `<style>` block is minimal and flat. Replace the entire contents of the `<style nonce="${nonce}">…</style>` block with the new design system below. The nonce and `<style>` tags themselves stay — only the CSS inside changes.

- [ ] **Step 1: Replace the style block content**

Find the existing `<style nonce="${nonce}">` block and replace everything between the opening and closing `</style>` tags with:

```css
  :root { --radius: 10px; --gap: 10px; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: var(--gap);
  }

  /* ── Header ── */
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .header-title {
    font-size: 16px; font-weight: 700; flex: 1;
    background: linear-gradient(135deg, var(--vscode-textLink-foreground, #89b4fa), var(--vscode-badge-foreground, #cba6f7));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    letter-spacing: -0.3px;
  }
  .header-date {
    font-size: 10px; color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border, #313244);
    padding: 2px 8px; border-radius: 20px;
  }
  .btn {
    padding: 4px 10px; font-size: 11px; border-radius: 6px; cursor: pointer;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-panel-border, #313244);
    transition: border-color 0.15s;
  }
  .btn:hover { border-color: var(--vscode-textLink-foreground); color: var(--vscode-textLink-foreground); }
  .btn-primary {
    background: linear-gradient(135deg, var(--vscode-textLink-foreground, #89b4fa), var(--vscode-badge-foreground, #cba6f7));
    color: var(--vscode-editor-background, #1e1e2e);
    border: none; font-weight: 600;
  }
  .btn-primary:hover { opacity: 0.85; color: var(--vscode-editor-background, #1e1e2e); border-color: transparent; }

  /* ── KPI Stats Row ── */
  .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap); margin-bottom: var(--gap); }
  .stat-card {
    border-radius: var(--radius); padding: 12px 14px;
    display: flex; align-items: center; gap: 10px;
    border: 1px solid transparent;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  }
  .stat-card.open  { background: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 12%, var(--vscode-editor-background, #1e1e2e)); border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 30%, transparent); }
  .stat-card.done  { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 12%, var(--vscode-editor-background, #1e1e2e)); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 30%, transparent); }
  .stat-card.rate  { background: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 12%, var(--vscode-editor-background, #1e1e2e)); border-color: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 30%, transparent); }
  .stat-icon { font-size: 20px; flex-shrink: 0; }
  .stat-value { font-size: 22px; font-weight: 700; line-height: 1; margin-bottom: 2px; }
  .stat-card.open .stat-value { color: var(--vscode-textLink-foreground, #89b4fa); }
  .stat-card.done .stat-value { color: var(--vscode-testing-iconPassed, #a6e3a1); }
  .stat-card.rate .stat-value { color: var(--vscode-badge-foreground, #cba6f7); }
  .stat-label { font-size: 9px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }

  /* ── Grid ── */
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); margin-bottom: var(--gap); }
  @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } .stats-row { grid-template-columns: 1fr; } }

  /* ── Card ── */
  .card {
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border, #313244);
    border-radius: var(--radius); padding: 14px;
  }
  .card-title {
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
    color: var(--vscode-descriptionForeground); margin-bottom: 10px;
    display: flex; align-items: center; gap: 6px;
  }
  .card-title-badge {
    background: var(--vscode-badge-background, #313244);
    color: var(--vscode-textLink-foreground, #89b4fa);
    font-size: 9px; padding: 1px 6px; border-radius: 10px;
    margin-left: auto; letter-spacing: 0; text-transform: none; font-weight: 600;
  }

  /* ── Upcoming Tasks ── */
  .task-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border, #313244); }
  .task-item:last-child { border-bottom: none; }
  .task-check {
    width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0; margin-top: 1px;
    border: 1.5px solid var(--vscode-panel-border, #45475a);
    appearance: none; -webkit-appearance: none; cursor: pointer;
    background: transparent; position: relative;
    accent-color: var(--vscode-textLink-foreground);
    transition: border-color 0.15s;
  }
  .task-check:hover { border-color: var(--vscode-textLink-foreground); }
  .task-check:checked {
    background: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 20%, transparent);
    border-color: var(--vscode-testing-iconPassed, #a6e3a1);
  }
  .task-check:checked::after {
    content: '✓'; font-size: 9px; color: var(--vscode-testing-iconPassed, #a6e3a1);
    position: absolute; top: -1px; left: 1px;
  }
  .task-body { flex: 1; min-width: 0; }
  .task-text { font-size: 12px; line-height: 1.4; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .task-text:hover { color: var(--vscode-textLink-foreground); }
  .task-item.done .task-text { text-decoration: line-through; color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
  .task-meta { display: flex; gap: 4px; margin-top: 3px; flex-wrap: wrap; }
  .badge {
    font-size: 9px; padding: 1px 6px; border-radius: 10px;
    border: 1px solid transparent;
  }
  .badge-tag   { background: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 15%, transparent); color: var(--vscode-textLink-foreground, #89b4fa); border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 35%, transparent); }
  .badge-today { background: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 12%, transparent); color: var(--vscode-testing-iconPassed, #a6e3a1); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #a6e3a1) 30%, transparent); }
  .badge-due   { background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #fab387) 12%, transparent); color: var(--vscode-editorWarning-foreground, #fab387); border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, #fab387) 30%, transparent); }
  .badge-overdue { background: color-mix(in srgb, var(--vscode-errorForeground, #f38ba8) 12%, transparent); color: var(--vscode-errorForeground, #f38ba8); border-color: color-mix(in srgb, var(--vscode-errorForeground, #f38ba8) 30%, transparent); }
  .empty { font-size: 12px; color: var(--vscode-descriptionForeground); padding: 8px 0; }

  /* ── Weekly bar chart ── */
  .week-bars { display: flex; gap: 5px; height: 90px; padding-bottom: 30px; position: relative; }
  .week-day { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; position: relative; }
  .week-bar-area { flex: 1; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; }
  .bar-done { background: var(--vscode-testing-iconPassed, #a6e3a1); border-radius: 3px 3px 0 0; min-height: 2px; opacity: 0.85; }
  .bar-open { background: var(--vscode-textLink-foreground, #89b4fa); min-height: 2px; opacity: 0.55; }
  .week-day-label { position: absolute; bottom: 0; text-align: center; width: 100%; line-height: 1.3; }
  .week-day-name { font-size: 8px; color: var(--vscode-descriptionForeground); display: block; }
  .week-day-date { font-size: 7px; color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); display: block; opacity: 0.7; }
  .week-day.today::before {
    content: ''; position: absolute; top: 0; bottom: 30px; left: 0; right: 0;
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #89b4fa) 8%, transparent);
    border-radius: 4px; pointer-events: none;
  }
  .week-day.today .week-day-name { color: var(--vscode-textLink-foreground, #89b4fa); font-weight: 700; }
  .week-day.today .week-day-date { color: var(--vscode-textLink-foreground, #89b4fa); opacity: 0.7; }
  .week-legend { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; }
  .legend-item { display: flex; align-items: center; gap: 4px; font-size: 9px; color: var(--vscode-descriptionForeground); }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; }

  /* ── Categories ── */
  .cat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
  .cat-row:last-child { margin-bottom: 0; }
  .cat-label { font-size: 11px; width: 90px; flex-shrink: 0; color: var(--vscode-foreground); }
  .cat-bar-wrap { flex: 1; height: 6px; background: var(--vscode-panel-border, #313244); border-radius: 3px; overflow: hidden; }
  .cat-bar { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--vscode-textLink-foreground, #89b4fa), var(--vscode-badge-foreground, #cba6f7)); }
  .cat-count { font-size: 10px; color: var(--vscode-descriptionForeground); width: 20px; text-align: right; flex-shrink: 0; }

  /* ── AI Actions ── */
  .ai-card {
    background: linear-gradient(135deg, var(--vscode-editorWidget-background, #1e1e2e), #1e1a2e);
    border-color: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 20%, transparent);
  }
  .ai-card .card-title { color: color-mix(in srgb, var(--vscode-badge-foreground, #cba6f7) 80%, var(--vscode-descriptionForeground)); }
  .ai-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  #ai-status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; min-height: 16px; font-style: italic; }
  #ai-status.error { color: var(--vscode-errorForeground); font-style: normal; }

  /* ── Plan / Extract results (unchanged from original) ── */
  .plan-result { margin-top: 8px; }
  .plan-summary { font-size: 12px; font-style: italic; margin-bottom: 8px; color: var(--vscode-descriptionForeground); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .plan-hours { font-size: 11px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 1px 7px; font-style: normal; }
  .plan-item { padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border, #0001); font-size: 12px; }
  .plan-item-header { display: flex; gap: 8px; align-items: baseline; }
  .plan-priority { font-size: 11px; flex-shrink: 0; }
  .plan-task { flex: 1; }
  .plan-dur { color: var(--vscode-descriptionForeground); font-size: 11px; flex-shrink: 0; }
  .plan-reason { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; padding-left: 20px; }
  .extract-task { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; font-size: 12px; }
  .extract-info { flex: 1; }
  .extract-meta { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .due-badge { font-size: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; padding: 0 4px; margin-left: 4px; vertical-align: middle; }
  .due-overdue { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #f48771); }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run check-types
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/dashboardPanel.ts
git commit -m "style: replace dashboard CSS with modern polished design system"
```

---

## Task 3: Rewrite HTML — Header + KPI Stats Row

**Files:**
- Modify: `src/dashboardPanel.ts` (inside `_getHtml()`, the `<body>` HTML string starting at line 612)

### Context

Replace the current `<body>` content with new HTML. Do this section by section across Tasks 3–6.
In Task 3, replace the old `<div class="header">…</div>` with the new header + stats row.

The current `<body>` starts with:
```html
<div class="header">
  <div class="header-title">📋 AI Task Dashboard</div>
  <div class="header-date">${escHtml(data.today)}</div>
  <div class="header-stats">Open: ${data.totalOpen} / Done: ${data.totalDone}</div>
  <button class="btn" id="btn-refresh">⟳ Refresh</button>
</div>
```

- [ ] **Step 1: Replace the old header block**

Find the old header block in the HTML string and replace with:

```html
<div class="header">
  <div class="header-title">📋 AI Task Dashboard</div>
  <div class="header-date">${escHtml(data.today)}</div>
  <button class="btn" id="btn-refresh">↻ Refresh</button>
</div>

<div class="stats-row">
  <div class="stat-card open">
    <div class="stat-icon">📌</div>
    <div>
      <div class="stat-value">${data.totalOpen}</div>
      <div class="stat-label">Open tasks</div>
    </div>
  </div>
  <div class="stat-card done">
    <div class="stat-icon">✅</div>
    <div>
      <div class="stat-value">${data.totalDone}</div>
      <div class="stat-label">Done</div>
    </div>
  </div>
  <div class="stat-card rate">
    <div class="stat-icon">🎯</div>
    <div>
      <div class="stat-value">${data.completionRate}%</div>
      <div class="stat-label">Completion rate</div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run check-types
```

- [ ] **Step 3: Commit**

```bash
git add src/dashboardPanel.ts
git commit -m "feat: add KPI stats row to dashboard header"
```

---

## Task 4: Rewrite HTML — Upcoming Tasks card

**Files:**
- Modify: `src/dashboardPanel.ts` (the `todayTasksHtml` generation block and the card HTML that uses it)

### Context

The current code builds `todayTasksHtml` from `data.todayTasks`. We replace it with `upcomingTasksHtml` built from `data.upcomingTasks`, adding tag/Today/due-date badges.

- [ ] **Step 1: Replace the `todayTasksHtml` generation block**

Find the block starting with:
```typescript
    const todayTasksHtml =
      data.todayTasks.length === 0
```

Replace the entire `todayTasksHtml` generation (through its closing assignment) with:

```typescript
    const upcomingTasksHtml =
      data.upcomingTasks.length === 0
        ? `<p class="empty">upcoming タスクはありません 🎉</p>`
        : data.upcomingTasks
            .map((t) => {
              const doneClass = t.done ? " done" : "";
              const safeTxt = escHtml(t.text);
              const safeId = escAttr(t.id);
              const safePath = escAttr(t.filePath);

              // Tag badges: show first matching category tag only
              const CATS = ["work", "personal", "health", "learning", "admin"];
              const firstTag = t.tags.find((tag) =>
                CATS.includes(tag.replace("#", "").toLowerCase()),
              );
              const tagBadge = firstTag
                ? `<span class="badge badge-tag">${escHtml(firstTag)}</span>`
                : "";

              // Today badge
              const todayBadge =
                t.date === data.today
                  ? `<span class="badge badge-today">Today</span>`
                  : "";

              // Due date badge
              let dueBadge = "";
              if (t.dueDate) {
                const isOverdue = t.dueDate < data.today;
                const badgeClass = isOverdue ? "badge badge-overdue" : "badge badge-due";
                // Format YYYY-MM-DD → MMM DD
                const [, mm, dd] = t.dueDate.split("-");
                const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                const monthName = months[parseInt(mm, 10) - 1] ?? mm;
                dueBadge = `<span class="${badgeClass}">📅 ${monthName} ${dd}</span>`;
              }

              const meta = [tagBadge, todayBadge, dueBadge].filter(Boolean).join("");
              const metaRow = meta ? `<div class="task-meta">${meta}</div>` : "";

              return `<div class="task-item${doneClass}">
            <input type="checkbox" class="task-check" ${t.done ? "checked" : ""} data-task-id="${safeId}">
            <div class="task-body">
              <div class="task-text" data-file="${safePath}" data-line="${t.lineIndex}">${safeTxt}</div>
              ${metaRow}
            </div>
          </div>`;
            })
            .join("");
```

- [ ] **Step 2: Replace the card HTML that uses `todayTasksHtml`**

Find in the HTML string:
```html
<div class="card" id="today-tasks-card">
    <h2>Today's Tasks (${data.todayTasks.filter((t) => !t.done).length} open)</h2>
    ${todayTasksHtml}
  </div>
```

Replace with:
```html
<div class="card" id="upcoming-tasks-card">
    <div class="card-title">
      Upcoming Tasks
      <span class="card-title-badge">${data.upcomingTasks.filter((t) => !t.done).length} open</span>
    </div>
    ${upcomingTasksHtml}
  </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run check-types
```

- [ ] **Step 4: Commit**

```bash
git add src/dashboardPanel.ts
git commit -m "feat: replace Today's Tasks with Upcoming Tasks card with badges"
```

---

## Task 5: Rewrite HTML — Weekly Overview card (date labels + stacked bars)

**Files:**
- Modify: `src/dashboardPanel.ts` (the `weekBarsHtml` generation block and card HTML)

### Context

Currently `weekBarsHtml` shows only day labels (`Mon`, `Tue`…). We add `M/D` date lines beneath each label, split Done (green) / Open (blue) into separate colored bars, highlight today's column with a background tint, and add a legend.

- [ ] **Step 1: Replace the `weekBarsHtml` generation block**

Find the block starting with:
```typescript
    const weekBarsHtml = data.week
      .map((d) => {
```

Replace the entire block through its closing assignment with:

```typescript
    const weekBarsHtml = data.week
      .map((d) => {
        const total = d.open + d.done;
        const doneH = total > 0 ? Math.round((d.done / weekMax) * 100) : 0;
        const openH = total > 0 ? Math.round((d.open / weekMax) * 100) : 0;
        const isToday = d.date === data.today;
        // Format date as M/D (no leading zero)
        const [, mm, dd] = d.date.split("-");
        const dateLabel = `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
        return `<div class="week-day${isToday ? " today" : ""}">
        <div class="week-bar-area">
          <div class="bar-done" style="height:${doneH}%"></div>
          <div class="bar-open" style="height:${openH}%"></div>
        </div>
        <div class="week-day-label">
          <span class="week-day-name">${escHtml(d.label)}</span>
          <span class="week-day-date">${escHtml(dateLabel)}</span>
        </div>
      </div>`;
      })
      .join("");
```

- [ ] **Step 2: Replace the Weekly Overview card HTML**

Find in the HTML string:
```html
<div class="card">
    <h2>Weekly Overview</h2>
    <div class="week-bars">${weekBarsHtml}</div>
  </div>
```

Replace with:
```html
<div class="card">
    <div class="card-title">Weekly Overview</div>
    <div class="week-bars">${weekBarsHtml}</div>
    <div class="week-legend">
      <div class="legend-item"><div class="legend-dot" style="background:var(--vscode-testing-iconPassed,#a6e3a1)"></div>Done</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--vscode-textLink-foreground,#89b4fa);opacity:.6"></div>Open</div>
    </div>
  </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
bun run check-types
```

- [ ] **Step 4: Commit**

```bash
git add src/dashboardPanel.ts
git commit -m "feat: add date labels and Done/Open color split to weekly bar chart"
```

---

## Task 6: Rewrite HTML — Categories + AI Actions cards + update JS

**Files:**
- Modify: `src/dashboardPanel.ts` (categories card HTML, AI Actions card HTML, webview `<script>` block)

### Context

Two remaining card updates, then a JS event listener fix for the renamed card ID (`upcoming-tasks-card` instead of `today-tasks-card`).

- [ ] **Step 1: Replace the Categories card HTML**

Find in the HTML string:
```html
<div class="card" style="margin-bottom:var(--gap)">
  <h2>Categories (open tasks)</h2>
  ${catHtml}
</div>
```

Replace with:
```html
<div class="card" style="margin-bottom:var(--gap)">
  <div class="card-title">Categories <span style="color:var(--vscode-foreground);text-transform:none;font-weight:400;letter-spacing:0;opacity:.6">(open tasks)</span></div>
  ${catHtml}
</div>
```

Also update the `catHtml` generation so the bar uses `class="cat-bar"` (already in the new CSS).
Find the current `catHtml` map:
```typescript
    const catHtml = CATS.map((c) => {
      const n = data.catCount[c] ?? 0;
      const w = Math.round((n / catMax) * 100);
      return `<div class="cat-row">
        <div class="cat-label">${CAT_ICONS[c]} ${c}</div>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${w}%"></div></div>
        <div class="cat-count">${n}</div>
      </div>`;
    }).join("");
```

This code already produces the right class names (`cat-row`, `cat-label`, `cat-bar-wrap`, `cat-bar`). No changes needed to this block — the new CSS handles the gradient automatically.

- [ ] **Step 2: Replace the AI Actions card HTML**

Find in the HTML string:
```html
<div class="card" id="ai-card">
  <h2>AI Actions</h2>
  <div class="ai-row">
    <button class="btn btn-primary" id="btn-plan-day">✨ Plan My Day</button>
    <button class="btn" id="btn-ai-extract">🤖 AI Extract from Moments</button>
  </div>
  <div id="ai-status"></div>
  <div id="ai-result"></div>
</div>
```

Replace with:
```html
<div class="card ai-card" id="ai-card">
  <div class="card-title">✨ AI Actions</div>
  <div class="ai-row">
    <button class="btn btn-primary" id="btn-plan-day">✨ Plan My Day</button>
    <button class="btn" id="btn-ai-extract">🤖 AI Extract from Moments</button>
  </div>
  <div id="ai-status"></div>
  <div id="ai-result"></div>
</div>
```

- [ ] **Step 3: Update JS event listener for renamed card ID**

In the `<script>` block, find:
```javascript
document.getElementById('today-tasks-card')?.addEventListener('change', function(e) {
```
Replace with:
```javascript
document.getElementById('upcoming-tasks-card')?.addEventListener('change', function(e) {
```

Also find:
```javascript
document.getElementById('today-tasks-card')?.addEventListener('click', function(e) {
```
Replace with:
```javascript
document.getElementById('upcoming-tasks-card')?.addEventListener('click', function(e) {
```

- [ ] **Step 4: Verify full TypeScript check and lint**

```bash
bun run check-types && bun run lint
```

Expected: no errors, no lint warnings.

- [ ] **Step 5: Build the extension**

```bash
node esbuild.js
```

Expected: `dist/extension.js` is regenerated with no errors.

- [ ] **Step 6: Smoke-test in VS Code**

Open VS Code in the project folder and run **"Notes: Open AI Task Dashboard"** from the Command Palette. Verify:
- Header shows gradient title, date pill, Refresh button
- 3 KPI cards (Open / Done / %) are visible with colored values
- Upcoming Tasks card shows tasks with badges (tag, Today, due date)
- Weekly chart shows `Mon 3/20` labels, green Done bars, blue Open bars, legend
- Categories bars are gradient
- AI Actions card has purple-tinted background, gradient primary button
- Checking a task still toggles it in the markdown file
- Clicking task text still opens the file at the correct line
- "Plan My Day" and "AI Extract" buttons still trigger AI processing

- [ ] **Step 7: Commit**

```bash
git add src/dashboardPanel.ts
git commit -m "feat: update categories card, AI actions card, and fix event listener IDs"
```

---

## Success Checklist (from spec)

- [ ] KPI row shows Open, Done, completion% in gradient cards
- [ ] Upcoming Tasks shows today + undated + due-within-7-days tasks
- [ ] Tasks display tag badges, Today/due date badges
- [ ] Weekly chart shows `Mon 3/20` style labels; today column is highlighted
- [ ] Weekly chart shows Done (green) and Open (blue) stacked bars with legend
- [ ] Category bars use gradient fill
- [ ] AI Actions card has distinct purple-tinted background
- [ ] Primary button uses gradient; secondary button uses bordered style
- [ ] No regressions: checkbox toggle, file open, plan day, AI extract all work
- [ ] Renders acceptably on VS Code light themes: no invisible text (text contrast ≥ 4.5:1)
