import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { enrichTasksInFile, loadAllAiTaskEnrichments } from "../dashboardAiEnrichment";
import { createMementoStub } from "./dashboardTestHelpers";

suite("Dashboard AI Enrichment Test Suite", () => {
  test("enrichTasksInFile processes only new tasks and saves them", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noteeees-enrich-test-"));
    const filePath = path.join(tmpDir, "tasks.md");

    // Create a markdown file with tasks
    fs.writeFileSync(
      filePath,
      `# Tasks
- [ ] Read a book
- [x] Finished task
- [ ] Buy milk
`,
      "utf8",
    );

    const store = createMementoStub();

    // Let's mock Copilot LM selectChatModels
    const lmApi = vscode.lm as typeof vscode.lm & {
      selectChatModels: typeof vscode.lm.selectChatModels;
    };
    const originalSelectChatModels = lmApi.selectChatModels;

    const chunks = [
      "```json\n[",
      '{"text":"Read a book","category":"learning","priority":"high","timeEstimateMin":30},',
      '{"text":"Buy milk","category":"personal","priority":"low","timeEstimateMin":10}',
      "]\n```",
    ];

    lmApi.selectChatModels = async () => [
      {
        id: "copilot-test",
        name: "Copilot Test",
        vendor: "copilot",
        family: "gpt-test",
        async sendRequest() {
          return {
            text: (async function* () {
              for (const chunk of chunks) {
                yield chunk;
              }
            })(),
          };
        },
      } as unknown as vscode.LanguageModelChat,
    ];

    try {
      const cts = new vscode.CancellationTokenSource();
      await enrichTasksInFile(filePath, tmpDir, store, cts.token);

      const enrichments = loadAllAiTaskEnrichments(store, tmpDir);

      // Both uncompleted tasks should be enriched
      assert.ok(enrichments["read a book"]);
      assert.strictEqual(enrichments["read a book"].category, "learning");
      assert.strictEqual(enrichments["read a book"].priority, "high");
      assert.strictEqual(enrichments["read a book"].timeEstimateMin, 30);

      assert.ok(enrichments["buy milk"]);
      assert.strictEqual(enrichments["buy milk"].category, "personal");
      assert.strictEqual(enrichments["buy milk"].priority, "low");
      assert.strictEqual(enrichments["buy milk"].timeEstimateMin, 10);

      // Completed task should NOT be enriched
      assert.strictEqual(enrichments["finished task"], undefined);
    } finally {
      lmApi.selectChatModels = originalSelectChatModels;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
