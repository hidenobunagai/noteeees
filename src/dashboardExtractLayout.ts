import { escAttr } from "./dashboardTaskUtils.js";

function getDefaultDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split("T")[0];
}

export function buildDashboardExtractSectionHtml(today: string): string {
  const defaultFromDate = getDefaultDate(7);

  return `
    <section class="dash-extract-row-compact">
      <div class="dash-extract-main">
        <button class="btn btn-extract" id="btn-ai-extract" type="button" title="過去7日間のMomentsから抽出">
          <span class="extract-icon">✦</span> From Moments
        </button>
        <button class="btn btn-extract" id="btn-extract-notes" type="button" title="過去7日間のNotesから抽出">
          <span class="extract-icon">📝</span> From Notes
        </button>
        <button class="btn btn-text" id="btn-extract-advanced" type="button" title="詳細設定">
          <span class="extract-icon">⚙</span>
        </button>
      </div>
      
      <div class="dash-extract-advanced" id="extract-advanced-panel" style="display: none;">
        <div class="extract-model-select">
          <label>AIモデル:</label>
          <select id="ai-model-select">
            <option value="">自動選択</option>
          </select>
        </div>
        <div class="extract-date-range">
          <label>期間:</label>
          <input id="notes-from-date" type="date" value="${escAttr(defaultFromDate)}" />
          <span>–</span>
          <input id="notes-to-date" type="date" value="${escAttr(today)}" />
        </div>
      </div>
      
      <span class="status-line" id="ai-status"></span>
      <span class="status-line" id="notes-extract-status"></span>
    </section>`;
}
