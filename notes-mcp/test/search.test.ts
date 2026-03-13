import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  clearSearchIndexCache,
  createSearchIndexSnapshot,
  executeStructuredSearch,
  getCachedSearchIndex,
  getSearchIndexNotes,
  type NoteEntry,
  resolveSearchStrategy,
} from "../src/search.js";

function createNote(overrides: Partial<NoteEntry>): NoteEntry {
  return {
    filePath: `/tmp/${overrides.filename ?? "note.md"}`,
    filename: overrides.filename ?? "note.md",
    title: overrides.title ?? "Untitled",
    tags: overrides.tags ?? [],
    content: overrides.content ?? "",
    createdAt: overrides.createdAt ?? null,
    mtime: overrides.mtime ?? new Date("2026-03-10T00:00:00Z").getTime(),
  };
}

describe("notes-mcp structured search", () => {
  test("classic strategy preserves tag and title heavy ranking", () => {
    const index = createSearchIndexSnapshot("/tmp", [
      createNote({
        filename: "projects/roadmap.md",
        title: "Deployment roadmap",
        tags: ["#todo"],
        content: "Plan the deployment rollout and keep the roadmap visible.",
      }),
      createNote({
        filename: "notes/random.md",
        title: "Random note",
        content: "deployment mention once",
      }),
    ]);

    const response = executeStructuredSearch(index, {
      query: "#todo deployment",
      search_strategy: "classic",
      include_recency_bonus: false,
    });

    if ("error" in response) throw new Error(response.error);
    expect(response.appliedStrategy).toBe("classic");
    expect(response.results[0]?.entry.filename).toBe("projects/roadmap.md");
    expect(response.results[0]?.reasons).toContain("tag:#todo");
  });

  test("hybrid bm25 favors denser body matches while keeping ranking explainable", () => {
    const index = createSearchIndexSnapshot("/tmp", [
      createNote({
        filename: "reports/deploy-review.md",
        title: "Deploy review",
        content: "deploy deploy deploy rollout checklist deploy metrics",
      }),
      createNote({
        filename: "notes/mention.md",
        title: "Mention",
        content: "deploy once",
      }),
    ]);

    const response = executeStructuredSearch(index, {
      query: "deploy",
      search_strategy: "hybrid_bm25",
      include_recency_bonus: false,
    });

    if ("error" in response) throw new Error(response.error);
    expect(response.appliedStrategy).toBe("hybrid_bm25");
    expect(response.results[0]?.entry.filename).toBe("reports/deploy-review.md");
    expect(response.results[0]?.reasons).toContain("bm25:content:deploy");
  });

  test("auto strategy stays classic for tag-only queries and small corpora", () => {
    const smallIndex = createSearchIndexSnapshot("/tmp", [
      createNote({ filename: "a.md", tags: ["#todo"], content: "todo" }),
      createNote({ filename: "b.md", content: "misc" }),
    ]);

    expect(
      resolveSearchStrategy("auto", ["#todo"], smallIndex, {
        k1: 1.2,
        b: 0.75,
        minDocumentCountForAuto: 10,
        minQueryTokensForAuto: 2,
        momentsPenalty: 0.9,
      }),
    ).toBe("classic");
  });

  test("auto strategy escalates to hybrid bm25 for larger free-text queries", () => {
    const notes = Array.from({ length: 30 }, (_, index) =>
      createNote({
        filename: `note-${index}.md`,
        content:
          index === 0
            ? "deployment rollback checklist and verification"
            : `background note ${index}`,
      }),
    );
    const index = createSearchIndexSnapshot("/tmp", notes);

    const response = executeStructuredSearch(index, {
      query: "deployment rollback",
      search_strategy: "auto",
      include_recency_bonus: false,
    });

    if ("error" in response) throw new Error(response.error);
    expect(response.appliedStrategy).toBe("hybrid_bm25");
  });

  test("explain=false keeps response shape and suppresses reasons", () => {
    const index = createSearchIndexSnapshot("/tmp", [
      createNote({ filename: "notes/deploy.md", content: "deploy deploy" }),
    ]);

    const response = executeStructuredSearch(index, {
      query: "deploy",
      explain: false,
      search_strategy: "hybrid_bm25",
      include_recency_bonus: false,
    });

    if ("error" in response) throw new Error(response.error);
    expect(response.results[0]?.reasons).toEqual([]);
  });

  test("moments penalty prevents short moment logs from dominating regular notes", () => {
    const index = createSearchIndexSnapshot("/tmp", [
      createNote({
        filename: "projects/deploy-plan.md",
        title: "Deploy plan",
        content: "deploy deploy plan with staged rollout and deploy verification",
      }),
      createNote({
        filename: "moments/2026-03-10.md",
        title: "2026-03-10",
        content: "- 09:00 deploy deploy",
      }),
    ]);

    const response = executeStructuredSearch(index, {
      query: "deploy",
      search_strategy: "hybrid_bm25",
      include_recency_bonus: false,
      bm25: { momentsPenalty: 0.5 },
    });

    if ("error" in response) throw new Error(response.error);
    expect(response.results[0]?.entry.filename).toBe("projects/deploy-plan.md");
  });

  test("cached index extracts Japanese inline hashtags", () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-mcp-tags-"));

    try {
      fs.writeFileSync(
        path.join(notesDir, "japanese-tags.md"),
        "# 日本語タグ\n本文で #振り返り－設計 と #設計 を使う",
        "utf8",
      );

      clearSearchIndexCache();
      const index = getCachedSearchIndex(notesDir);
      const [note] = getSearchIndexNotes(index);
      const response = executeStructuredSearch(index, {
        query: "#振り返り-設計",
        search_strategy: "classic",
        include_recency_bonus: false,
      });

      if ("error" in response) throw new Error(response.error);
      expect(note?.tags).toEqual(["#振り返り-設計", "#設計"]);
      expect(response.results[0]?.entry.filename).toBe("japanese-tags.md");
    } finally {
      clearSearchIndexCache();
      fs.rmSync(notesDir, { recursive: true, force: true });
    }
  });
});
