import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { NoteContent } from "../aiTaskProcessor";
import {
  collectDashboardMomentsText,
  collectDashboardNotesByDate,
  extractDashboardMomentsCandidates,
  extractDashboardNotesCandidates,
} from "../dashboardExtraction";
import { buildExtractedTaskFailureMessage } from "../dashboardTaskUtils";

function createTempNotesDir(): { notesDir: string; cleanup: () => void } {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-dashboard-"));
  return {
    notesDir,
    cleanup() {
      fs.rmSync(notesDir, { recursive: true, force: true });
    },
  };
}

function createToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

suite("Dashboard Extraction Test Suite", () => {
  test("collectDashboardMomentsText aggregates only dated moments bullets in range", async () => {
    const tempDir = createTempNotesDir();
    const momentsDir = path.join(tempDir.notesDir, "journal");
    fs.mkdirSync(momentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(momentsDir, "2026-03-20.md"),
      "---\ntype: moments\n---\n\n- 09:00 First item\nParagraph\n- Second item @2026-03-22\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(momentsDir, "2026-03-21.md"),
      "---\ntype: moments\n---\n\nParagraph only\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(momentsDir, "2026-03-22.md"),
      "---\ntype: moments\n---\n\n- Out of range\n",
      "utf8",
    );

    try {
      const result = await collectDashboardMomentsText(
        tempDir.notesDir,
        "journal",
        "2026-03-20",
        "2026-03-21",
      );

      assert.deepStrictEqual(result.datesWithContent, ["2026-03-20"]);
      assert.strictEqual(result.combinedText, "[2026-03-20]\nFirst item\nSecond item @2026-03-22");
    } finally {
      tempDir.cleanup();
    }
  });

  test("collectDashboardNotesByDate excludes the configured moments folder and sorts newest first", async () => {
    const tempDir = createTempNotesDir();
    fs.mkdirSync(path.join(tempDir.notesDir, "projects"), { recursive: true });
    fs.mkdirSync(path.join(tempDir.notesDir, "journal"), { recursive: true });
    fs.writeFileSync(path.join(tempDir.notesDir, "2026-03-20-note.md"), "alpha", "utf8");
    fs.writeFileSync(path.join(tempDir.notesDir, "projects", "2026-03-21-plan.md"), "beta", "utf8");
    fs.writeFileSync(
      path.join(tempDir.notesDir, "journal", "2026-03-21-moment.md"),
      "ignored",
      "utf8",
    );

    try {
      const notes = await collectDashboardNotesByDate(
        tempDir.notesDir,
        "2026-03-20",
        "2026-03-21",
        "journal",
      );

      assert.deepStrictEqual(
        notes.map((note: NoteContent) => note.filename),
        ["projects/2026-03-21-plan.md", "2026-03-20-note.md"],
      );
    } finally {
      tempDir.cleanup();
    }
  });

  test("extractDashboardMomentsCandidates surfaces AI failure messages when no visible tasks remain", async () => {
    const tempDir = createTempNotesDir();
    const momentsDir = path.join(tempDir.notesDir, "moments");
    fs.mkdirSync(momentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(momentsDir, "2026-03-20.md"),
      "---\ntype: moments\n---\n\n- Follow up customer\n",
      "utf8",
    );

    try {
      const result = await extractDashboardMomentsCandidates({
        notesDir: tempDir.notesDir,
        momentsSubfolder: "moments",
        fromDate: "2026-03-20",
        toDate: "2026-03-20",
        token: createToken(),
        dismissedTasks: [],
        extractTasksFromText: async () => ({ tasks: [], failureReason: "modelUnavailable" }),
        collectExistingTasks: async () => [],
      });

      assert.strictEqual(result.status, "done");
      assert.strictEqual(result.tasks.length, 0);
      assert.strictEqual(result.message, buildExtractedTaskFailureMessage("modelUnavailable"));
    } finally {
      tempDir.cleanup();
    }
  });

  test("extractDashboardNotesCandidates returns filtered note candidates with a summary message", async () => {
    const tempDir = createTempNotesDir();
    fs.writeFileSync(path.join(tempDir.notesDir, "2026-03-20-note.md"), "review retro", "utf8");

    try {
      const result = await extractDashboardNotesCandidates({
        notesDir: tempDir.notesDir,
        momentsSubfolder: "moments",
        fromDate: "2026-03-20",
        toDate: "2026-03-20",
        token: createToken(),
        dismissedTasks: [],
        extractTasksFromNotesForRange: async (notes: NoteContent[]) => [
          {
            text: "Plan retro",
            category: "work",
            priority: "medium",
            timeEstimateMin: 25,
            dueDate: null,
            sourceNote: notes[0].filename,
          },
        ],
        collectExistingTasks: async () => [],
      });

      assert.strictEqual(result.status, "done");
      assert.strictEqual(result.message, "1件のノートから1件のタスク候補を抽出しました。");
      assert.strictEqual(result.tasks.length, 1);
      assert.strictEqual(result.tasks[0].source, "notes");
      assert.strictEqual(result.tasks[0].sourceLabel, "2026-03-20-note.md");
    } finally {
      tempDir.cleanup();
    }
  });
});
