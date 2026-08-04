import * as assert from "assert";
import { type ExtractedTask } from "../aiTaskProcessor";
import { createDashboardMessageHandler } from "../dashboardMessageHandler";
import {
  buildDashboardCandidateViews,
  buildDashboardTaskViews,
  buildUpcomingWeek,
  classifyDashboardTask,
} from "../dashboardClassification.js";
import {
  buildDashboardListItems,
  buildDashboardListViewModel,
  countDashboardListItemsForFilter,
  matchesDashboardListItemFilter,
} from "../dashboardListViewModel.js";
import {
  canAddDashboardCandidate,
  filterExtractedTasksForDisplay,
  normalizeDashboardTaskText,
  normalizeExtractedTaskIdentity,
  resolveDashboardTaskFile,
  upsertDashboardDueDate,
} from "../dashboardTaskUtils.js";
import {
  buildExtractedTaskFailureMessage,
  buildExtractedTaskStatusMessage,
} from "../dashboardTaskUtils";
import { createMementoStub } from "./dashboardTestHelpers";
import type { DashboardListItem } from "../dashboardTypes.js";

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
    const messages: Array<Record<string, unknown>> = [];
    const handler = createDashboardMessageHandler({
      getNotesDir: () => "/tmp/noteeees-test",
      stateStore: createMementoStub(),
      onRefresh: async () => undefined,
      postMessage: (message) => {
        messages.push(message);
        return Promise.resolve(true);
      },
      getCancelToken: () => undefined,
      setCancelToken: () => undefined,
      notifyStatus: () => undefined,
      dismissExtractedTaskInStore: () => undefined,
      loadDismissed: () => [],
      hasExistingTask: async () => false,
      createTask: async () => {
        throw new Error("disk full");
      },
    });

    void handler.handleMessage({
      command: "addExtractedTask",
      requestId: "candidate-1",
      text: "Broken task",
      dueDate: null,
      targetDate: null,
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (
        messages.some(
          (message: Record<string, unknown>) =>
            message.type === "candidateAddFailed" && message.requestId === "candidate-1",
        )
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.ok(
      messages.some(
        (message: Record<string, unknown>) =>
          message.type === "candidateAddFailed" &&
          message.requestId === "candidate-1" &&
          message.message === "disk full",
      ),
      "expected addExtractedTask to notify the webview when persistence fails",
    );
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
});
