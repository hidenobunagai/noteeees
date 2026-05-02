import * as assert from "assert";
import { type ExtractedTask } from "../aiTaskProcessor";
import {
  buildDashboardCandidateViews,
  buildDashboardListItems,
  buildDashboardListViewModel,
  buildDashboardTaskViews,
  buildUpcomingWeek,
  canAddDashboardCandidate,
  classifyDashboardTask,
  countDashboardListItemsForFilter,
  filterExtractedTasksForDisplay,
  matchesDashboardListItemFilter,
  migrateDashboardCandidateState,
  normalizeDashboardTaskText,
  normalizeExtractedTaskIdentity,
  resolveDashboardTaskFile,
  upsertDashboardDueDate,
  type DashboardListItem,
} from "../dashboardPanel";
import {
  buildExtractedTaskFailureMessage,
  buildExtractedTaskStatusMessage,
} from "../dashboardTaskUtils";
import { createDashboardPanelMessageHarness } from "./dashboardTestHelpers";

suite("Dashboard Core Test Suite", () => {
  test("dashboard list view model uses final compact empty-state messaging", () => {
    const noTasksAtAll = buildDashboardListViewModel([], "all", "");
    assert.strictEqual(
      noTasksAtAll.emptyMessage,
      "No tasks yet||Use Add Task or AI Extract to create your first task.",
    );

    const noToday = buildDashboardListViewModel([], "today", "");
    assert.strictEqual(noToday.emptyMessage, "Nothing scheduled for today");

    const noPlanned = buildDashboardListViewModel([], "planned", "");
    assert.strictEqual(noPlanned.emptyMessage, "No planned tasks");

    const noDone = buildDashboardListViewModel([], "done", "");
    assert.strictEqual(noDone.emptyMessage, "No completed tasks");
  });

  test("addExtractedTask posts a failure ACK when createTask fails", async () => {
    const harness = createDashboardPanelMessageHarness();
    const panelWithPrivates = harness.panel as unknown as {
      _createTask: (
        text: string,
        targetDate: string | null,
        dueDate: string | null,
      ) => Promise<void>;
      _handleMessage(message: Record<string, unknown>): void;
    };
    const originalCreateTask = panelWithPrivates._createTask;

    try {
      panelWithPrivates._createTask = async () => {
        throw new Error("disk full");
      };

      panelWithPrivates._handleMessage({
        command: "addExtractedTask",
        requestId: "candidate-1",
        text: "Broken task",
        dueDate: null,
        targetDate: null,
      });

      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (
          harness.messages.some(
            (message: Record<string, unknown>) =>
              message.type === "candidateAddFailed" && message.requestId === "candidate-1",
          )
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      assert.ok(
        harness.messages.some(
          (message: Record<string, unknown>) =>
            message.type === "candidateAddFailed" &&
            message.requestId === "candidate-1" &&
            typeof message.message === "string",
        ),
        "expected addExtractedTask to notify the webview when persistence fails",
      );
    } finally {
      panelWithPrivates._createTask = originalCreateTask;
      harness.cleanup();
    }
  });

  test("dashboard task text normalization collapses multiline input", () => {
    assert.strictEqual(
      normalizeDashboardTaskText("  first line  \n\n second line \nthird "),
      "first line / second line / third",
    );
  });

  test("dashboard due date upsert replaces existing markers", () => {
    assert.strictEqual(
      upsertDashboardDueDate("Follow up due:2026-03-01 #work", "2026-03-05"),
      "Follow up #work @2026-03-05",
    );
    assert.strictEqual(
      upsertDashboardDueDate("Review sync #due:2026-03-01 #team", "2026-03-07"),
      "Review sync #team @2026-03-07",
    );
    assert.strictEqual(upsertDashboardDueDate("Review spec @2026-03-01", null), "Review spec");
  });

  test("normalizeExtractedTaskIdentity collapses due markers and formatting noise", () => {
    assert.strictEqual(
      normalizeExtractedTaskIdentity("  Send   report due:2026-04-01  "),
      "send report",
    );
    assert.strictEqual(normalizeExtractedTaskIdentity("整理する @2026-04-02"), "整理する");
    assert.strictEqual(normalizeExtractedTaskIdentity("確認する #due:2026-04-03"), "確認する");
    assert.strictEqual(
      normalizeExtractedTaskIdentity("  First line  \n\n second line due:2026-04-02  "),
      "first line / second line",
    );
  });

  test("filterExtractedTasksForDisplay hides dismissed and duplicate candidates but keeps existing matches visible", () => {
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
          dueDate: null,
        },
        {
          text: "Review budget due:2026-03-31",
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          dueDate: "2026-03-31",
        },
        {
          text: "Organize receipts",
          category: "admin",
          priority: "low",
          timeEstimateMin: 15,
          dueDate: null,
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
      [
        {
          key: normalizeExtractedTaskIdentity("Organize receipts"),
          dismissedAt: "2026-03-20",
        },
      ],
      "2026-03-27",
    );

    assert.deepStrictEqual(
      result.visibleTasks.map((task) => task.text),
      ["Send report", "Review budget"],
    );
    assert.strictEqual((result.visibleTasks[0] as { existsAlready?: boolean }).existsAlready, true);
    assert.strictEqual(
      (result.visibleTasks[1] as { existsAlready?: boolean }).existsAlready,
      false,
    );
    assert.strictEqual(result.hiddenExisting, 0);
    assert.strictEqual(result.hiddenDismissed, 1);
    assert.strictEqual(result.hiddenDuplicates, 1);
  });

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
        {
          text: "Review budget due:2026-03-31",
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          dueDate: "2026-03-31",
        },
        {
          text: "Organize receipts",
          category: "admin",
          priority: "low",
          timeEstimateMin: 15,
          dueDate: null,
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
      [
        {
          key: normalizeExtractedTaskIdentity("Organize receipts"),
          dismissedAt: "2026-03-20",
        },
      ],
      "2026-03-27",
    );

    assert.deepStrictEqual(
      result.visibleTasks.map((task) => task.text),
      ["Send report", "Review budget"],
    );
    assert.strictEqual("existsAlready" in result.visibleTasks[0], true);
    assert.strictEqual((result.visibleTasks[0] as { existsAlready?: boolean }).existsAlready, true);
    assert.strictEqual(
      (result.visibleTasks[1] as { existsAlready?: boolean }).existsAlready,
      false,
    );
    assert.strictEqual(result.hiddenExisting, 0);
    assert.strictEqual(result.hiddenDismissed, 1);
    assert.strictEqual(result.hiddenDuplicates, 1);
  });

  test("filterExtractedTasksForDisplay ignores malformed extracted entries instead of throwing", () => {
    const extracted = [
      null,
      {},
      {
        text: "   ",
      },
      {
        text: "Plan retro",
        category: "work",
        priority: "medium",
        timeEstimateMin: 25,
        dueDate: null,
      },
    ] as unknown as ExtractedTask[];

    const result = filterExtractedTasksForDisplay(extracted, [], [], "2026-03-27");

    assert.deepStrictEqual(
      result.visibleTasks.map((task) => task.text),
      ["Plan retro"],
    );
    assert.strictEqual(result.hiddenDismissed, 0);
    assert.strictEqual(result.hiddenDuplicates, 0);
  });

  test("canAddDashboardCandidate rejects already-existing candidates", () => {
    assert.strictEqual(
      canAddDashboardCandidate({
        kind: "candidate",
        text: "Send report",
        dueDate: null,
        category: "work",
        priority: "high",
        timeEstimateMin: 30,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: true,
      }),
      false,
    );

    assert.strictEqual(
      canAddDashboardCandidate(
        {
          kind: "candidate",
          text: "Review budget",
          dueDate: null,
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          source: "moments",
          sourceLabel: "Moments",
          existsAlready: false,
        },
        new Set([normalizeExtractedTaskIdentity("Review budget @2026-03-31")]),
      ),
      false,
    );

    assert.strictEqual(
      canAddDashboardCandidate({
        kind: "candidate",
        text: "Review budget",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 20,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      }),
      true,
    );
  });

  test("filterExtractedTasksForDisplay preserves notes candidate source metadata", () => {
    const result = filterExtractedTasksForDisplay(
      [
        {
          text: "Plan retro",
          category: "work",
          priority: "medium",
          timeEstimateMin: 25,
          dueDate: null,
          sourceNote: "projects/retro.md",
        },
      ],
      [
        {
          id: "tasks/inbox.md:4",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 4,
          text: "Plan retro @2026-03-29",
          done: false,
          date: null,
          dueDate: "2026-03-29",
          tags: [],
        },
      ],
      [],
      "2026-03-27",
    );

    assert.strictEqual(result.visibleTasks.length, 1);
    assert.strictEqual(result.visibleTasks[0].source, "notes");
    assert.strictEqual(result.visibleTasks[0].sourceLabel, "projects/retro.md");
    assert.strictEqual(result.visibleTasks[0].existsAlready, true);
    assert.strictEqual(
      canAddDashboardCandidate(
        result.visibleTasks[0],
        new Set([normalizeExtractedTaskIdentity("Plan retro")]),
      ),
      false,
    );
  });

  test("simplified filter routes saved task rows correctly", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Overdue saved",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: ["#work"],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: ["#admin"],
        },
        {
          id: "tasks/inbox.md:3",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 3,
          text: "Done saved",
          done: true,
          date: null,
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidateViews = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Candidate first",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
      {
        kind: "candidate",
        text: "Candidate second",
        dueDate: "2026-03-29",
        category: "admin",
        priority: "low",
        timeEstimateMin: 10,
        source: "notes",
        sourceLabel: "projects/plan.md",
        existsAlready: false,
      },
    ]);
    const listItems = buildDashboardListItems(savedTasks, candidateViews);
    const visibleAll = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "all"),
    );
    const visibleToday = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "today"),
    );
    const visibleDone = listItems.filter((item: DashboardListItem) =>
      matchesDashboardListItemFilter(item, "done"),
    );

    assert.deepStrictEqual(
      visibleAll.map((item) => item.text),
      ["Overdue saved", "Today saved", "Done saved", "Candidate first", "Candidate second"],
    );
    assert.deepStrictEqual(
      visibleToday.map((item) => item.text),
      ["Overdue saved", "Today saved"],
    );
    assert.deepStrictEqual(
      visibleDone.map((item) => item.text),
      ["Done saved"],
    );

    for (const filter of [
      "overdue",
      "today",
      "upcoming",
      "scheduled",
      "backlog",
      "done",
    ] as const) {
      assert.strictEqual(
        listItems.some(
          (item: DashboardListItem) =>
            item.kind === "candidate" && matchesDashboardListItemFilter(item, filter),
        ),
        false,
      );
    }
  });

  test("simplified filter counts saved task rows only", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-27.md:1",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 1,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidateViews = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Candidate first",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
      {
        kind: "candidate",
        text: "Candidate second",
        dueDate: null,
        category: "work",
        priority: "low",
        timeEstimateMin: 10,
        source: "notes",
        sourceLabel: "projects/plan.md",
        existsAlready: false,
      },
    ]);

    const listItems = buildDashboardListItems(savedTasks, candidateViews);

    assert.strictEqual(countDashboardListItemsForFilter(listItems, "today"), 1);
    assert.strictEqual(countDashboardListItemsForFilter(listItems, "all"), 3);
    assert.strictEqual(countDashboardListItemsForFilter(listItems, "done"), 0);
  });

  test("dashboard list view model shows simplified sections under All", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Overdue saved",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: ["#work"],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: ["#admin"],
        },
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Candidate first",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
      {
        kind: "candidate",
        text: "Candidate duplicate",
        dueDate: "2026-03-30",
        category: "admin",
        priority: "low",
        timeEstimateMin: 10,
        source: "notes",
        sourceLabel: "projects/plan.md",
        existsAlready: true,
      },
    ]);

    const viewModel = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, candidates),
      "all",
      "",
    );

    assert.deepStrictEqual(
      viewModel.sections.map((section: { title: string; items: DashboardListItem[] }) => ({
        title: section.title,
        kinds: section.items.map((item: DashboardListItem) => item.kind),
      })),
      [
        { title: "Today", kinds: ["task", "task"] },
        { title: "Planned", kinds: [] },
        { title: "Unsorted", kinds: [] },
        { title: "Done", kinds: [] },
      ],
    );
  });

  test("dashboard list view model keeps All sectioned and non-All filters flat in listboard order", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Overdue saved",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: ["#work"],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: ["#admin"],
        },
        {
          id: "tasks/2026-03-29.md:3",
          filePath: "/tmp/notes/tasks/2026-03-29.md",
          lineIndex: 3,
          text: "Upcoming saved",
          done: false,
          date: "2026-03-29",
          dueDate: "2026-03-29",
          tags: [],
        },
        {
          id: "tasks/2026-04-10.md:4",
          filePath: "/tmp/notes/tasks/2026-04-10.md",
          lineIndex: 4,
          text: "Scheduled saved",
          done: false,
          date: "2026-04-10",
          dueDate: "2026-04-10",
          tags: [],
        },
        {
          id: "tasks/inbox.md:5",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 5,
          text: "Backlog saved",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/2026-03-20.md:6",
          filePath: "/tmp/notes/tasks/2026-03-20.md",
          lineIndex: 6,
          text: "Done saved",
          done: true,
          date: "2026-03-20",
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Candidate first",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
    ]);
    const items = buildDashboardListItems(savedTasks, candidates);

    const allView = buildDashboardListViewModel(items, "all", "");
    assert.deepStrictEqual(
      allView.sections.map((section) => section.title),
      ["Today", "Planned", "Unsorted", "Done"],
    );

    const todayView = buildDashboardListViewModel(items, "today", "");
    assert.deepStrictEqual(todayView.sections, []);
    assert.deepStrictEqual(
      (todayView as { flatItems?: DashboardListItem[] }).flatItems?.map((item) => item.text),
      ["Overdue saved", "Today saved"],
    );

    const plannedView = buildDashboardListViewModel(items, "planned", "");
    assert.deepStrictEqual(plannedView.sections, []);
    assert.deepStrictEqual(
      (plannedView as { flatItems?: DashboardListItem[] }).flatItems?.map((item) => item.text),
      ["Upcoming saved", "Scheduled saved"],
    );

    const doneView = buildDashboardListViewModel(items, "done", "");
    assert.deepStrictEqual(doneView.sections, []);
    assert.deepStrictEqual(
      (doneView as { flatItems?: DashboardListItem[] }).flatItems?.map((item) => item.text),
      ["Done saved"],
    );
  });

  test("dashboard list view model preserves active-view order when searching across saved tasks and candidates", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Alpha overdue",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: [],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Alpha today",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Alpha candidate",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
    ]);

    const allSearch = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, candidates),
      "all",
      "alpha",
    );

    assert.deepStrictEqual(
      allSearch.sections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => item.text),
      })),
      [{ title: "Today", items: ["Alpha overdue", "Alpha today"] }],
    );
  });

  test("dashboard list view model keeps zero-count All sections visible and uses compact empty states", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-27.md:1",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 1,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const items = buildDashboardListItems(savedTasks, []);

    const allView = buildDashboardListViewModel(items, "all", "");
    assert.deepStrictEqual(
      allView.sections.map((section) => ({ title: section.title, count: section.items.length })),
      [
        { title: "Today", count: 1 },
        { title: "Planned", count: 0 },
        { title: "Unsorted", count: 0 },
        { title: "Done", count: 0 },
      ],
    );
    assert.strictEqual(allView.emptyMessage, null);

    const emptyAll = buildDashboardListViewModel([], "all", "");
    assert.deepStrictEqual(emptyAll.sections, []);
    assert.strictEqual(
      emptyAll.emptyMessage,
      "No tasks yet||Use Add Task or AI Extract to create your first task.",
    );
  });

  test("dashboard list view model keeps matching All sections during partial search and hides non-matching ones", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-26.md:1",
          filePath: "/tmp/notes/tasks/2026-03-26.md",
          lineIndex: 1,
          text: "Ops overdue alpha",
          done: false,
          date: "2026-03-26",
          dueDate: "2026-03-26",
          tags: [],
        },
        {
          id: "tasks/2026-03-27.md:2",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 2,
          text: "Today beta",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
        {
          id: "tasks/inbox.md:3",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 3,
          text: "Ops backlog gamma",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );
    const candidates = buildDashboardCandidateViews([
      {
        kind: "candidate",
        text: "Ops candidate alpha",
        dueDate: null,
        category: "work",
        priority: "medium",
        timeEstimateMin: 15,
        source: "moments",
        sourceLabel: "Moments",
        existsAlready: false,
      },
    ]);

    const viewModel = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, candidates),
      "all",
      "ops",
    );

    assert.deepStrictEqual(
      viewModel.sections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => item.text),
      })),
      [
        { title: "Today", items: ["Ops overdue alpha"] },
        { title: "Unsorted", items: ["Ops backlog gamma"] },
      ],
    );
    assert.strictEqual(viewModel.emptyMessage, null);
  });

  test("dashboard list view model shows only No matching tasks for empty All search results", () => {
    const savedTasks = buildDashboardTaskViews(
      [
        {
          id: "tasks/2026-03-27.md:1",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 1,
          text: "Today saved",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-27",
          tags: [],
        },
      ],
      "2026-03-27",
    );

    const viewModel = buildDashboardListViewModel(
      buildDashboardListItems(savedTasks, []),
      "all",
      "missing",
    );
    assert.deepStrictEqual(viewModel.sections, []);
    assert.strictEqual(viewModel.emptyMessage, "No matching tasks");
  });

  test("dashboard list view model shows correct empty states for simplified filters", () => {
    const todayOnly = buildDashboardListViewModel([], "today", "");
    assert.deepStrictEqual(todayOnly.sections, []);
    assert.strictEqual(todayOnly.emptyMessage, "Nothing scheduled for today");

    const plannedOnly = buildDashboardListViewModel([], "planned", "");
    assert.deepStrictEqual(plannedOnly.sections, []);
    assert.strictEqual(plannedOnly.emptyMessage, "No planned tasks");

    const doneOnly = buildDashboardListViewModel([], "done", "");
    assert.deepStrictEqual(doneOnly.sections, []);
    assert.strictEqual(doneOnly.emptyMessage, "No completed tasks");

    const todaySearchEmpty = buildDashboardListViewModel([], "today", "missing");
    assert.strictEqual(todaySearchEmpty.emptyMessage, "Nothing scheduled for today");

    const allWithItemsNoMatch = buildDashboardListViewModel(
      buildDashboardListItems(
        buildDashboardTaskViews(
          [
            {
              id: "tasks/2026-03-27.md:1",
              filePath: "/tmp/notes/tasks/2026-03-27.md",
              lineIndex: 1,
              text: "Something saved",
              done: false,
              date: "2026-03-27",
              dueDate: "2026-03-27",
              tags: [],
            },
          ],
          "2026-03-27",
        ),
        [],
      ),
      "all",
      "missing",
    );
    assert.strictEqual(allWithItemsNoMatch.emptyMessage, "No matching tasks");
  });

  test("migrateDashboardCandidateState converts legacy extracted state into unified candidate state", () => {
    const migrated = migrateDashboardCandidateState({
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
          dueDate: "2026-03-30",
          category: "admin",
          priority: "low",
          timeEstimateMin: 10,
          source: "notes",
          sourceLabel: "projects/plan.md",
          existsAlready: true,
        },
      ],
      addedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy moments task")],
      notesAddedExtractedKeys: [normalizeExtractedTaskIdentity("Legacy notes task")],
    });

    assert.deepStrictEqual(
      migrated.candidateTasks.map((task) => ({
        text: task.text,
        source: task.source,
        sourceLabel: task.sourceLabel,
        order: task.order,
        added: task.added,
      })),
      [
        {
          text: "Legacy moments task",
          source: "moments",
          sourceLabel: "Moments",
          order: 0,
          added: true,
        },
        {
          text: "Legacy notes task",
          source: "notes",
          sourceLabel: "projects/plan.md",
          order: 1,
          added: true,
        },
      ],
    );
    assert.strictEqual(migrated.candidateOrderSeed, 2);
    assert.deepStrictEqual(migrated.addedCandidateKeys, [
      normalizeExtractedTaskIdentity("Legacy moments task"),
      normalizeExtractedTaskIdentity("Legacy notes task"),
    ]);
  });

  test("migrateDashboardCandidateState restores candidate order seed from existing candidate orders", () => {
    const migrated = migrateDashboardCandidateState({
      candidateTasks: [
        {
          kind: "candidate",
          text: "Sparse first",
          dueDate: null,
          category: "work",
          priority: "medium",
          timeEstimateMin: 15,
          source: "moments",
          sourceLabel: "Moments",
          existsAlready: false,
          extractionIndex: 0,
          order: 2,
          added: false,
        },
        {
          kind: "candidate",
          text: "Sparse second",
          dueDate: null,
          category: "admin",
          priority: "low",
          timeEstimateMin: 10,
          source: "notes",
          sourceLabel: "projects/plan.md",
          existsAlready: false,
          extractionIndex: 1,
          order: 7,
          added: false,
        },
      ],
    });

    assert.strictEqual(migrated.candidateOrderSeed, 8);
  });

  test("migrateDashboardCandidateState ignores malformed stored candidates", () => {
    const addedKey = normalizeExtractedTaskIdentity("Keep me");
    const migrated = migrateDashboardCandidateState({
      candidateTasks: [
        null,
        {
          kind: "candidate",
          text: "   ",
          source: "moments",
          sourceLabel: "Moments",
        },
        {
          kind: "candidate",
          text: "Keep me",
          dueDate: "2026-03-30",
          category: "work",
          priority: "medium",
          timeEstimateMin: 15,
          source: "moments",
          sourceLabel: "Moments",
          existsAlready: false,
          order: 7,
          extractionIndex: 3,
        },
      ],
      addedCandidateKeys: [addedKey, 42, null],
    });

    assert.strictEqual(migrated.candidateTasks.length, 1);
    assert.strictEqual(migrated.candidateTasks[0].text, "Keep me");
    assert.strictEqual(migrated.candidateTasks[0].order, 7);
    assert.strictEqual(migrated.candidateTasks[0].extractionIndex, 3);
    assert.deepStrictEqual(migrated.addedCandidateKeys, [addedKey]);
    assert.strictEqual(migrated.candidateOrderSeed, 8);
  });

  test("migrateDashboardCandidateState preserves legacy notes candidate source metadata", () => {
    const migrated = migrateDashboardCandidateState({
      notesExtractedTasks: [
        {
          text: "Review meeting notes",
          dueDate: null,
          category: "work",
          priority: "medium",
          timeEstimateMin: 20,
          sourceNote: "projects/retro.md",
        },
        {
          text: "Share summary",
          dueDate: null,
          category: "work",
          priority: "low",
          timeEstimateMin: 10,
          sourceLabel: "projects/plan.md",
        },
      ],
    });

    assert.strictEqual(migrated.candidateTasks.length, 2);
    assert.strictEqual(migrated.candidateTasks[0].source, "notes");
    assert.strictEqual(migrated.candidateTasks[0].sourceLabel, "projects/retro.md");
    assert.strictEqual(migrated.candidateTasks[1].source, "notes");
    assert.strictEqual(migrated.candidateTasks[1].sourceLabel, "projects/plan.md");
  });

  test("dashboard task file resolver supports inbox and dated files", () => {
    const notesDir = "/tmp/notes";
    assert.strictEqual(resolveDashboardTaskFile(notesDir, null), "/tmp/notes/tasks/inbox.md");
    assert.strictEqual(
      resolveDashboardTaskFile(notesDir, "2026-03-31"),
      "/tmp/notes/tasks/2026-03-31.md",
    );
  });

  test("dashboard task classifier separates backlog upcoming and overdue", () => {
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "tasks/inbox.md:1",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 1,
          text: "Inbox task",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "backlog",
    );
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "tasks/2026-03-27.md:4",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 4,
          text: "Due soon",
          done: false,
          date: "2026-03-27",
          dueDate: "2026-03-30",
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "upcoming",
    );
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "tasks/2026-03-20.md:2",
          filePath: "/tmp/notes/tasks/2026-03-20.md",
          lineIndex: 2,
          text: "Overdue task",
          done: false,
          date: "2026-03-20",
          dueDate: null,
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "overdue",
    );
    assert.strictEqual(
      classifyDashboardTask(
        {
          id: "projects/roadmap.md:9",
          filePath: "/tmp/notes/projects/roadmap.md",
          lineIndex: 9,
          text: "Done item",
          done: true,
          date: null,
          dueDate: "2026-03-30",
          tags: [],
        },
        "2026-03-27",
        "2026-04-03",
      ),
      "done",
    );
  });

  test("upcoming week chart uses the next 7 days and effective dates", () => {
    const week = buildUpcomingWeek(
      [
        {
          id: "tasks/2026-03-27.md:1",
          filePath: "/tmp/notes/tasks/2026-03-27.md",
          lineIndex: 1,
          text: "Today task",
          done: false,
          date: "2026-03-27",
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/2026-03-28.md:1",
          filePath: "/tmp/notes/tasks/2026-03-28.md",
          lineIndex: 1,
          text: "Due later",
          done: false,
          date: "2026-03-28",
          dueDate: "2026-03-30",
          tags: [],
        },
        {
          id: "tasks/2026-03-30.md:4",
          filePath: "/tmp/notes/tasks/2026-03-30.md",
          lineIndex: 4,
          text: "Already finished",
          done: true,
          date: "2026-03-30",
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/2026-04-03.md:2",
          filePath: "/tmp/notes/tasks/2026-04-03.md",
          lineIndex: 2,
          text: "Outside window",
          done: false,
          date: "2026-04-03",
          dueDate: null,
          tags: [],
        },
        {
          id: "tasks/inbox.md:7",
          filePath: "/tmp/notes/tasks/inbox.md",
          lineIndex: 7,
          text: "Backlog",
          done: false,
          date: null,
          dueDate: null,
          tags: [],
        },
      ],
      "2026-03-27",
    );

    assert.deepStrictEqual(
      week.map((day) => day.date),
      [
        "2026-03-27",
        "2026-03-28",
        "2026-03-29",
        "2026-03-30",
        "2026-03-31",
        "2026-04-01",
        "2026-04-02",
      ],
    );
    assert.deepStrictEqual(
      week.map((day) => ({ date: day.date, open: day.open, done: day.done })),
      [
        { date: "2026-03-27", open: 1, done: 0 },
        { date: "2026-03-28", open: 0, done: 0 },
        { date: "2026-03-29", open: 0, done: 0 },
        { date: "2026-03-30", open: 1, done: 1 },
        { date: "2026-03-31", open: 0, done: 0 },
        { date: "2026-04-01", open: 0, done: 0 },
        { date: "2026-04-02", open: 0, done: 0 },
      ],
    );
  });

  test("buildExtractedTaskStatusMessage includes hidden counts when present", () => {
    assert.strictEqual(
      buildExtractedTaskStatusMessage({
        visibleTasks: [],
        hiddenExisting: 0,
        hiddenDismissed: 0,
        hiddenDuplicates: 0,
      }),
      "実行可能なタスクは見つかりませんでした。",
    );

    assert.strictEqual(
      buildExtractedTaskStatusMessage({
        visibleTasks: [],
        hiddenExisting: 2,
        hiddenDismissed: 1,
        hiddenDuplicates: 0,
      }),
      "新しい候補はありません。2件は既存タスクと重複、1件は一時非表示として除外しました。",
    );

    assert.strictEqual(
      buildExtractedTaskStatusMessage({
        visibleTasks: [],
        hiddenExisting: 0,
        hiddenDismissed: 0,
        hiddenDuplicates: 3,
      }),
      "新しい候補はありません。3件は候補内で重複として除外しました。",
    );

    assert.strictEqual(
      buildExtractedTaskStatusMessage({
        visibleTasks: [],
        hiddenExisting: 1,
        hiddenDismissed: 1,
        hiddenDuplicates: 1,
      }),
      "新しい候補はありません。1件は既存タスクと重複、1件は一時非表示、1件は候補内で重複として除外しました。",
    );

    assert.strictEqual(
      buildExtractedTaskStatusMessage({
        visibleTasks: [
          {
            kind: "candidate" as const,
            text: "Send report",
            dueDate: null,
            category: "work",
            priority: "high",
            timeEstimateMin: 30,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
          },
        ],
        hiddenExisting: 2,
        hiddenDismissed: 0,
        hiddenDuplicates: 0,
      }),
      "1件の候補を表示しています。2件は既存タスクと重複として除外しました。",
    );

    assert.strictEqual(
      buildExtractedTaskStatusMessage({
        visibleTasks: [
          {
            kind: "candidate" as const,
            text: "Send report",
            dueDate: null,
            category: "work",
            priority: "high",
            timeEstimateMin: 30,
            source: "moments",
            sourceLabel: "Moments",
            existsAlready: false,
          },
          {
            kind: "candidate" as const,
            text: "Review budget",
            dueDate: null,
            category: "work",
            priority: "medium",
            timeEstimateMin: 20,
            source: "notes",
            sourceLabel: "projects/plan.md",
            existsAlready: false,
          },
        ],
        hiddenExisting: 0,
        hiddenDismissed: 0,
        hiddenDuplicates: 0,
      }),
      "2件の候補を表示しています。",
    );
  });

  test("buildExtractedTaskFailureMessage maps failure reasons to user-facing messages", () => {
    assert.strictEqual(
      buildExtractedTaskFailureMessage("modelUnavailable"),
      "AI 抽出を実行できませんでした。GitHub Copilot Chat の利用状態を確認してください。",
    );
    assert.strictEqual(
      buildExtractedTaskFailureMessage("requestFailed"),
      "AI 抽出に失敗しました。少し待ってからもう一度お試しください。",
    );
    assert.strictEqual(
      buildExtractedTaskFailureMessage(null),
      "実行可能なタスクは見つかりませんでした。",
    );
  });
});
