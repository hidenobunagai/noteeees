import * as assert from "assert";
import {
  dismissExtractedTask,
  getDismissedExtractedStorageKey,
  loadDismissedExtractedTasks,
} from "../dashboardDismissedTasks";
import { todayDateString } from "../dashboardTaskUtils";
import type { DismissedExtractedTask } from "../dashboardTypes";
import { createMementoStub } from "./dashboardTestHelpers";

suite("Dashboard Dismissed Tasks Test Suite", () => {
  test("getDismissedExtractedStorageKey uses a stable hash per notes directory", () => {
    const keyA = getDismissedExtractedStorageKey("/tmp/notes-a");
    const keyB = getDismissedExtractedStorageKey("/tmp/notes-b");
    const keyASame = getDismissedExtractedStorageKey("/tmp/notes-a");

    assert.notStrictEqual(keyA, keyB);
    assert.strictEqual(keyA, keyASame);
    assert.ok(keyA.startsWith("dashboard.dismissedExtracted."));
  });

  test("loadDismissedExtractedTasks drops malformed entries and prunes stale ones", () => {
    const notesDir = "/tmp/noteeees-dismissed-load";
    const store = createMementoStub();
    const storageKey = getDismissedExtractedStorageKey(notesDir);
    const today = todayDateString();

    const entries: unknown[] = [
      { key: "valid-entry", dismissedAt: today },
      { key: "another-valid", dismissedAt: today },
      { key: "malformed-entry" },
      "not-an-object",
      null,
    ];
    void store.update(storageKey, entries);

    const loaded = loadDismissedExtractedTasks(store, notesDir);

    assert.ok(
      loaded.every(
        (entry) => typeof entry.key === "string" && typeof entry.dismissedAt === "string",
      ),
    );
    assert.strictEqual(loaded.length <= entries.length, true, "pruning should not grow the list");
    assert.ok(loaded.some((entry) => entry.key === "valid-entry"));
    assert.ok(loaded.every((entry) => entry.key !== "malformed-entry"));
  });

  test("dismissExtractedTask persists normalized identity and deduplicates repeat dismissals", () => {
    const notesDir = "/tmp/noteeees-dismissed-write";
    const store = createMementoStub();
    const storageKey = getDismissedExtractedStorageKey(notesDir);

    dismissExtractedTask(store, notesDir, "Pick up the package");
    dismissExtractedTask(store, notesDir, "  Pick up the package  ");

    const stored = store.get<DismissedExtractedTask[]>(storageKey, []);
    assert.strictEqual(stored.length, 1, "duplicate dismissals should collapse into one entry");
    assert.ok(stored[0].key.length > 0);
    assert.ok(stored[0].dismissedAt.length > 0);
  });

  test("dismissExtractedTask ignores text that has no meaningful identity", () => {
    const notesDir = "/tmp/noteeees-dismissed-empty";
    const store = createMementoStub();
    const storageKey = getDismissedExtractedStorageKey(notesDir);

    dismissExtractedTask(store, notesDir, "   ");

    const stored = store.get<DismissedExtractedTask[]>(storageKey, []);
    assert.strictEqual(stored.length, 0);
  });
});
