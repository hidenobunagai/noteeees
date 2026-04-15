import * as assert from "assert";
import { buildDashboardExtractSectionHtml } from "../dashboardExtractLayout";

suite("Dashboard Extract Layout", () => {
  test("extract buttons render in compact inline layout", () => {
    const html = buildDashboardExtractSectionHtml("2026-04-02");

    assert.match(html, /class="dash-extract-row-compact"/);
    assert.match(html, /id="btn-ai-extract"[\s\S]*From Moments/);
    assert.match(html, /id="btn-extract-notes"[\s\S]*From Notes/);
    assert.match(html, /id="btn-extract-advanced"/);
    assert.match(html, /id="extract-advanced-panel"/);
    assert.match(html, /id="notes-from-date"/);
    assert.match(html, /id="notes-to-date"/);
    assert.match(html, /id="ai-status"/);
    assert.match(html, /id="notes-extract-status"/);

    assert.doesNotMatch(html, /data-extract-group=/);
    assert.doesNotMatch(html, /id="ai-source-date"/);

    assert.doesNotMatch(html, /class="ai-result" id="ai-result"/);
    assert.doesNotMatch(html, /class="ai-result" id="notes-extract-result"/);
  });

  test("extract groups use inline flat structure without card headers", () => {
    const html = buildDashboardExtractSectionHtml("2026-04-02");

    // No card headers, no heavy wrappers
    assert.doesNotMatch(html, /card-header/i);
    assert.doesNotMatch(html, /action-bar-extract-group/i);
    assert.doesNotMatch(html, /extract-stack/i);
    assert.doesNotMatch(html, /support-rail/i);
    assert.doesNotMatch(html, /right-rail/i);
  });
});
