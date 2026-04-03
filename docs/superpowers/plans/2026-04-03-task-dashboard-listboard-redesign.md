# Task Dashboard Listboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Task Dashboard into a list-first VS Code-native surface where all tasks are visible by default, AI candidates live in a dedicated top section, and Quick Add / AI Extract move into a compact top action bar.

**Architecture:** Keep task storage, dashboard data assembly, KPI calculations, analytics calculations, and extraction commands intact. Focus the work inside `src/dashboardPanel.ts` by replacing the card-heavy shell, rewriting the webview layout/CSS/JS around a listboard structure, and tightening interaction rules. Use tests in `src/test/extension.test.ts` and `src/test/dashboardExtractLayout.test.ts` to lock the new rendering and interaction contracts before changing behavior.

**Tech Stack:** TypeScript, VS Code Webview API, Bun scripts, Mocha-based extension tests, inline HTML/CSS/JS in `dashboardPanel.ts`

---

## File Map

- Modify: `src/dashboardPanel.ts`
  - Replace the current command-center shell with a listboard shell
  - Keep the current data model and calculations, but change default filter, filter rendering, row rendering, empty states, and action-bar layout
  - Keep saved task ordering and analytics logic unchanged
- Modify: `src/dashboardExtractLayout.ts`
  - Align extract controls markup with the new top action bar layout if needed
- Modify: `src/test/extension.test.ts`
  - Add/adjust tests for default filter, section behavior, search empty state, compact KPI chips, action-bar structure, and row interaction rules
- Modify: `src/test/dashboardExtractLayout.test.ts`
  - Update extract layout expectations if markup changes while moving into the top action bar

---

## Task 1: Lock The Listboard Behavior With Tests

**Files:**
- Modify: `src/test/extension.test.ts`
- Modify: `src/dashboardPanel.ts`

- [ ] **Step 1: Add a failing test for the default `All` filter and section model**

Add a test near the existing dashboard HTML tests that renders the webview and asserts:

- the initial filter state is `All`
- the filter chip set includes `All`, `Attention`, `Candidate`, `Overdue`, `Today`, `Upcoming`, `Scheduled`, `Backlog`, and `Done`
- the list model under `All` is sectioned
- the `All` section order is `Candidates`, `Overdue`, `Today`, `Upcoming`, `Scheduled`, `Backlog`, `Done`
- `Attention` is a flat union of `Overdue`, `Today`, and `Upcoming`
- `Candidate` is a flat candidate-only view
- representative non-`All` saved-task filters stay flat rather than sectioned
- search matches across saved tasks and candidates while preserving the active-view order

Example behavior-level assertion style:

```ts
assert.ok(html.includes('data-filter="all"'));
assert.ok(html.includes('data-filter="candidate"'));
assert.ok(html.includes('Candidates'));
```

- [ ] **Step 2: Add a failing test for zero-count section header behavior under `All`**

Write a pure helper test or HTML contract test proving:

- `All` keeps zero-count section headers visible
- the fully empty `All` state replaces the list with a compact empty-state message instead of showing zero-count headers only

- [ ] **Step 3: Add a failing test for partial search behavior in `All`**

Prove:

- search applies inside the active filter
- matching sections remain visible
- non-matching sections disappear
- underlying order is preserved

- [ ] **Step 4: Add a failing test for search zero-results behavior in `All`**

Prove:

- search applies inside the active filter
- when `All` + search produces zero rows, only `No search results` appears
- zero-count section headers are not shown in that special case

- [ ] **Step 5: Run focused tests to verify they fail**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "default All|zero-count section|No search results|partial search"
```

Expected: failure until the new listboard behavior is implemented.

- [ ] **Step 6: Implement the minimal list model changes in `src/dashboardPanel.ts`**

Update the client-side list model logic so it supports:

- default filter = `all`
- sectioned rendering only for `All`
- flat lists for the other filters
- partial-search section retention inside `All`
- the special-case `All` empty-state and `All` search-empty-state rules

- [ ] **Step 7: Re-run the focused tests until they pass**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "default All|zero-count section|No search results|partial search"
```

Expected: pass.

- [ ] **Step 8: Commit the list model groundwork**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts
git commit -m "test: lock dashboard listboard filter behavior"
```

---

## Task 2: Replace The Card-Heavy Shell With A Listboard Layout

**Files:**
- Modify: `src/dashboardPanel.ts`
- Modify: `src/test/extension.test.ts`

- [ ] **Step 1: Add a failing HTML contract test for the new shell structure**

Add a test that asserts the new structure is present and the old right-rail shell is gone.

The new structure should contain stable IDs such as:

- `dashboard-header`
- `dashboard-toolbar`
- `dashboard-action-bar`
- `dashboard-main-list`
- `analytics-strip`

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "listboard shell"
```

Expected: failure until the shell is rewritten.

- [ ] **Step 3: Rewrite only the top-level HTML shell in `_getHtml()`**

Replace the current layout with this order:

1. compact header
2. search/filter toolbar
3. top action bar with Quick Add and AI Extract
4. main list surface
5. analytics strip

Do not keep the current right-side support rail.
Do not fully rewrite saved-task and candidate row markup in this task; keep this task focused on shell containers, header, toolbar, action bar scaffolding, and analytics placement.

- [ ] **Step 4: Replace the current spacing and surface rules with the approved listboard visual system**

Adjust CSS so that:

- card-heavy islands are removed
- list width dominates the screen
- header/KPI area becomes much thinner
- toolbar/action bar use light separation only
- analytics remain visually secondary

- [ ] **Step 5: Add a failing test for the full header contract**

Cover:

- KPI chip labels are present
- literal labels are `Open`, `Attention`, and `Done %`
- chip interactions map to the approved filters
- refresh action remains present in the header
- current local date label remains visible in the header
- compact weekday marker appears when space allows
- rerender / refresh updates it without a separate timer
- KPI numbers use tabular alignment

- [ ] **Step 6: Implement the header KPI chips and narrow-width wrap behavior**

Keep current KPI calculations, but present them as compact chips.

Rules to implement:

- display labels remain `Open`, `Attention`, and `Done %`
- chip interactions map to `All`, `Attention`, and `Done`
- header right side wraps into two rows when needed instead of dropping content
- header date label remains visible, includes the compact weekday marker when space allows, and updates through rerender / refresh behavior

- [ ] **Step 7: Run type-check and the shell-focused tests**

Run:

```bash
bun run check-types && bun run compile-tests && bun x vscode-test --grep "listboard shell|kpi|header date"
```

Expected: pass.

- [ ] **Step 8: Commit the layout rewrite**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts
git commit -m "feat: rebuild dashboard as a listboard shell"
```

---

## Task 3: Move Quick Add And AI Extract Into The Top Action Bar

**Files:**
- Modify: `src/dashboardPanel.ts`
- Modify: `src/dashboardExtractLayout.ts`
- Modify: `src/test/dashboardExtractLayout.test.ts`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Add a failing layout test for the new action-bar extract placement**

Update the extract layout tests to assert:

- Moments and Notes controls still exist
- their status lines remain directly under their control groups
- the extract controls are intended for a top action bar, not a right rail

- [ ] **Step 2: Add a failing HTML contract test for the `60 / 40` action-bar layout rule**

The test should lock:

- Quick Add and AI Extract both remain visible
- desktop layout uses a split container
- sub-`1000px` layout stacks vertically
- Quick Add save target behavior remains unchanged (`tasks/inbox.md` vs `tasks/YYYY-MM-DD.md`)
- candidate `Add` / `Dismiss` actions remain wired
- duplicate candidates still show `Already exists` and disable `Add`

- [ ] **Step 3: Run focused tests to verify failure**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "Dashboard Extract Layout|action bar"
```

Expected: failure until the new structure is implemented.

- [ ] **Step 4: Rewrite the action-bar markup and CSS**

Implement:

- desktop split approximately `60 / 40`
- vertical stacking below `1000px`
- Quick Add first, AI Extract second when stacked
- status lines attached to their own extractor groups

- [ ] **Step 5: Preserve current Quick Add and AI command semantics**

Keep unchanged:

- inbox vs dated save path behavior
- extraction command wiring
- extraction status updates
- candidate add / dismiss behavior
- duplicate prevention behavior

- [ ] **Step 6: Re-run the focused tests**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "Dashboard Extract Layout|action bar"
```

Expected: pass.

- [ ] **Step 7: Commit the action-bar move**

```bash
git add src/dashboardPanel.ts src/dashboardExtractLayout.ts src/test/extension.test.ts src/test/dashboardExtractLayout.test.ts
git commit -m "refactor: move dashboard capture controls into top action bar"
```

---

## Task 4: Render The Main List As Dense Rows Instead Of Card Blocks

**Files:**
- Modify: `src/dashboardPanel.ts`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Add a failing test for saved-row interaction rules**

Cover:

- checkbox remains the only done-toggle control
- task title remains the `Open` control
- `Edit / Open / Delete` are secondary actions shown on hover or focus-within entry points
- checkbox and title are the keyboard entry points that reveal secondary actions

- [ ] **Step 2: Add a failing test for candidate row rules**

Cover:

- candidate rows render in the dedicated `Candidates` section under `All`
- duplicate candidate rows show `Already exists`
- duplicate candidate rows still allow `Dismiss`

- [ ] **Step 3: Add a failing test for constrained-width metadata priority rules**

Cover:

- saved-task rows keep due/date before tags before source
- candidate rows keep due/date before category/priority before source
- source is the first metadata field allowed to truncate aggressively or disappear
- metadata markup/CSS does not allow uncontrolled wrapping that destroys density

- [ ] **Step 4: Run focused tests to verify failure**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "saved-row interaction|candidate rows|metadata priority"
```

Expected: failure until the row renderer is updated.

- [ ] **Step 5: Rewrite saved-task row markup and CSS into the approved dense two-line format**

Implement:

- line 1 = checkbox, title/open control, secondary actions
- line 2 = existing task date, due date, tags, source path
- metadata priority remains due/date before tags before source

- [ ] **Step 6: Rewrite candidate rows to match the listboard rhythm**

Implement:

- candidate label + title + Add/Dismiss actions
- duplicate rows keep `Dismiss`
- metadata priority remains due/date before category/priority before source

- [ ] **Step 7: Re-run the focused tests**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "saved-row interaction|candidate rows|metadata priority"
```

Expected: pass.

- [ ] **Step 8: Commit the dense row rendering change**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts
git commit -m "feat: render dashboard tasks as dense listboard rows"
```

---

## Task 5: Finalize Empty States, Analytics Strip, And Regression Coverage

**Files:**
- Modify: `src/dashboardPanel.ts`
- Modify: `src/test/extension.test.ts`

- [ ] **Step 1: Add a failing test for analytics-strip format and zero-data behavior**

Cover:

- `Next 7 days` remains a compact mini bar chart
- `Category balance` remains a compact horizontal bar list
- zero-data states still render fixed-height zero-value visuals instead of disappearing

- [ ] **Step 2: Add a failing test for final empty-state messaging**

Cover:

- `All` fully empty replaces the list with a compact next-step message that explicitly directs users to `Quick Add` or `AI Extract`
- `Attention` empty clearly says there is nothing urgent
- `Candidate` empty explicitly renders `No candidates yet` and explains extraction results will appear there

- [ ] **Step 3: Run focused tests to verify failure**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "analytics strip|empty state"
```

Expected: failure until the final polish is in place.

- [ ] **Step 4: Implement the final polish in `src/dashboardPanel.ts`**

Implement:

- approved empty-state wording and structure
- compact analytics strip presentation
- any last CSS tightening needed to remove wasted whitespace

- [ ] **Step 5: Run the full local validation suite**

Run:

```bash
bun run check-types && bun run lint && bun run compile-tests && bun x vscode-test && bun run compile && bun run test:mcp && bun test
```

Expected: all checks pass.

- [ ] **Step 6: Perform manual dashboard verification in VS Code**

Manually verify:

- initial `All` visibility with existing tasks
- `Attention` empty state clarity
- `Candidates` top section visibility and behavior
- Quick Add from the top action bar
- Moments extraction from the top action bar
- Notes extraction from the top action bar
- hover and focus-within reveal behavior for `Edit / Open / Delete`
- dark theme readability
- narrow panel width behavior below and above `1000px`

- [ ] **Step 7: Commit the final listboard polish**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts
git commit -m "fix: finalize dashboard listboard redesign"
```
