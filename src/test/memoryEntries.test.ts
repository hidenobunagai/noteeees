import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseMemoryFile, updateMemoryEntryCheckbox } from "../memoryEntries";

suite("Memory Entries", () => {
  test("treats legacy entries without a checkbox as unchecked", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-memory-"));

    try {
      const memoryPath = path.join(tempDir, "memory.md");
      fs.writeFileSync(
        memoryPath,
        "# Memory Log\n\n## 2026-03-18 09:00 #todo #ops\nlegacy entry\n",
        "utf8",
      );

      const entries = parseMemoryFile(memoryPath);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]?.checked, false);
      assert.deepStrictEqual(entries[0]?.tags, ["#todo", "#ops"]);
      assert.strictEqual(entries[0]?.content, "legacy entry");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("updates checkbox markers in entry headers", () => {
    const checkedLine = updateMemoryEntryCheckbox("## 2026-03-18 09:00 #todo", true);
    assert.ok(checkedLine);
    assert.strictEqual(checkedLine, "## 2026-03-18 09:00 [x] #todo");

    const uncheckedLine = updateMemoryEntryCheckbox(checkedLine, false);
    assert.ok(uncheckedLine);
    assert.strictEqual(uncheckedLine, "## 2026-03-18 09:00 [ ] #todo");
  });

  test("parses explicit checked entries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-memory-"));

    try {
      const memoryPath = path.join(tempDir, "memory.md");
      fs.writeFileSync(
        memoryPath,
        "# Memory Log\n\n## 2026-03-18 09:00 [x] #done\nwrapped up\n",
        "utf8",
      );

      const entries = parseMemoryFile(memoryPath);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]?.checked, true);
      assert.deepStrictEqual(entries[0]?.tags, ["#done"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
