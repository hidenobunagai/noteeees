import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createDashboardTask,
  deleteDashboardTask,
  hasExistingDashboardTask,
  toggleDashboardTask,
  updateDashboardTask,
} from "../dashboardTaskPersistence";

function createTempNotesDir(): { notesDir: string; cleanup: () => void } {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-dashboard-"));
  return {
    notesDir,
    cleanup() {
      fs.rmSync(notesDir, { recursive: true, force: true });
    },
  };
}

suite("Dashboard Task Persistence Test Suite", () => {
  test("createDashboardTask creates the inbox file and appends a normalized task", async () => {
    const tempDir = createTempNotesDir();

    try {
      const result = await createDashboardTask(
        tempDir.notesDir,
        "  Send report due:2026-03-30  ",
        null,
        "2026-03-31",
      );

      assert.strictEqual(result, "created");
      const contents = fs.readFileSync(path.join(tempDir.notesDir, "tasks", "inbox.md"), "utf8");
      assert.ok(contents.includes("- [ ] Send report @2026-03-31\n"));
    } finally {
      tempDir.cleanup();
    }
  });

  test("updateDashboardTask preserves checkbox state while replacing due markers", async () => {
    const tempDir = createTempNotesDir();
    const inboxPath = path.join(tempDir.notesDir, "tasks", "inbox.md");
    fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
    fs.writeFileSync(
      inboxPath,
      "---\ntype: tasks\n---\n\n- [x] Follow up due:2026-03-01\n",
      "utf8",
    );

    try {
      const result = await updateDashboardTask(
        tempDir.notesDir,
        "tasks/inbox.md:4",
        "Follow up #work",
        "2026-03-05",
      );

      assert.strictEqual(result, "updated");
      const lines = fs.readFileSync(inboxPath, "utf8").split("\n");
      assert.strictEqual(lines[4], "- [x] Follow up #work @2026-03-05");
    } finally {
      tempDir.cleanup();
    }
  });

  test("toggleDashboardTask flips the checkbox without changing the text", async () => {
    const tempDir = createTempNotesDir();
    const inboxPath = path.join(tempDir.notesDir, "tasks", "inbox.md");
    fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
    fs.writeFileSync(
      inboxPath,
      "---\ntype: tasks\n---\n\n- [ ] Review budget @2026-03-10\n",
      "utf8",
    );

    try {
      const toggled = await toggleDashboardTask(tempDir.notesDir, "tasks/inbox.md:4", true);

      assert.strictEqual(toggled, true);
      const lines = fs.readFileSync(inboxPath, "utf8").split("\n");
      assert.strictEqual(lines[4], "- [x] Review budget @2026-03-10");
    } finally {
      tempDir.cleanup();
    }
  });

  test("deleteDashboardTask removes only the targeted task line", async () => {
    const tempDir = createTempNotesDir();
    const inboxPath = path.join(tempDir.notesDir, "tasks", "inbox.md");
    fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
    fs.writeFileSync(
      inboxPath,
      "---\ntype: tasks\n---\n\n- [ ] First task\n- [ ] Second task\n",
      "utf8",
    );

    try {
      const deleted = await deleteDashboardTask(tempDir.notesDir, "tasks/inbox.md:4");

      assert.strictEqual(deleted, true);
      const taskLines = fs
        .readFileSync(inboxPath, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("- ["));
      assert.deepStrictEqual(taskLines, ["- [ ] Second task"]);
    } finally {
      tempDir.cleanup();
    }
  });

  test("hasExistingDashboardTask normalizes due markers when checking duplicates", async () => {
    const tempDir = createTempNotesDir();
    const inboxPath = path.join(tempDir.notesDir, "tasks", "inbox.md");
    fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
    fs.writeFileSync(inboxPath, "---\ntype: tasks\n---\n\n- [ ] Send report @2026-03-30\n", "utf8");

    try {
      const exists = await hasExistingDashboardTask(tempDir.notesDir, "Send report");
      const missing = await hasExistingDashboardTask(tempDir.notesDir, "Review budget");

      assert.strictEqual(exists, true);
      assert.strictEqual(missing, false);
    } finally {
      tempDir.cleanup();
    }
  });
});
