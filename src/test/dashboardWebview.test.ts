import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { normalizeExtractedTaskIdentity } from "../dashboardPanel";
import { formatDateYMD } from "../noteCommands";
import {
  createMementoStubWithValues,
  renderSettledDashboardWebviewHtml,
} from "./dashboardTestHelpers";

suite("Dashboard Webview Test Suite", () => {
  test("dashboard webview persists notes extraction state alongside moments state", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("notesFromDate: state.notesFromDate"),
      "expected persisted state to include notesFromDate",
    );
    assert.ok(
      html.includes("notesToDate: state.notesToDate"),
      "expected persisted state to include notesToDate",
    );
    assert.ok(
      html.includes("candidateTasks: state.candidateTasks"),
      "expected persisted state to include unified candidateTasks",
    );
    assert.ok(
      html.includes("candidateOrderSeed: state.candidateOrderSeed"),
      "expected persisted state to include candidate order seed",
    );
    assert.ok(
      html.includes("notesAiStatus: state.notesAiStatus"),
      "expected persisted state to include notesAiStatus",
    );
    assert.ok(
      html.includes("notesAiStatusType: state.notesAiStatusType"),
      "expected persisted state to include notesAiStatusType",
    );
  });

  test("dashboard webview defines a browser-side candidate add guard", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("function canAddDashboardCandidate(task, existingTaskKeys)"),
      "expected dashboard script to define canAddDashboardCandidate in browser scope",
    );
    assert.ok(
      html.includes("return !task.existsAlready;"),
      "expected browser-side guard to preserve the snapshot fallback logic",
    );
  });

  test("dashboard webview defines browser-side merged list helpers", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("function matchesDashboardListItemFilter(item, filter)"),
      "expected merged list filter helper in browser scope",
    );
    assert.ok(
      html.includes("function buildDashboardListViewModel(items, filter, search)"),
      "expected merged list view-model helper in browser scope",
    );
  });

  test("dashboard webview uses a flat list render path for non-All Task 1 listboard views", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("if (viewModel.flatItems && viewModel.flatItems.length > 0)"),
      "expected non-All views to use a flat-item render path without section headers",
    );
  });

  test("dashboard webview defaults the listboard filter to All and renders the full chip set", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("const filterDefinitions = ["),
      "expected dashboard script to define the filter chip set",
    );
    assert.ok(
      html.includes('{ id: "all", label: "All", count:'),
      "expected All filter chip definition in the dashboard toolbar",
    );
    assert.ok(
      html.includes('const activeClass = filter.id === state.filter ? " is-active" : "";'),
      "expected rendered filter output to include an active state contract",
    );
    assert.ok(
      html.includes(
        `return '<button type="button" class="filter-chip' + activeClass + '" data-filter="' + esc(filter.id) + '">`,
      ),
      "expected rendered filter output to bind each chip to its filter id",
    );
    assert.ok(
      html.includes("state.filter = button.dataset.filter;"),
      "expected filter buttons to drive the active filter from the rendered output contract",
    );
    assert.ok(
      html.includes('if (state.filter !== "all") {'),
      "expected the All filter to remain the primary default list view during rerenders",
    );

    for (const filterId of ["all", "today", "planned", "done"]) {
      assert.ok(
        html.includes(`{ id: "${filterId}", label:`),
        `expected ${filterId} filter chip definition in the dashboard toolbar`,
      );
    }
  });

  test("simplified filter set is exactly All/Today/Planned/Done", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(html.includes('{ id: "all", label: "All"'), "expected All filter chip");
    assert.ok(html.includes('{ id: "today", label: "Today"'), "expected Today filter chip");
    assert.ok(html.includes('{ id: "planned", label: "Planned"'), "expected Planned filter chip");
    assert.ok(html.includes('{ id: "done", label: "Done"'), "expected Done filter chip");
    assert.ok(
      !html.includes('{ id: "attention", label:'),
      "expected no Attention filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "candidate", label:'),
      "expected no Candidate filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "overdue", label:'),
      "expected no Overdue filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "upcoming", label:'),
      "expected no Upcoming filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "scheduled", label:'),
      "expected no Scheduled filter in simplified UI",
    );
    assert.ok(
      !html.includes('{ id: "backlog", label:'),
      "expected no Backlog filter in simplified UI",
    );
  });

  test("simplified section model under All renders Today/Planned/Unsorted/Done", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(html.includes('today: "Today"'), "expected Today section title mapping");
    assert.ok(html.includes('planned: "Planned"'), "expected Planned section title mapping");
    assert.ok(html.includes('unsorted: "Unsorted"'), "expected Unsorted section title mapping");
    assert.ok(html.includes('done: "Done"'), "expected Done section title mapping");
    assert.ok(
      !html.includes('overdue: "Overdue"'),
      "expected no Overdue section in simplified model",
    );
    assert.ok(
      !html.includes('upcoming: "Upcoming"'),
      "expected no Upcoming section in simplified model",
    );
    assert.ok(
      !html.includes('scheduled: "Scheduled"'),
      "expected no Scheduled section in simplified model",
    );
    assert.ok(
      !html.includes('backlog: "Backlog"'),
      "expected no Backlog section in simplified model",
    );
  });

  test("dashboard webview switches to All after extraction and tracks locally added candidate keys", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("addedCandidateKeys: state.addedCandidateKeys"),
      "expected persisted state to include locally added candidate keys",
    );
    assert.ok(
      html.includes("const locallyAddedKeys = (state.addedCandidateKeys || []).filter(Boolean);"),
      "expected browser-side existing task keys to include locally added candidates",
    );
    assert.ok(
      html.includes("state.candidateBlockShown = true;") &&
        html.includes('mergeCandidateBatch("moments", message.tasks || []);'),
      "expected moments extraction results to switch the UI to All and show candidate block",
    );
    assert.ok(
      html.includes("state.candidateBlockShown = true;") &&
        html.includes('mergeCandidateBatch("notes", message.tasks || []);'),
      "expected notes extraction results to switch the UI to All and show candidate block",
    );
    assert.ok(
      html.includes("function handleDismissExtractedAction(actionEl) {") &&
        !html.includes(
          'function handleDismissExtractedAction(actionEl) {\n      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);\n      const visibleCandidates = getVisibleCandidates();\n      if (Number.isNaN(index) || !visibleCandidates[index]) {\n        return;\n      }\n\n      const task = visibleCandidates[index];\n      state.candidateTasks = (state.candidateTasks || []).filter(function (candidate) {\n        return candidate.order !== task.order;\n      });\n      state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {',
        ),
      "expected dismiss handling to keep local duplicate guard keys intact",
    );
  });

  test("dashboard webview flat filter subtitles never render undefined in Task 1 listboard views", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes('const subtitle = state.filter === "all"') &&
        html.includes("? simplifiedSectionDescriptions[section.key]") &&
        html.includes(': "filtered items";'),
      "expected flat filter subtitles to fall back to a defined label instead of undefined",
    );
  });

  test("dashboard webview All grouped subtitles keep section-specific copy in Task 1 listboard views", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes('state.filter === "all"') &&
        html.includes("? simplifiedSectionDescriptions[section.key]"),
      "expected grouped All sections to keep their specific section description text",
    );
  });

  test("dashboard webview restores notes extraction inputs and status from persisted state", async () => {
    const html = await renderSettledDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        notesFromDate: "2026-03-20",
        notesToDate: "2026-03-25",
        notesAiStatus: "cached notes status",
        notesAiStatusType: "processing",
      }),
    );

    assert.ok(
      html.includes('const notesFromDateInput = document.getElementById("notes-from-date");'),
      "expected notes from input to be synchronized on load",
    );
    assert.ok(
      html.includes('const notesToDateInput = document.getElementById("notes-to-date");'),
      "expected notes to input to be synchronized on load",
    );
    assert.ok(
      html.includes("notesFromDateInput.value = state.notesFromDate;"),
      "expected persisted notes from date to be restored",
    );
    assert.ok(
      html.includes("notesToDateInput.value = state.notesToDate;"),
      "expected persisted notes to date to be restored",
    );
    assert.ok(
      html.includes("setNotesAiStatus(state.notesAiStatusType, state.notesAiStatus);"),
      "expected persisted notes status to be restored",
    );
  });

  test("dashboard webview migrates legacy added extracted keys into unified candidate keys", async () => {
    const html = await renderSettledDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        extractedTasks: [
          {
            kind: "candidate",
            text: "Legacy moments task",
            dueDate: null,
            category: "work",
            priority: "medium",
            timeEstimateMin: 15,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
          },
        ],
        notesExtractedTasks: [
          {
            kind: "candidate",
            text: "Legacy notes task",
            dueDate: null,
            category: "admin",
            priority: "low",
            timeEstimateMin: 10,
            source: "notes",
            sourceLabel: "projects/plan.md",
            existsAlready: false,
          },
        ],
        addedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy moments task")],
        notesAddedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy notes task")],
      }),
    );

    assert.ok(
      html.includes("addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)"),
      "expected migrated candidate keys to seed unified local duplicate tracking",
    );
  });

  test("dashboard webview browser migration guards malformed persisted candidates", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("function normalizeStoredCandidateTask(") &&
        html.includes('if (!task || typeof task !== "object") {') &&
        html.includes(
          'const text = sanitizeBrowserTaskText(typeof task.text === "string" ? task.text : "");',
        ),
      "expected browser-side candidate migration to ignore malformed persisted candidate entries before initial render",
    );
  });

  test("dashboard webview renders the minimal shell in the approved order", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    const headerIndex = html.indexOf('id="dashboard-header"');
    const addRowIndex = html.indexOf('id="dash-add-row"');
    const extractRowIndex = html.indexOf('id="dash-extract-row"');
    const listBarIndex = html.indexOf('id="dash-list-bar"');
    const listIndex = html.indexOf('id="dashboard-main-list"');

    assert.ok(headerIndex >= 0, "expected compact header marker");
    assert.ok(addRowIndex >= 0, "expected add task row marker");
    assert.ok(extractRowIndex >= 0, "expected extract row marker");
    assert.ok(listBarIndex >= 0, "expected list bar marker");
    assert.ok(listIndex >= 0, "expected main list marker");

    // Old heavy UI elements removed
    assert.ok(!html.includes('id="dashboard-toolbar"'), "expected old toolbar to be removed");
    assert.ok(!html.includes('id="dashboard-action-bar"'), "expected old action bar to be removed");
    assert.ok(!html.includes('id="analytics-strip"'), "expected analytics strip to be removed");
    assert.ok(!html.includes('id="dashboard-kpis"'), "expected old KPI strip shell to be removed");
    assert.ok(
      !html.includes('id="dashboard-workspace"'),
      "expected old split workspace shell to be removed",
    );
    assert.ok(
      !html.includes('id="support-rail"'),
      "expected right-side support rail shell to be removed",
    );

    // Order: header → add row → extract row → list bar → main list
    assert.ok(headerIndex < addRowIndex, "expected header before add row");
    assert.ok(addRowIndex < extractRowIndex, "expected add row before extract row");
    assert.ok(extractRowIndex < listBarIndex, "expected extract row before list bar");
    assert.ok(listBarIndex < listIndex, "expected list bar before main list");
  });

  test("dashboard webview removes the old hero-first shell and attention KPI chip", async () => {
    const html = await renderSettledDashboardWebviewHtml((notesDir) => {
      const overdueDate = new Date();
      overdueDate.setDate(overdueDate.getDate() - 1);
      const overdueYmd = formatDateYMD(overdueDate);
      const overdueFile = path.join(notesDir, "tasks", `${overdueYmd}.md`);
      fs.mkdirSync(path.dirname(overdueFile), { recursive: true });
      fs.writeFileSync(
        overdueFile,
        `---\ntype: tasks\ndate: ${overdueYmd}\n---\n\n- [ ] Overdue task\n`,
        "utf8",
      );
    });

    assert.ok(!html.includes('<section class="hero">'), "expected old hero block to be removed");
    assert.ok(
      !html.includes('class="summary-card is-warning"'),
      "expected old overdue KPI card to be removed",
    );
    assert.ok(
      !html.includes('<div class="summary-label">Overdue</div>'),
      "expected overdue KPI label to be removed",
    );
    assert.ok(
      !html.includes('id="dashboard-kpi-attention"'),
      "expected attention KPI chip to be removed",
    );
    assert.ok(!html.includes(">Attention<"), "expected Attention label to be removed from header");
  });

  test("dashboard webview persists extracted results immediately on message receipt", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes(
        'mergeCandidateBatch("moments", message.tasks || []);\n        persistState();\n        rerender();',
      ),
      "expected extractResult handler to merge unified candidates before rerendering",
    );
    assert.ok(
      html.includes(
        'mergeCandidateBatch("notes", message.tasks || []);\n        persistState();\n        rerender();',
      ),
      "expected notesExtractResult handler to merge unified candidates before rerendering",
    );
  });

  test("dashboard webview keeps the support rail free of candidate cards", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      !html.includes('class="ai-result" id="ai-result"'),
      "expected support rail to drop moments candidate card rendering",
    );
    assert.ok(
      !html.includes('class="ai-result" id="notes-extract-result"'),
      "expected support rail to drop notes candidate card rendering",
    );
  });

  test("dashboard webview renders an inline candidate block below Extract", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes('id="candidate-block"'),
      "expected dedicated candidate block container",
    );
    assert.ok(html.includes('id="dashboard-main-list"'), "expected main list container");

    const extractIdx = html.indexOf('id="dash-extract-row"');
    const candidateIdx = html.indexOf('id="candidate-block"');
    const listIdx = html.indexOf('id="dashboard-main-list"');
    assert.ok(extractIdx >= 0, "expected extract row marker");
    assert.ok(candidateIdx >= 0, "expected candidate block marker");
    assert.ok(listIdx >= 0, "expected main list marker");
    assert.ok(
      extractIdx < candidateIdx && candidateIdx < listIdx,
      "expected candidate block between extract and main list",
    );
  });

  test("dashboard webview renders non-interactive header KPI chips", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(html.includes('id="dashboard-kpi-open"'), "expected Open KPI chip");
    assert.ok(html.includes('id="dashboard-kpi-today"'), "expected Today KPI chip");
    assert.ok(html.includes('id="dashboard-kpi-done"'), "expected Done % KPI chip");
    assert.ok(
      !html.includes("data-kpi-filter="),
      "expected no data-kpi-filter attributes on chips",
    );
    assert.ok(
      !html.includes('document.querySelectorAll("[data-kpi-filter]")'),
      "expected no KPI filter click wiring",
    );
  });

  test("dashboard webview keeps minimal header with KPI chips only", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(html.includes('id="dashboard-header"'), "expected header marker");
    assert.ok(
      html.includes('id="dashboard-kpi-open"') && html.includes(">Open<"),
      "expected Open KPI chip label",
    );
    assert.ok(
      html.includes('id="dashboard-kpi-today"') && html.includes(">Today<"),
      "expected Today KPI chip label",
    );
    assert.ok(
      html.includes('id="dashboard-kpi-done"') && html.includes(">Done<"),
      "expected Done KPI chip label",
    );
    assert.ok(
      !html.includes("data-kpi-filter="),
      "expected no data-kpi-filter attributes on header chips",
    );
    assert.ok(
      !html.includes('document.querySelectorAll("[data-kpi-filter]")'),
      "expected no KPI filter click wiring in browser script",
    );
    assert.ok(html.includes('id="btn-refresh"'), "expected refresh action in header");

    // Date label and weekday marker removed for minimal UI
    assert.ok(!html.includes('id="dashboard-date-label"'), "expected date label to be removed");
    assert.ok(
      !html.includes('id="dashboard-weekday-marker"'),
      "expected weekday marker to be removed",
    );

    assert.ok(
      html.includes(".dashboard-kpi-value {") &&
        html.includes("font-variant-numeric: tabular-nums;"),
      "expected KPI numbers to use tabular alignment",
    );
  });

  test("dashboard webview uses compact single-line add and extract rows", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    // Single-line add row with input + button
    assert.ok(
      html.includes('id="dash-add-row"') &&
        html.includes('id="new-task-text"') &&
        html.includes('id="btn-create-task"'),
      "expected compact add row with input and button",
    );

    // Compact extract row
    assert.ok(
      html.includes('id="dash-extract-row"') &&
        html.includes('id="btn-ai-extract"') &&
        html.includes('id="btn-extract-notes"') &&
        html.includes('id="btn-extract-advanced"') &&
        html.includes('id="extract-advanced-panel"'),
      "expected compact extract row",
    );

    // Old heavy action bar removed
    assert.ok(!html.includes('id="dashboard-action-bar"'), "expected old action bar to be removed");
    assert.ok(
      !html.includes('class="action-panel action-panel-quick-add"'),
      "expected old quick add panel to be removed",
    );
    assert.ok(
      !html.includes('class="action-panel action-panel-ai-extract"'),
      "expected old ai extract panel to be removed",
    );
    // Old section header labels removed (but text may still appear in empty states)
    assert.ok(!html.includes(">Quick Add<"), "expected Quick Add header label to be removed");
    assert.ok(!html.includes(">AI Extract<"), "expected AI Extract header label to be removed");
    assert.ok(
      html.includes(
        'document.getElementById("btn-ai-extract").addEventListener("click", function () {',
      ) &&
        html.includes(
          'document.getElementById("btn-extract-notes").addEventListener("click", function () {',
        ),
      "expected extraction commands to stay wired from the top action bar",
    );
    assert.ok(
      html.includes('const aiStatus = document.getElementById("ai-status");') &&
        html.includes('const notesStatus = document.getElementById("notes-extract-status");'),
      "expected extraction status updates to remain attached to their control groups",
    );
    assert.ok(
      html.includes('data-action="add-candidate"') &&
        html.includes('data-action="dismiss-candidate"'),
      "expected candidate Add and Dismiss actions to remain wired",
    );
    assert.ok(
      html.includes("Already exists") &&
        html.includes("canAddDashboardCandidate(task, existingTaskKeys)") &&
        html.includes('data-action="add-candidate"') &&
        html.includes('data-action="dismiss-candidate"'),
      "expected duplicate candidates to remain blocked with Already exists",
    );
    assert.ok(
      !html.includes('id="support-rail"'),
      "expected extract controls to stay out of a right rail",
    );
  });

  test("dashboard action bar stacks only below 1000px", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("@media (width < 1000px) {") &&
        html.includes(".dashboard-action-bar {\n      grid-template-columns: 1fr;"),
      "expected action bar stacking rule to start only below 1000px",
    );
    assert.ok(
      !html.includes("@media (max-width: 1000px) {\n    .dashboard-action-bar {"),
      "expected action bar not to stack at exactly 1000px",
    );
  });

  test("dashboard webview keeps saved-row interaction rules in dense listboard rows", async () => {
    const html = await renderSettledDashboardWebviewHtml();
    const secondaryActionsClusterMatch = html.match(
      /<div class="task-row-secondary-actions">([\s\S]*?)<\/div>/,
    );

    assert.ok(
      html.includes('class="task-row-toggle"') &&
        html.includes('data-action="toggle"') &&
        !html.includes('data-action="toggle" data-file='),
      "expected the checkbox toggle to remain the only done-toggle control",
    );
    assert.ok(
      html.includes('class="task-row-title"') &&
        html.includes('data-action="open"') &&
        !html.includes('class="task-row-title" data-action="edit"'),
      "expected the task title to remain the Open control",
    );
    // At desktop widths, secondary actions are revealed by hover/focus as icon-only buttons
    assert.ok(
      html.includes('class="task-row-secondary-actions"') &&
        html.includes("task-row:hover .task-row-secondary-actions") &&
        html.includes("task-row:focus-within .task-row-secondary-actions") &&
        secondaryActionsClusterMatch !== null &&
        secondaryActionsClusterMatch[1].includes(
          'class="task-row-action-icon" data-action="edit"',
        ) &&
        secondaryActionsClusterMatch[1].includes(
          'class="task-row-action-icon" data-action="open"',
        ) &&
        secondaryActionsClusterMatch[1].includes(
          'class="task-row-action-icon" data-action="delete"',
        ) &&
        secondaryActionsClusterMatch[1].includes('aria-label="Edit"') &&
        secondaryActionsClusterMatch[1].includes('aria-label="Open"') &&
        secondaryActionsClusterMatch[1].includes('aria-label="Delete"') &&
        !secondaryActionsClusterMatch[1].includes(">Edit</button>") &&
        !secondaryActionsClusterMatch[1].includes(">Open</button>") &&
        !secondaryActionsClusterMatch[1].includes(">Delete</button>"),
      "expected saved-row secondary actions to render as icon buttons with Edit/Open/Delete aria labels when revealed by hover or focus-within",
    );
    assert.ok(
      html.includes("task-row-saved") &&
        html.includes('tabindex="-1"') &&
        html.includes('class="task-row-toggle-entry"') &&
        html.includes('class="task-row-title-entry"'),
      "expected checkbox and title entry points to reveal secondary actions for keyboard users",
    );
    // At narrow widths, secondary actions collapse into a More menu
    const narrowMoreMenuRule =
      /@media \(max-width: 720px\) \{[\s\S]*?\.task-row-secondary-actions \{[\s\S]*?display: none;[\s\S]*?\.task-row-more-menu \{[\s\S]*?display: block;[\s\S]*?\}/;
    assert.ok(
      narrowMoreMenuRule.test(html),
      "expected narrow layouts to collapse secondary actions into a More menu for touch access",
    );
  });

  test("dashboard webview shows narrow-width More menu for saved-task rows", async () => {
    const html = await renderSettledDashboardWebviewHtml();
    const moreDropdownMarkupMatch = html.match(
      /<div class="task-row-more-dropdown" data-more-dropdown="[^"]+">([\s\S]*?)<\/div>/,
    );

    // More menu is hidden at desktop widths
    assert.ok(
      html.includes(".task-row-more-menu { display: none; position: relative; }") ||
        html.includes(".task-row-more-menu{display:none;position:relative}"),
      "expected More menu to be hidden at desktop widths",
    );

    // More menu becomes visible at narrow widths, secondary actions hide
    const narrowMoreMenuRule =
      /@media \(max-width: 720px\) \{[\s\S]*?\.task-row-more-menu \{[\s\S]*?display: block;[\s\S]*?\}/;
    assert.ok(narrowMoreMenuRule.test(html), "expected More menu to be visible at narrow widths");

    // Each saved-task row has a More button
    assert.ok(
      html.includes('data-action="more"') || html.includes('class="task-row-more-btn"'),
      "expected saved-task rows to have a More button",
    );

    // More dropdown contains visible Edit, Open, Delete text actions
    assert.ok(
      moreDropdownMarkupMatch !== null &&
        moreDropdownMarkupMatch[1].includes('data-action="edit"') &&
        moreDropdownMarkupMatch[1].includes(">Edit</button>") &&
        moreDropdownMarkupMatch[1].includes('data-action="open"') &&
        moreDropdownMarkupMatch[1].includes(">Open</button>") &&
        moreDropdownMarkupMatch[1].includes('data-action="delete"') &&
        moreDropdownMarkupMatch[1].includes(">Delete</button>"),
      "expected More dropdown to keep visible Edit, Open, and Delete text actions at narrow widths",
    );
  });

  test("dashboard webview renders candidate rows with duplicate handling", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("function renderCandidateItem(task, index)") &&
        html.includes("task-row-candidate") &&
        html.includes('badge task-row-label">Candidate</span>'),
      "expected candidate rows to render with proper styling",
    );
    assert.ok(
      html.includes(">Already exists</span>") &&
        html.includes('data-action="dismiss-candidate"') &&
        html.includes('data-action="add-candidate"') &&
        html.includes(' data-index="') &&
        html.includes(" disabled") &&
        html.includes(">Add</button>"),
      "expected duplicate candidate rows to keep Dismiss, keep Add visible but disabled, and still communicate Already exists",
    );
    assert.ok(
      html.includes(".task-row-candidate .task-row-title {") &&
        html.includes("white-space: normal;") &&
        html.includes("-webkit-line-clamp: 2;") &&
        html.includes("display: -webkit-box;"),
      "expected candidate row titles to stay readable with a compact two-line clamp",
    );
    assert.ok(
      html.includes(".task-row-candidate .task-row-title {"),
      "expected candidate title rule",
    );
    assert.ok(html.includes("cursor: default;"), "expected non-clickable candidate cursor");
    assert.ok(
      !html.includes(".task-row-candidate .task-row-title:hover {"),
      "expected no candidate-specific hover rule",
    );
    assert.ok(
      html.includes(".task-row-saved .task-row-title:hover {"),
      "expected saved-task hover rule to remain",
    );
    assert.ok(
      !/^\s*\.task-row-title:hover \{/m.test(html),
      "expected shared hover rule to be removed",
    );
  });

  test("dashboard webview keeps dense metadata priority for saved and candidate rows", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes('class="task-row-meta task-row-meta-saved"'),
      "expected saved-task metadata container",
    );
    assert.ok(
      html.indexOf("task-row-meta-date") < html.indexOf("task-row-meta-tag") &&
        html.indexOf("task-row-meta-tag") < html.indexOf("task-row-meta-source-saved"),
      "expected saved-task rows to keep date and due metadata before tags before source",
    );
    assert.ok(html.includes("task-row-meta-due"), "expected saved-task due metadata class");
    assert.ok(
      html.includes('class="task-row-meta task-row-meta-candidate"'),
      "expected candidate metadata container",
    );
    assert.ok(
      html.indexOf("task-row-meta-candidate-due") < html.indexOf("task-row-meta-category") &&
        html.indexOf("task-row-meta-category") < html.indexOf("task-row-meta-source-candidate"),
      "expected candidate rows to keep due/date before category or priority before source",
    );
    assert.ok(
      html.includes("task-row-meta-priority"),
      "expected candidate priority metadata class",
    );
    assert.ok(
      html.includes(".task-row-meta {") &&
        html.includes("flex-wrap: nowrap;") &&
        html.includes("overflow: hidden;") &&
        html.includes(".task-row-meta-source {") &&
        html.includes("min-width: 0;") &&
        html.includes("text-overflow: ellipsis;") &&
        html.includes("white-space: nowrap;"),
      "expected source metadata to truncate first without uncontrolled wrapping that destroys density",
    );
  });

  test("dashboard webview removes analytics strip for minimal UI", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    // Analytics strip removed for cleaner, action-focused UI
    assert.ok(!html.includes('id="analytics-strip"'), "expected analytics strip to be removed");
    assert.ok(!html.includes("week-chart"), "expected week chart to be removed");
    assert.ok(!html.includes("category-list"), "expected category list to be removed");
  });

  test("dashboard webview renders final compact empty-state copy for All", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("function renderEmptyState(message) {") &&
        html.includes('class="empty-state-title"') &&
        html.includes('class="empty-state-body"'),
      "expected empty states to render compact structured messaging",
    );
    assert.ok(
      html.includes('"No tasks yet||Use Add Task or AI Extract to create your first task."'),
      "expected All empty state to direct users to Add Task or AI Extract",
    );
  });

  test("dashboard webview renders simplified empty-state messages for all filters", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes('"Nothing scheduled for today"'),
      "expected Today empty state to show a positive nothing-scheduled message",
    );
    assert.ok(
      html.includes('"No planned tasks"'),
      "expected Planned empty state to show no planned tasks message",
    );
    assert.ok(
      html.includes('"No completed tasks"'),
      "expected Done empty state to show no completed tasks message",
    );
    assert.ok(
      html.includes('"No matching tasks"'),
      "expected search empty state to show no matching tasks message",
    );
    assert.ok(
      html.includes("No candidates yet"),
      "expected candidate empty state to show no candidates yet message",
    );
  });

  test("dashboard webview script keeps interactive controls wired after initial render", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, "expected dashboard webview to include an inline script block");

    const script = scriptMatch?.[1] || "";
    assert.doesNotThrow(
      () => new Function("acquireVsCodeApi", "document", "window", script),
      "expected dashboard webview script to stay parseable for runtime initialization",
    );
    assert.ok(
      script.includes(
        'document.getElementById("btn-create-task").addEventListener("click", function () {',
      ) &&
        script.includes(
          'document.getElementById("btn-ai-extract").addEventListener("click", function () {',
        ) &&
        script.includes(
          'document.getElementById("btn-extract-notes").addEventListener("click", function () {',
        ),
      "expected dashboard webview script to keep all primary button handlers registered",
    );
    assert.ok(
      script.includes(
        'throw new Error("Task Dashboard failed to initialize required webview controls.");',
      ),
      "expected dashboard webview script to fail loudly when required controls are missing",
    );
  });

  test("dashboard webview aligns browser-side candidate identity normalization with multiline task sanitization", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("function sanitizeBrowserTaskText(text)"),
      "expected browser-side task identity normalization helper to exist",
    );
    assert.ok(
      html.includes('.join(" / ")'),
      "expected browser-side task identity normalization to join lines like extension-side sanitization",
    );
  });

  test("dashboard webview defines candidate add ACK handlers with rollback support", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes('if (message.type === "candidateAddResult")'),
      "expected browser-side success ACK handling for extracted candidate adds",
    );
    assert.ok(
      html.includes('if (message.type === "candidateAddFailed")'),
      "expected browser-side failure ACK handling for extracted candidate adds",
    );
    assert.ok(
      html.includes(
        "candidate.order === pending.order ? { ...candidate, added: false } : candidate",
      ),
      "expected failure ACK handling to roll candidate rows back into view",
    );
    assert.ok(
      !html.includes(
        'if (state.filter === "candidate") {\n        state.candidateTasks = state.candidateTasks.filter',
      ),
      "expected optimistic add to keep candidate rows in state so failure rollback can restore them",
    );
    assert.ok(
      html.includes('if (pending && pending.source === "notes")'),
      "expected failure rollback to route notes candidate errors to the notes status line",
    );
  });

  test("candidate block failure displays error message at top of block and clears on next success", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("state.candidateBlockError"),
      "expected state to track candidateBlockError for block-level failure display",
    );
    assert.ok(
      html.includes('class="candidate-block-error"'),
      "expected candidate block to render error with candidate-block-error class",
    );
    assert.ok(
      (html.includes("candidateBlockError") && html.includes("next extract")) ||
        html.includes("extractResult") ||
        html.includes("notesExtractResult"),
      "expected block error to clear on next extract from either source",
    );
  });

  // ---------------------------------------------------------------------------
  // Candidate persistence tests (Task 4)
  // ---------------------------------------------------------------------------

  test("dashboard webview persists candidateTasks with extractRunAt timestamps", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("extractRunAt"),
      "expected persisted candidate state to include extractRunAt timestamp",
    );
  });

  test("dashboard webview restores unresolved candidates with extractRunAt on reopen", async () => {
    const extractRunAt = "2026-04-01T10:00:00.000Z";
    const html = await renderSettledDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        candidateTasks: [
          {
            kind: "candidate",
            text: "Persisted candidate",
            dueDate: null,
            category: "work",
            priority: "medium",
            timeEstimateMin: 15,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
            order: 0,
            added: false,
            extractRunAt,
          },
        ],
        candidateOrderSeed: 1,
        addedCandidateKeys: [],
      }),
    );

    const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, "expected dashboard webview to include an inline script block");
    const script = scriptMatch?.[1] || "";

    assert.ok(
      script.includes("extractRunAt"),
      "expected browser script to handle extractRunAt when restoring persisted candidates",
    );
    assert.ok(
      script.includes("savedState.candidateTasks"),
      "expected browser script to restore candidateTasks from saved state",
    );
  });

  test("dashboard webview preserves stored display order when restoring persisted candidates", async () => {
    const html = await renderSettledDashboardWebviewHtml(
      undefined,
      createMementoStubWithValues({
        candidateTasks: [
          {
            kind: "candidate",
            text: "First candidate",
            dueDate: null,
            category: "work",
            priority: "medium",
            timeEstimateMin: 15,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
            order: 5,
            added: false,
            extractRunAt: "2026-04-01T10:00:00.000Z",
          },
          {
            kind: "candidate",
            text: "Second candidate",
            dueDate: null,
            category: "admin",
            priority: "low",
            timeEstimateMin: 10,
            source: "notes",
            sourceLabel: "projects/plan.md",
            existsAlready: false,
            order: 3,
            added: false,
            extractRunAt: "2026-04-01T09:00:00.000Z",
          },
        ],
        candidateOrderSeed: 6,
        addedCandidateKeys: [],
      }),
    );

    const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/);
    assert.ok(scriptMatch, "expected dashboard webview to include an inline script block");
    const script = scriptMatch?.[1] || "";

    assert.ok(
      script.includes("bRunAt.localeCompare(aRunAt)"),
      "expected getVisibleCandidates to sort by extractRunAt desc for cross-batch ordering",
    );
  });

  // ---------------------------------------------------------------------------
  // Re-extract rules tests (Task 4)
  // ---------------------------------------------------------------------------

  test("dashboard webview script defines mergeCandidateBatch with extractRunAt ordering", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("extractRunAt"),
      "expected mergeCandidateBatch to set extractRunAt on merged candidates",
    );
  });

  test("dashboard webview getVisibleCandidates sorts by extractRunAt desc then order", async () => {
    const html = await renderSettledDashboardWebviewHtml();

    assert.ok(
      html.includes("extractRunAt"),
      "expected getVisibleCandidates to sort by extractRunAt for cross-batch ordering",
    );
  });
});
