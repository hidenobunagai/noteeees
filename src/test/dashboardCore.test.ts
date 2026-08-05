import * as assert from "assert";
import { type ExtractedTask } from "../aiTaskProcessor";
import { createDashboardMessageHandler } from "../dashboardMessageHandler";
import {
  canAddDashboardCandidate,
  filterExtractedTasksForDisplay,
  normalizeExtractedTaskIdentity,
  resolveDashboardTaskFile,
  upsertDashboardDueDate,
} from "../dashboardTaskUtils.js";
import {
  buildExtractedTaskFailureMessage,
  buildExtractedTaskStatusMessage,
} from "../dashboardTaskUtils";
import { createMementoStub } from "./dashboardTestHelpers";

suite("Dashboard Core Test Suite", () => {
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
});
