import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import { filterMomentEntries } from "../momentsPanel";
import { extractNoteMetadata, shouldPromptForTemplateSelection } from "../noteCommands";
import { buildTagSummary, limitSidebarNotes } from "../sidebarProvider";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("template picker is skipped without custom templates", () => {
    assert.strictEqual(shouldPromptForTemplateSelection([]), false);
  });

  test("template picker is shown with custom templates", () => {
    assert.strictEqual(shouldPromptForTemplateSelection(["meeting"]), true);
  });

  test("note metadata prefers heading title and merges tags", () => {
    const metadata = extractNoteMetadata(
      "---\ntags: [project]\n---\n\n# Weekly Sync\nDiscuss #todo items",
      "fallback-title",
    );

    assert.strictEqual(metadata.title, "Weekly Sync");
    assert.deepStrictEqual(metadata.tags, ["#project", "#todo"]);
  });

  test("tag summary is sorted by frequency", () => {
    const summary = buildTagSummary([
      { tags: ["#project", "#todo"] },
      { tags: ["#todo"] },
      { tags: ["#review"] },
    ]);

    assert.deepStrictEqual(summary, [
      { tag: "#todo", count: 2 },
      { tag: "#project", count: 1 },
      { tag: "#review", count: 1 },
    ]);
  });

  test("recent notes limit keeps newest items only", () => {
    assert.deepStrictEqual(limitSidebarNotes([1, 2, 3], 2), [1, 2]);
    assert.deepStrictEqual(limitSidebarNotes([1, 2, 3], 0), [1, 2, 3]);
  });

  test("open task filter keeps only unfinished tasks", () => {
    const filtered = filterMomentEntries(
      [
        { index: 0, time: "09:00", text: "todo", isTask: true, done: false },
        { index: 1, time: "09:30", text: "done", isTask: true, done: true },
        { index: 2, time: "10:00", text: "note", isTask: false, done: false },
      ],
      "openTasks",
    );

    assert.deepStrictEqual(filtered, [
      { index: 0, time: "09:00", text: "todo", isTask: true, done: false },
    ]);
  });
});
