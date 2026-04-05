function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildDashboardExtractSectionHtml(today: string): string {
  return `
    <section class="dash-extract-group" data-extract-group="moments">
      <button class="btn btn-extract" id="btn-ai-extract" type="button">From Moments</button>
      <input id="ai-source-date" type="date" value="${escAttr(today)}" class="extract-date-inline" />
      <span class="status-line" id="ai-status"></span>
    </section>
    <section class="dash-extract-group" data-extract-group="notes">
      <button class="btn btn-extract" id="btn-extract-notes" type="button">From Notes</button>
      <input id="notes-from-date" type="date" value="${escAttr(today)}" class="extract-date-inline" />
      <span class="extract-range-separator">–</span>
      <input id="notes-to-date" type="date" value="${escAttr(today)}" class="extract-date-inline" />
      <span class="status-line" id="notes-extract-status"></span>
    </section>`;
}
