import * as assert from "assert";
import { buildDashboardExtractSectionHtml } from "../dashboardExtractLayout";

suite("Dashboard Extract Layout", () => {
  test("extract buttons render in their own action rows", () => {
    const html = buildDashboardExtractSectionHtml("2026-04-02");

    assert.match(
      html,
      /From Moments[\s\S]*class="extract-stack"[\s\S]*id="ai-source-date"[\s\S]*class="extract-submit-row"[\s\S]*id="btn-ai-extract"/,
    );
    assert.match(
      html,
      /From Notes[\s\S]*class="extract-stack"[\s\S]*class="extract-range-row"[\s\S]*id="notes-from-date"[\s\S]*id="notes-to-date"[\s\S]*class="extract-submit-row"[\s\S]*id="btn-extract-notes"/,
    );
  });
});
