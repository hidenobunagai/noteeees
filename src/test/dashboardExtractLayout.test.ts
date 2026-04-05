import * as assert from "assert";
import { buildDashboardExtractSectionHtml } from "../dashboardExtractLayout";

suite("Dashboard Extract Layout", () => {
  test("extract buttons render in compact inline layout", () => {
    const html = buildDashboardExtractSectionHtml("2026-04-02");

    // Moments: button + date + status, all inline
    assert.match(
      html,
      /class="dash-extract-group" data-extract-group="moments"[\s\S]*btn-extract[\s\S]*From Moments[\s\S]*id="ai-source-date"[\s\S]*id="ai-status"/,
    );

    // Notes: button + from date + separator + to date + status, all inline
    assert.match(
      html,
      /class="dash-extract-group" data-extract-group="notes"[\s\S]*btn-extract[\s\S]*From Notes[\s\S]*id="notes-from-date"[\s\S]*id="notes-to-date"[\s\S]*id="notes-extract-status"/,
    );

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
