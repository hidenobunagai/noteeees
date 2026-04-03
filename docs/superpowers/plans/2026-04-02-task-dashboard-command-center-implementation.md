# Task Dashboard Command Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Task Dashboard into a dense command-center UI where saved tasks and AI candidates are reviewed in one main list, while keeping analytics and capture workflows secondary but available.

**Architecture:** Keep the extension-side task storage and extraction entry points intact, then reshape the dashboard around a new client-side rendering model. The main work is in `src/dashboardPanel.ts`: introduce candidate-aware view models, revise extraction filtering so duplicates can still render as disabled candidates, and rewrite the webview layout/CSS/JS to support command-center filtering, dense rows, and candidate state transitions. The right-rail extraction markup in `src/dashboardExtractLayout.ts` becomes control-only, and tests are expanded in `src/test/extension.test.ts` and `src/test/dashboardExtractLayout.test.ts`.

**Tech Stack:** TypeScript, VS Code Webview API, Bun scripts, Mocha-based extension tests, inline HTML/CSS/JS in `dashboardPanel.ts`

---

## File Map

- Modify: `src/dashboardPanel.ts`
  - Add candidate-aware types and filtering helpers
  - Keep saved task classification logic intact
  - Change extraction result handling to preserve duplicate candidates as disabled rows
  - Rewrite `_getHtml()` layout, styling, and client-side rendering pipeline
- Modify: `src/dashboardExtractLayout.ts`
  - Keep extraction controls
  - Remove dependency on separate extracted-result card rendering in the right rail
- Modify: `src/test/extension.test.ts`
  - Add/adjust tests for extraction filtering and candidate display rules
- Modify: `src/test/dashboardExtractLayout.test.ts`
  - Update layout tests to match the slimmer right-rail extraction markup

---

## Task 1: Lock Candidate Filtering Rules With Tests

**Files:**
- Modify: `src/test/extension.test.ts`
- Modify: `src/dashboardPanel.ts`

- [ ] **Step 1: Add a failing test for duplicate extracted tasks staying visible as disabled candidates**

Add a new test near the existing `filterExtractedTasksForDisplay` coverage in `src/test/extension.test.ts`.

The test should prove:

- existing saved-task duplicates are not dropped entirely
- duplicate candidates still count as hidden duplicates only when duplicated inside the extraction result itself
- dismissed candidates remain hidden

Example structure:

```ts
test("filterExtractedTasksForDisplay keeps existing-task duplicates as visible disabled candidates", () => {
  const result = filterExtractedTasksForDisplay(
    [
      {
        text: "Send report",
        category: "work",
        priority: "high",
        timeEstimateMin: 30,
        dueDate: null,
      },
      {
        text: "Review budget",
        category: "work",
        priority: "medium",
        timeEstimateMin: 20,
        dueDate: "2026-03-31",
      },
    ],
    [
      {
        id: "tasks/inbox.md:1",
        filePath: "/tmp/notes/tasks/inbox.md",
        lineIndex: 1,
        text: "Send report @2026-03-30",
        done: false,
        date: null,
        dueDate: "2026-03-30",
        tags: [],
      },
    ],
    [],
    "2026-03-27",
  );

  assert.deepStrictEqual(result.visibleTasks.map((task) => task.text), ["Send report", "Review budget"]);
  assert.strictEqual(result.hiddenExisting, 0);
});
```

- [ ] **Step 2: Run the focused extension test suite to confirm the new expectation fails**

Run:

```bash
bun run compile-tests && bun x tsc -p . --noEmit
```

Expected: compile succeeds, but the new assertion is not yet satisfied by the current implementation.

- [ ] **Step 3: Extend extracted-task display filtering so existing saved-task duplicates remain visible**

Modify `filterExtractedTasksForDisplay()` in `src/dashboardPanel.ts`.

Implementation requirements:

- keep hidden duplicate collapsing for duplicates inside the extraction payload itself
- keep dismissed candidate hiding
- stop excluding candidates only because a saved task already exists
- instead, carry enough information forward so the webview can render those rows as `Already exists`

This likely requires adding metadata to the filtered result shape, not just changing counters.

- [ ] **Step 4: Add the minimal type changes needed for candidate metadata**

In `src/dashboardPanel.ts`, introduce candidate-specific types rather than overloading `DashTask`.

Recommended shape:

```ts
interface DashboardCandidateTask {
  kind: "candidate";
  text: string;
  dueDate: string | null;
  category: string;
  priority: string;
  timeEstimateMin: number;
  source: "moments" | "notes";
  sourceLabel: string;
  existsAlready: boolean;
}
```

Keep the type minimal and only include fields that are actually rendered or filtered.

- [ ] **Step 5: Re-run the relevant unit tests until they pass**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "filterExtractedTasksForDisplay"
```

Expected: the extraction filtering tests pass.

- [ ] **Step 6: Commit the filtering change**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts
git commit -m "test: lock dashboard candidate filtering rules"
```

---

## Task 2: Add Candidate-Aware Dashboard View Models And Filter Logic

**Files:**
- Modify: `src/dashboardPanel.ts`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Add a failing test for candidate filter routing rules**

Add a pure-function test that proves:

- `All` includes saved tasks and candidate rows
- `Candidate` includes only candidate rows
- saved-task filters such as `Overdue`, `Today`, `Upcoming`, `Scheduled`, `Backlog`, and `Done` never include candidates
- `Attention` targets only saved tasks

If no helper exists yet, write the test first against a new helper you intend to introduce.

- [ ] **Step 2: Run the focused test to confirm the helper does not exist or fails**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "candidate filter"
```

Expected: failure because the helper or behavior is not implemented.

- [ ] **Step 3: Introduce explicit row/view-model types for the webview**

In `src/dashboardPanel.ts`, create clear distinctions between:

- saved task rows
- candidate rows
- shared list row unions used by the webview script

Recommended approach:

- keep existing `DashboardTaskView` for saved tasks
- add a new `DashboardCandidateView`
- add a `DashboardListItem = DashboardTaskView | DashboardCandidateView`

- [ ] **Step 4: Add pure helpers for candidate rendering and filter membership**

Implement small helpers in `src/dashboardPanel.ts` such as:

- candidate-to-view conversion
- list item filter matching
- `Candidate` section count calculation
- candidate ordering preservation so extracted candidates keep their original extraction order after merging

Keep these helpers outside `_getHtml()` so they can be tested without webview string parsing.

- [ ] **Step 5: Add tests for the new helper behavior**

Expand `src/test/extension.test.ts` to cover:

- candidate inclusion in `All`
- candidate exclusion from saved-task-only filters
- `Candidate` count behavior

- [ ] **Step 6: Re-run the relevant tests**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "candidate"
```

Expected: candidate-specific unit tests pass.

- [ ] **Step 7: Commit the view-model/filter groundwork**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts
git commit -m "refactor: add candidate-aware dashboard list models"
```

---

## Task 3: Slim The Right Rail Extraction Markup

**Files:**
- Modify: `src/dashboardExtractLayout.ts`
- Modify: `src/test/dashboardExtractLayout.test.ts`

- [ ] **Step 1: Write a failing layout test for the new extraction markup shape**

Update `src/test/dashboardExtractLayout.test.ts` so it asserts:

- extraction controls still render for Moments and Notes
- status containers still exist
- separate extracted-result card scaffolding is no longer required in the right rail

Keep the test focused on structure, not styling.

- [ ] **Step 2: Run the focused layout test to verify it fails**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "Dashboard Extract Layout"
```

Expected: failure until the markup is updated.

- [ ] **Step 3: Simplify `buildDashboardExtractSectionHtml()` to control-only markup**

In `src/dashboardExtractLayout.ts`:

- keep date inputs and extract buttons
- keep status placeholders (`ai-status`, `notes-extract-status`)
- keep result container anchors only if the dashboard script still needs DOM mount points for hidden state
- remove unnecessary card-like wrappers meant for rendering extracted items in the rail

Dependency note:

- do not remove `#ai-result` or `#notes-extract-result` if Task 5 has not yet removed the remaining script-side dependency on those mount points
- if the current implementation still depends on those IDs, keep the anchors in Task 3 and remove only the extra wrapper structure; the full DOM dependency removal happens in Task 5

Do not remove IDs that the webview script still relies on.

- [ ] **Step 4: Re-run the layout test**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "Dashboard Extract Layout"
```

Expected: the extraction layout test passes.

- [ ] **Step 5: Commit the extraction markup change**

```bash
git add src/dashboardExtractLayout.ts src/test/dashboardExtractLayout.test.ts
git commit -m "refactor: slim dashboard extract rail markup"
```

---

## Task 4: Rewrite The Dashboard Layout And Styles As A Command Center

**Files:**
- Modify: `src/dashboardPanel.ts`

- [ ] **Step 1: Replace the current hero-first layout inside `_getHtml()` with the compact command-center shell**

Rework the HTML so it matches the approved spec:

- compact header
- KPI strip with `Open`, `Attention`, `Completion %`
- toolbar directly above the list
- main content split: list left, support rail right
- analytics strip below

Do not keep the current large hero copy block.

- [ ] **Step 2: Replace the CSS block with the new dense visual system**

In `src/dashboardPanel.ts`:

- use neutral surfaces and thin borders
- use one accent color for active/filter/action states
- remove decorative hero styling and large gradients
- keep radius values consistent
- ensure the list visually dominates the page

Follow the approved direction, not the older gradient-heavy redesign spec.

- [ ] **Step 3: Keep analytics visible but visually secondary**

Adjust the analytics cards so they:

- remain under the main workspace
- use smaller heights and lower contrast emphasis than the list area
- preserve the existing `Next 7 days` and `Category balance` content

- [ ] **Step 4: Add responsive stacking for narrow widths**

At smaller widths, stack in this order:

1. main list
2. right rail
3. analytics strip

Ensure there is no horizontal overflow caused by filters, action clusters, or dense rows.

- [ ] **Step 5: Preserve Quick Add save-target behavior while moving the right rail**

During the layout rewrite, explicitly keep these rules intact:

- empty `Save target date` resolves to `tasks/inbox.md`
- populated `Save target date` resolves to `tasks/YYYY-MM-DD.md`
- section placement after save still follows the existing `dueDate ?? date` classification rule

- [ ] **Step 6: Run type-check and build smoke validation**

Run:

```bash
bun run check-types && node esbuild.js
```

Expected: no TypeScript or build errors.

- [ ] **Step 7: Commit the layout rewrite**

```bash
git add src/dashboardPanel.ts
git commit -m "feat: redesign dashboard into command center layout"
```

---

## Task 5: Render Dense Saved-Task Rows And Candidate Rows In One Main List

**Files:**
- Modify: `src/dashboardPanel.ts`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Add a failing unit test for candidate section rendering decisions where possible**

If practical, add a helper-level test for list grouping that proves:

- `All` renders a labeled `Candidates` section above saved-task sections when candidates exist
- `Candidate` filter still uses the `Candidates` section header
- `No candidates yet` is used only when the active filter is `Candidate` and no candidates remain

If the current code structure makes this impossible, add the helper first in Step 2 and then add the test before wiring it into HTML.

- [ ] **Step 2: Refactor the webview script data shape so saved tasks and candidates can be rendered together**

In the `_getHtml()` script block:

- stop treating `state.extractedTasks` and `state.notesExtractedTasks` as separate right-rail result feeds
- normalize them into a single candidate collection for the list renderer
- preserve source-specific metadata so rows can show whether a candidate came from Moments or Notes
- preserve extraction order when building the merged candidate collection

- [ ] **Step 3: Rewrite the task row renderer into a dense two-line layout**

Saved task rows should render:

- checkbox
- title
- actions on line 1
- compact meta lane on line 2

Candidate rows should render:

- candidate badge
- title
- `Add` / `Dismiss` actions
- `Already exists` disabled state where applicable
- source label and optional due date in the meta lane

- [ ] **Step 4: Update the main list renderer to support the `Candidates` section and candidate-specific empty state**

Implement the approved behavior:

- `All` shows the `Candidates` section first when candidates exist
- `Candidate` shows only the `Candidates` section
- candidate rows never appear inside saved-task status sections
- `No candidates yet` appears only in the `Candidate` filter when no candidate rows are available
- `No search results` appears when an active search query removes all rows that would otherwise be visible
- `No items in this filter` appears when there is no active search query and the selected non-candidate filter has no matching rows

- [ ] **Step 5: Keep `Add` state transitions aligned with the spec**

Implement this exact behavior:

- if the active filter is `Candidate`, clicking `Add` removes that candidate row immediately
- the UI stays on `Candidate`
- the newly saved task is not forced into view
- later refresh behavior and saved-task filters surface it normally

- [ ] **Step 6: Re-run focused tests and type-check**

Run:

```bash
bun run compile-tests && bun x vscode-test --grep "candidate|filterExtractedTasksForDisplay|Dashboard Extract Layout" && bun run check-types
```

Expected: candidate/filter tests pass and TypeScript remains clean.

- [ ] **Step 7: Commit the merged-list rendering change**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts src/test/dashboardExtractLayout.test.ts
git commit -m "feat: merge dashboard candidates into main task list"
```

---

## Task 6: Final Interaction Polish And End-To-End Verification

**Files:**
- Modify: `src/dashboardPanel.ts` (only if fixes are needed)
- Modify: `src/test/extension.test.ts` (only if gaps are found)
- Modify: `src/test/dashboardExtractLayout.test.ts` (only if gaps are found)

- [ ] **Step 1: Verify search, filters, and state persistence against the new rendering model**

Check the `_getHtml()` script block and make any minimal fixes needed so:

- filter chips show correct counts
- `Candidate` becomes active after successful extraction
- search matches task text, tags, file path or source note, date, due date, and candidate metadata
- `persistState()` keeps the relevant command-center state intact
- empty-state branching is correct for `No search results`, `No items in this filter`, and `No candidates yet`

- [ ] **Step 2: Verify duplicate candidate disabled-state behavior**

Ensure rows marked `Already exists`:

- render visibly in the candidate section
- disable `Add`
- keep `Dismiss` active

- [ ] **Step 3: Run the full local validation suite**

Run:

```bash
bun run check-types && bun run lint && bun run compile-tests && node esbuild.js && bun run compile:mcp && bun run test:mcp && bun x vscode-test
```

Expected: all checks pass.

- [ ] **Step 4: Perform manual dashboard verification in VS Code**

Manually verify:

- dark theme readability
- light theme readability
- Moments extraction populates candidate rows and switches to `Candidate`
- Notes extraction populates candidate rows and switches to `Candidate`
- `Add` removes one candidate row while staying on `Candidate`
- `Dismiss` removes a candidate row
- `Already exists` rows disable `Add`
- filter switching works across `Attention`, `All`, `Candidate`, and saved-task status filters
- search behavior matches task text, tags, file path or source note, date, due date, and candidate metadata
- Quick Add with empty `Save target date` writes to `tasks/inbox.md`
- Quick Add with populated `Save target date` writes to `tasks/YYYY-MM-DD.md`
- saved task `Done / Edit / Open file / Delete` still work
- narrow-width layout stacks in the approved order

- [ ] **Step 5: Commit the final polish and verification fixes**

```bash
git add src/dashboardPanel.ts src/test/extension.test.ts src/test/dashboardExtractLayout.test.ts
git commit -m "fix: finalize dashboard command center interactions"
```
