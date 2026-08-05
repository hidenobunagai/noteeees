import * as crypto from "crypto";
import { escAttr, escHtml, shiftDate, toScriptData, todayDateString } from "./dashboardTaskUtils.js";
import type { DashboardData } from "./dashboardTypes.js";
import { buildDashboardWebviewCss } from "./dashboardWebviewCss.js";
import { buildDashboardWebviewScript } from "./dashboardWebviewScript.js";
import { DUE_DATE_TOKEN_RE } from "../shared/taskSyntax.js";

export function buildDashboardLoadingHtml(message: string): string {
  return `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)"><p>${escHtml(
    message,
  )}</p></body></html>`;
}

export function buildDashboardPanelHtml(data: DashboardData): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = toScriptData(data);
  const browserDueTokenPatternSource = JSON.stringify(DUE_DATE_TOKEN_RE.source);

  const css = buildDashboardWebviewCss();
  const script = buildDashboardWebviewScript(nonce, payload, browserDueTokenPatternSource);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Task Dashboard</title>
<style nonce="${nonce}">${css}
</style>
</head>
<body>
  <div class="page">
    <header class="dashboard-header" id="dashboard-header">
      <div class="header-copy">
        <h1 class="header-title">Task Dashboard</h1>
        <div class="dashboard-kpi-row">
          <span class="dashboard-kpi-chip" id="dashboard-kpi-open">
            <span class="dashboard-kpi-label">Open</span>
            <span class="dashboard-kpi-value">${data.summary.totalOpen}</span>
          </span>
          <span class="dashboard-kpi-chip" id="dashboard-kpi-today">
            <span class="dashboard-kpi-label">Today</span>
            <span class="dashboard-kpi-value">${data.summary.attentionCount}</span>
          </span>
          <span class="dashboard-kpi-chip" id="dashboard-kpi-done">
            <span class="dashboard-kpi-label">Done</span>
            <span class="dashboard-kpi-value">${data.summary.completionRate}%</span>
          </span>
        </div>
      </div>
      <div class="header-right" id="dashboard-header-right">
        <button class="btn" id="btn-refresh" type="button">Refresh</button>
      </div>
    </header>

    <section class="dash-add-row" id="dash-add-row">
      <input id="new-task-text" class="dash-add-input" type="text" placeholder="Add a task… (Enter to save)" />
      <button class="btn btn-primary btn-add-task" id="btn-create-task" type="button">Add</button>
    </section>

    <section class="dash-extract-row" id="dash-extract-row">
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
          <input id="notes-from-date" type="date" value="${escAttr(shiftDate(todayDateString(), -7))}" />
          <span>–</span>
          <input id="notes-to-date" type="date" value="${escAttr(data.today)}" />
        </div>
      </div>

      <span class="status-line" id="ai-status"></span>
      <span class="status-line" id="notes-extract-status"></span>
    </section>

    <section class="candidate-block" id="candidate-block" style="display:none;">
      <div class="candidate-items" id="candidate-items"></div>
    </section>

    <section class="dash-list-bar" id="dash-list-bar">
      <label class="search-shell" aria-label="Search tasks">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input id="task-search" type="search" placeholder="Search tasks…" />
      </label>
      <div class="filter-row" id="filter-row"></div>
    </section>

    <section class="list-surface">
      <div class="dashboard-main-list" id="dashboard-main-list"></div>
    </section>
  </div>

${script}
</body>
</html>`;
}
