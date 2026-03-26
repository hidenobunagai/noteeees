import { describe, expect, test } from "bun:test";
import { extractDueDate, parseTasksFromFile } from "../src/tasks.js";

describe("parseTasksFromFile", () => {
  test("extracts open and done tasks", () => {
    const content = `- [ ] レポートを書く\n- [x] MTG\n- 通常の行`;
    const tasks = parseTasksFromFile("/notes/2026-03-26.md", content, 0);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].done).toBe(false);
    expect(tasks[0].text).toBe("レポートを書く");
    expect(tasks[0].lineIndex).toBe(0);
    expect(tasks[1].done).toBe(true);
    expect(tasks[1].text).toBe("MTG");
    expect(tasks[1].lineIndex).toBe(1);
  });

  test("ignores non-task lines", () => {
    const content = `# タイトル\n通常の行\n- 通常リスト\n- 12:30 Momentsエントリ`;
    expect(parseTasksFromFile("/notes/note.md", content, 0)).toHaveLength(0);
  });

  test("uses uppercase X as done", () => {
    const content = `- [X] 大文字Xのタスク`;
    const tasks = parseTasksFromFile("/notes/note.md", content, 0);
    expect(tasks[0].done).toBe(true);
  });

  test("extracts inline tags from task text", () => {
    const content = `- [ ] 会議の準備 #work #project`;
    const tasks = parseTasksFromFile("/notes/note.md", content, 0);
    expect(tasks[0].tags).toContain("#work");
    expect(tasks[0].tags).toContain("#project");
  });

  test("extracts date from filename", () => {
    const content = `- [ ] タスク`;
    const tasks = parseTasksFromFile("/notes/2026-04-01_meeting.md", content, 0);
    expect(tasks[0].date).toBe("2026-04-01");
  });

  test("date is null when filename has no date", () => {
    const content = `- [ ] タスク`;
    const tasks = parseTasksFromFile("/notes/inbox.md", content, 0);
    expect(tasks[0].date).toBeNull();
  });

  test("generates correct id", () => {
    const content = `# h\n- [ ] タスク`;
    const tasks = parseTasksFromFile("/notes/2026-01-01.md", content, 100);
    expect(tasks[0].id).toBe("/notes/2026-01-01.md:1");
    expect(tasks[0].lineIndex).toBe(1);
  });

  test("source_type is always 'note'", () => {
    const content = `- [ ] タスク`;
    const tasks = parseTasksFromFile("/notes/note.md", content, 0);
    expect(tasks[0].sourceType).toBe("note");
  });
});

describe("extractDueDate", () => {
  test("extracts #due: tag", () => {
    expect(extractDueDate("レポート提出 #due:2026-04-05")).toBe("2026-04-05");
  });

  test("extracts due: without hash", () => {
    expect(extractDueDate("タスク due:2026-04-10")).toBe("2026-04-10");
  });

  test("returns null when no due date", () => {
    expect(extractDueDate("普通のタスク #work")).toBeNull();
  });

  test("case insensitive", () => {
    expect(extractDueDate("タスク Due:2026-05-01")).toBe("2026-05-01");
  });
});
