import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getIndexedNotesCached } from "../notesIndexCache";

function makeNoteDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-cache-"));
}

function writeNote(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

suite("Notes Index Cache Test Suite", () => {
  test("reuses parsed notes when mtimes are unchanged", async () => {
    const dir = makeNoteDir();
    writeNote(dir, "alpha.md", "# Alpha\n\nsome content");
    writeNote(dir, "beta.md", "# Beta\n\nother content");

    const first = await getIndexedNotesCached(dir);
    assert.strictEqual(first.length, 2);
    assert.ok(first.some((n) => n.metadata.title === "Alpha"));

    // Touching beta should only re-read beta, not alpha.
    const betaPath = path.join(dir, "beta.md");
    fs.writeFileSync(betaPath, "# Beta\n\nupdated content", "utf8");

    const second = await getIndexedNotesCached(dir);
    assert.strictEqual(second.length, 2);
    const alpha = second.find((n) => n.metadata.title === "Alpha");
    const beta = second.find((n) => n.metadata.title === "Beta");
    assert.ok(alpha, "alpha should still be cached");
    assert.ok(beta?.preview.includes("updated content"), "beta should be re-read");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("drops entries for deleted files", async () => {
    const dir = makeNoteDir();
    writeNote(dir, "gone.md", "# Gone\n\nwill be deleted");

    const first = await getIndexedNotesCached(dir);
    assert.strictEqual(first.length, 1);

    fs.rmSync(path.join(dir, "gone.md"));
    const second = await getIndexedNotesCached(dir);
    assert.strictEqual(second.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("respects excluded directories", async () => {
    const dir = makeNoteDir();
    fs.mkdirSync(path.join(dir, "moments"));
    writeNote(dir, "moments/2026-08-01.md", "# 08:00 hello");
    writeNote(dir, "keep.md", "# Keep");

    const all = await getIndexedNotesCached(dir);
    const filtered = await getIndexedNotesCached(dir, ["moments"]);
    assert.strictEqual(all.length, 2);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].metadata.title, "Keep");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
