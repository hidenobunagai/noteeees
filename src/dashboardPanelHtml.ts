import * as crypto from "crypto";
import { buildDashboardExtractSectionHtml } from "./dashboardExtractLayout.js";
import { escAttr, escHtml, toScriptData } from "./dashboardTaskUtils.js";
import type { DashboardData } from "./dashboardTypes.js";
import { DUE_DATE_TOKEN_RE } from "./taskSyntax.js";

export function buildDashboardLoadingHtml(message: string): string {
  return `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)"><p>${escHtml(
    message,
  )}</p></body></html>`;
}

export function buildDashboardPanelHtml(data: DashboardData): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const weekMax = Math.max(...data.week.map((day) => day.open + day.done), 1);
  const payload = toScriptData(data);
  const browserDueTokenPatternSource = JSON.stringify(DUE_DATE_TOKEN_RE.source);

  const weekBarsHtml = data.week
    .map((day) => {
      const total = day.open + day.done;
      const openHeight = total > 0 ? Math.round((day.open / weekMax) * 100) : 0;
      const doneHeight = total > 0 ? Math.round((day.done / weekMax) * 100) : 0;
      const isToday = day.date === data.today;
      const [, month, dateOfMonth] = day.date.split("-");
      const label = `${Number.parseInt(month, 10)}/${Number.parseInt(dateOfMonth, 10)}`;
      const title = `${day.date} · open ${day.open} · done ${day.done}`;
      return `<div class="week-day${isToday ? " is-today" : ""}" title="${escAttr(title)}">
  <div class="week-day-bars" data-zero="${total === 0}">
    <div class="week-bar week-bar-open${day.open === 0 ? " is-zero" : ""}" style="height:${openHeight}%"></div>
    <div class="week-bar week-bar-done${day.done === 0 ? " is-zero" : ""}" style="height:${doneHeight}%"></div>
  </div>
  <div class="week-day-label">
    <span>${escHtml(day.label)}</span>
    <strong>${escHtml(label)}</strong>
  </div>
</div>`;
    })
    .join("");

  const categoryOrder = ["work", "personal", "health", "learning", "admin", "other"];
  const categoryLabels: Record<string, string> = {
    work: "Work",
    personal: "Personal",
    health: "Health",
    learning: "Learning",
    admin: "Admin",
    other: "Other",
  };
  const categoryIcons: Record<string, string> = {
    work: "W",
    personal: "P",
    health: "H",
    learning: "L",
    admin: "A",
    other: "O",
  };
  const categoryMax = Math.max(...categoryOrder.map((key) => data.catCount[key] ?? 0), 1);
  const categoryHtml = categoryOrder
    .map((key) => {
      const count = data.catCount[key] ?? 0;
      const width = Math.max(
        count === 0 ? 0 : Math.round((count / categoryMax) * 100),
        count > 0 ? 12 : 0,
      );
      return `<div class="category-row">
  <div class="category-label"><span class="category-icon">${escHtml(categoryIcons[key])}</span>${escHtml(
    categoryLabels[key],
  )}</div>
  <div class="category-track" data-empty="${count === 0}"><div class="category-fill${count === 0 ? " is-zero" : ""}" style="width:${width}%"></div></div>
  <div class="category-count">${count}</div>
</div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Task Dashboard</title>
<style nonce="${nonce}">
  :root {
    --bg: var(--vscode-editor-background, #111827);
    --surface: var(--vscode-editorWidget-background, #161b22);
    --border: var(--vscode-panel-border, #2d3748);
    --text: var(--vscode-foreground, #dbe2ea);
    --muted: var(--vscode-descriptionForeground, #8b98a5);
    --accent: var(--vscode-textLink-foreground, #4f8cff);
    --success: var(--vscode-testing-iconPassed, #2ea043);
    --warning: var(--vscode-editorWarning-foreground, #d97706);
    --danger: var(--vscode-errorForeground, #dc2626);
    --radius: 12px;
    --radius-sm: 8px;
    --gap: 16px;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 20px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.5;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 1320px;
    margin: 0 auto;
  }

  .dashboard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
  }

  .header-copy {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .header-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .header-right {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    align-items: center;
  }

  .dashboard-kpi-row {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

   .dashboard-kpi-chip {
     display: inline-flex;
     align-items: center;
     gap: 6px;
     min-height: 28px;
     padding: 0 10px;
     border-radius: 4px;
     border: 1px solid var(--border);
     background: var(--surface);
     color: var(--text);
     font-size: 12px;
     transition: background-color 150ms ease;
     cursor: default;
   }

  .dashboard-kpi-label {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .dashboard-kpi-value {
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .dashboard-kpi-note {
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .dashboard-toolbar,
  .dashboard-action-bar,
  .list-surface,
  .analytics-strip,
  .analytics-panel {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 56%, transparent);
  }

  .dash-add-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dash-add-input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    padding: 8px 12px;
    font-size: 13px;
    outline: none;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }

  .dash-add-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .dash-add-input::placeholder {
    color: var(--muted);
  }

  .dash-extract-row-compact {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dash-extract-main {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .dash-extract-advanced {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .extract-model-select,
  .extract-date-range {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .extract-model-select label,
  .extract-date-range label {
    font-size: 12px;
    color: var(--muted);
    min-width: 60px;
  }

  .extract-model-select select {
    min-width: 200px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
  }

  .extract-date-range input[type="date"] {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
  }

  .extract-icon {
    font-size: 14px;
    opacity: 0.8;
  }

  .btn-extract {
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  }

  .btn-extract:hover {
    background: color-mix(in srgb, var(--accent) 20%, var(--surface));
  }

  .dash-list-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 0;
  }

  .dash-list-bar .search-shell {
    flex: 1;
    min-width: 140px;
    min-height: 34px;
  }

  .dash-list-bar .filter-row {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .list-surface {
    padding: 0;
    border: none;
    background: transparent;
  }

  .candidate-block {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 56%, transparent);
    padding: 10px 12px;
  }

  .candidate-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .candidate-block-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
    color: var(--vscode-errorForeground, var(--text));
    font-size: 12px;
    line-height: 1.4;
  }

  .candidate-block-error-text {
    flex: 1;
    min-width: 0;
  }

  .candidate-block-error-dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
  }

  .candidate-block-error-dismiss:hover {
    opacity: 1;
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
    transition: all 150ms ease;
  }

  .filter-chip:hover {
    background: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--border) 50%, transparent));
    color: var(--text);
  }

  .filter-chip.is-active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--vscode-button-foreground, #fff);
  }

  .filter-chip strong {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .search-shell {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 10px;
    min-height: 32px;
    background: var(--bg);
    transition: border-color 150ms ease;
  }

  .search-shell:focus-within {
    border-color: var(--accent);
  }

  .search-shell span {
    color: var(--muted);
    font-size: 13px;
  }

  .search-shell input {
    border: none;
    background: transparent;
    color: var(--text);
    width: 100%;
    min-width: 0;
    outline: none;
    padding: 6px 0;
    font-size: 13px;
  }

  .dashboard-main-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .task-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .task-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }

  .task-section-header h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .task-section-header span {
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .task-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .task-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    min-width: 0;
    transition: background-color 150ms ease, border-color 150ms ease;
  }

  .task-row:hover {
    background: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--accent) 5%, transparent));
    border-color: var(--border);
  }

  .task-row.task-row-saved.is-overdue {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }

  .task-row.task-row-saved.is-today {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  .task-row.task-row-saved.is-done {
    opacity: 0.76;
  }

  .task-row.task-row-candidate {
    background: color-mix(in srgb, var(--surface) 84%, var(--bg));
  }

  .task-row.task-row-candidate.is-candidate-blocked {
    opacity: 0.8;
  }

  .task-row-toggle-entry,
  .task-row-leading {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .task-row-toggle-entry {
    width: 18px;
    height: 18px;
  }

  .task-row-toggle {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    margin: 0;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    background: transparent;
    cursor: pointer;
  }

  .task-row-toggle:checked {
    background: color-mix(in srgb, var(--success) 16%, transparent);
    border-color: color-mix(in srgb, var(--success) 55%, var(--border));
  }

  .task-row-toggle:checked::after {
    content: "";
    position: absolute;
    inset: 4px;
    background: var(--success);
    clip-path: polygon(14% 52%, 0 67%, 39% 100%, 100% 22%, 84% 8%, 39% 68%);
  }

  .task-row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .task-row-main {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }

  .task-row-title-entry {
    flex: 1;
    min-width: 0;
  }

  .task-row-title {
    margin: 0;
    border: none;
    padding: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    cursor: pointer;
    min-width: 0;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-row-saved .task-row-title:hover {
    color: var(--accent);
  }

  .task-row-candidate .task-row-title {
    cursor: default;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .task-row.task-row-saved.is-done .task-row-title {
    color: var(--muted);
    text-decoration: line-through;
  }

  .task-row-secondary-actions,
  .task-row-candidate-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .task-row-secondary-actions {
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out;
  }

  .task-row:hover .task-row-secondary-actions,
  .task-row:focus-within .task-row-secondary-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .task-row-action-icon {
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
  }

  .task-row-action-icon:hover {
    color: var(--text);
    background: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--border) 50%, transparent));
    border-color: color-mix(in srgb, var(--border) 70%, transparent);
  }

  .task-row-action-icon[data-action="delete"] {
    color: color-mix(in srgb, var(--danger) 78%, var(--muted));
  }

  .task-row-action-icon[data-action="delete"]:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border-color: color-mix(in srgb, var(--danger) 32%, transparent);
  }

  .task-row-action-icon svg {
    width: 14px;
    height: 14px;
    display: block;
  }

  .task-row-more-menu { display: none; position: relative; }
  .task-row-more-btn {
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    padding: 8px 12px;
  }
  .task-row-more-dropdown {
    display: none;
    position: absolute;
    right: 0;
    top: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10;
    min-width: 120px;
  }
  .task-row-more-dropdown.is-open {
    display: block;
  }
  .task-row-more-dropdown button {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    padding: 8px 12px;
    text-align: left;
    cursor: pointer;
  }
  .task-row-more-dropdown button:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .task-row-more-dropdown button.is-danger {
    color: var(--danger, #e54d42);
  }
  .task-row-more-dropdown button.is-danger:hover {
    background: color-mix(in srgb, var(--danger, #e54d42) 12%, transparent);
  }

  .link-btn,
  .text-btn,
  .btn {
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    padding: 6px 12px;
    font-size: 13px;
    transition: all 150ms ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .btn:hover {
    background: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--accent) 8%, var(--surface)));
    border-color: var(--accent);
  }

  .btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--vscode-button-foreground, #fff);
  }

  .btn-primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, #000);
    border-color: color-mix(in srgb, var(--accent) 85%, #000);
  }

  .btn-danger {
    border-color: var(--danger);
    color: var(--danger);
  }

  .btn-danger:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  .btn:disabled,
  .text-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .text-btn,
  .link-btn {
    padding: 4px 8px;
    font-size: 12px;
    color: var(--muted);
    background: transparent;
  }

  .text-btn:hover,
  .link-btn:hover {
    color: var(--text);
    background: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--border) 50%, transparent));
  }

  .task-row-meta {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .task-row-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex-shrink: 0;
  }

  .task-row-meta-source {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
  }

  .badge.is-accent {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .badge.is-success {
    color: var(--success);
    border-color: color-mix(in srgb, var(--success) 40%, var(--border));
    background: color-mix(in srgb, var(--success) 12%, transparent);
  }

  .badge.is-warning {
    color: var(--warning);
    border-color: color-mix(in srgb, var(--warning) 40%, var(--border));
    background: color-mix(in srgb, var(--warning) 12%, transparent);
  }

  .badge.is-danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .task-edit {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .task-edit .field,
  .task-edit .field-compact {
    margin-bottom: 0;
  }

  .composer-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .composer-body .field,
  .composer-body .field-compact {
    margin-bottom: 0;
  }

  .composer-body .helper {
    margin: 0;
  }

  .field,
  .field-compact {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    margin-bottom: 12px;
  }

  .field span,
  .field-compact span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .field input,
  .field textarea,
  .field-compact input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    color: var(--text);
    padding: 10px 12px;
    outline: none;
  }

  .field textarea {
    resize: vertical;
    min-height: 92px;
  }

  .field input:focus,
  .field textarea:focus,
  .field-compact input:focus {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .inline-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .dash-extract-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .btn-extract {
    white-space: nowrap;
    font-size: 12px;
    padding: 6px 10px;
  }

  .extract-date-inline {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
    color: var(--text);
    padding: 5px 8px;
    outline: none;
    font-family: inherit;
    font-size: 12px;
    width: auto;
  }

  .extract-date-inline:focus {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .extract-range-separator {
    color: var(--muted);
    flex-shrink: 0;
    font-size: 12px;
  }

  .inline-fields {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .inline-fields .field-compact {
    flex: 1;
    min-width: 120px;
  }

  .helper {
    color: var(--muted);
    font-size: 12px;
    text-wrap: pretty;
  }

  .mono {
    font-variant-numeric: tabular-nums;
  }

  .empty-state {
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    color: var(--muted);
    text-align: center;
    max-width: 420px;
    margin: 4px auto;
  }

  .empty-state-title {
    display: block;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .empty-state-body {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }

  .analytics-strip {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
    gap: 10px;
    align-items: start;
    padding: 8px 10px;
  }

  .analytics-panel {
    padding: 8px 10px;
  }

  .status-line {
    min-height: 20px;
    color: var(--muted);
    font-size: 12px;
    margin-top: 10px;
  }

  .status-line.is-error {
    color: var(--danger);
  }

  .ai-result {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
  }

  .extract-item {
    padding: 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 88%, var(--bg));
  }

  .extract-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .extract-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .extract-title {
    font-weight: 600;
    font-size: 13px;
  }

  .extract-meta {
    color: var(--muted);
    font-size: 12px;
  }

  @media (width < 1000px) {
    .dashboard-action-bar {
      grid-template-columns: 1fr;
    }

    .analytics-strip {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    body {
      padding: 14px;
    }

    .dashboard-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-right,
    .dashboard-kpi-row {
      justify-content: flex-start;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }

    .extract-range-row {
      flex-direction: column;
      align-items: stretch;
    }

    .extract-range-separator {
      display: none;
    }

    .task-row-main,
    .extract-head {
      flex-direction: column;
    }

    .task-row-secondary-actions,
    .task-row-candidate-actions {
      justify-content: flex-start;
    }

    .task-row-secondary-actions {
      display: none;
    }

    .task-row-more-menu {
      display: block;
    }

    .dashboard-toolbar,
    .dashboard-action-bar,
    .list-surface,
    .analytics-strip {
      padding: 12px;
    }

    .dashboard-weekday-marker {
      display: none;
    }
  }
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
${buildDashboardExtractSectionHtml(data.today)}
    </section>

    <section class="candidate-block" id="candidate-block" style="display:none;">
      <div class="candidate-items" id="candidate-items"></div>
    </section>

    <section class="dash-list-bar" id="dash-list-bar">
      <label class="search-shell" aria-label="Search tasks">
        <span>🔍</span>
        <input id="task-search" type="search" placeholder="Search tasks…" />
      </label>
      <div class="filter-row" id="filter-row"></div>
    </section>

    <section class="list-surface">
      <div class="dashboard-main-list" id="dashboard-main-list"></div>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const dashboardData = ${payload};
    const savedState = vscode.getState() || {};
    const pendingCandidateAdds = [];

    // Populate model selector with available models
    (function populateModelSelector() {
      const modelSelect = document.getElementById("ai-model-select");
      if (modelSelect && dashboardData.availableModels && dashboardData.availableModels.length > 0) {
        // Keep the first "Auto select" option
        const autoOption = modelSelect.querySelector('option[value=""]');
        modelSelect.innerHTML = "";
        if (autoOption) {
          modelSelect.appendChild(autoOption);
        } else {
          const defaultOption = document.createElement("option");
          defaultOption.value = "";
          defaultOption.textContent = "自動選択";
          modelSelect.appendChild(defaultOption);
        }

        dashboardData.availableModels.forEach(function(model) {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = model.name;
          modelSelect.appendChild(option);
        });

        // Restore selected model if any
        if (savedState.selectedModel) {
          modelSelect.value = savedState.selectedModel;
        }
      }
    })();

    const browserDueTokenPattern = new RegExp(${browserDueTokenPatternSource}, "i");

    function sanitizeBrowserTaskText(text) {
      return String(text || "")
        .replaceAll(String.fromCharCode(13) + String.fromCharCode(10), String.fromCharCode(10))
        .split(String.fromCharCode(10))
        .map(function (line) {
          return line.trim();
        })
        .filter(Boolean)
        .join(" / ")
        .split(/\s+/)
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    function normalizedCandidateIdentity(text) {
      return sanitizeBrowserTaskText(text)
        .split(" ")
        .filter(function (part) {
          return !browserDueTokenPattern.test(part);
        })
        .join(" ")
        .trim()
        .normalize("NFKC")
        .toLowerCase();
    }

    function normalizeStoredCandidateTask(task) {
      if (!task || typeof task !== "object") {
        return null;
      }

      const text = sanitizeBrowserTaskText(typeof task.text === "string" ? task.text : "");
      if (!text) {
        return null;
      }

      return {
        kind: "candidate",
        text: text,
        dueDate:
          typeof task.dueDate === "string" && task.dueDate.length === 10 && task.dueDate[4] === "-" && task.dueDate[7] === "-"
            ? task.dueDate
            : null,
        category: typeof task.category === "string" && task.category.trim().length > 0 ? task.category : "other",
        priority: typeof task.priority === "string" && task.priority.trim().length > 0 ? task.priority : "medium",
        timeEstimateMin:
          typeof task.timeEstimateMin === "number" && Number.isFinite(task.timeEstimateMin)
            ? task.timeEstimateMin
            : 0,
        source: task.source === "notes" ? "notes" : "moments",
        sourceLabel:
          typeof task.sourceLabel === "string" && task.sourceLabel.trim().length > 0
            ? task.sourceLabel
            : task.source === "notes"
              ? "Notes"
              : "Moments",
        existsAlready: Boolean(task.existsAlready),
      };
    }

    function normalizeStoredCandidateTaskForSource(task, fallbackSource) {
      if (!task || typeof task !== "object") {
        return null;
      }

      const normalizedTask = normalizeStoredCandidateTask(task);
      if (!normalizedTask) {
        return null;
      }

      const legacySourceLabel =
        typeof task.sourceLabel === "string" && task.sourceLabel.trim().length > 0
          ? task.sourceLabel
          : typeof task.sourceNote === "string" && task.sourceNote.trim().length > 0
            ? task.sourceNote
            : fallbackSource === "notes"
              ? "Notes"
              : "Moments";

      return {
        ...normalizedTask,
        source: fallbackSource,
        sourceLabel: legacySourceLabel,
      };
    }

    function migrateLegacyCandidateState(savedState) {
      if (Array.isArray(savedState.candidateTasks)) {
        const candidateTasks = savedState.candidateTasks
          .map(function (task) {
            const normalizedTask = normalizeStoredCandidateTask(task);
            if (!normalizedTask) {
              return null;
            }

            return {
              ...normalizedTask,
              order: typeof task.order === "number" ? task.order : undefined,
              added: Boolean(task.added),
              extractRunAt: typeof task.extractRunAt === "string" ? task.extractRunAt : undefined,
              extractionIndex:
                typeof task.extractionIndex === "number"
                  ? task.extractionIndex
                  : typeof task.order === "number"
                    ? task.order
                    : 0,
            };
          })
          .filter(Boolean);
        const maxOrder = candidateTasks.reduce(function (highest, task) {
          return typeof task.order === "number" && task.order > highest ? task.order : highest;
        }, -1);
        return {
          candidateTasks: candidateTasks,
          candidateOrderSeed:
            typeof savedState.candidateOrderSeed === "number"
              ? savedState.candidateOrderSeed
              : maxOrder + 1,
          addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
            ? savedState.addedCandidateKeys.filter(function (key) {
                return typeof key === "string" && key.length > 0;
              })
            : [],
        };
      }

      let nextOrder = 0;
      const fromMoments = (Array.isArray(savedState.extractedTasks) ? savedState.extractedTasks : []).map(
        function (task) {
          const normalizedTask = normalizeStoredCandidateTaskForSource(task, "moments");
          if (!normalizedTask) {
            return null;
          }

          return {
            ...normalizedTask,
            order: nextOrder++,
            added: Array.isArray(savedState.addedExtractedKeys)
              ? savedState.addedExtractedKeys.includes(normalizedCandidateIdentity(normalizedTask.text))
              : false,
            extractionIndex: nextOrder - 1,
          };
        },
      ).filter(Boolean);
      const fromNotes = (Array.isArray(savedState.notesExtractedTasks) ? savedState.notesExtractedTasks : []).map(
        function (task) {
          const normalizedTask = normalizeStoredCandidateTaskForSource(task, "notes");
          if (!normalizedTask) {
            return null;
          }

          return {
            ...normalizedTask,
            order: nextOrder++,
            added: Array.isArray(savedState.notesAddedExtractedKeys)
              ? savedState.notesAddedExtractedKeys.includes(normalizedCandidateIdentity(normalizedTask.text))
              : false,
            extractionIndex: nextOrder - 1,
          };
        },
      ).filter(Boolean);

      return {
        candidateTasks: fromMoments.concat(fromNotes),
        candidateOrderSeed: nextOrder,
        addedCandidateKeys: (Array.isArray(savedState.addedExtractedKeys) ? savedState.addedExtractedKeys : []).concat(
          Array.isArray(savedState.notesAddedExtractedKeys) ? savedState.notesAddedExtractedKeys : [],
        ),
      };
    }

    const migratedCandidates = migrateLegacyCandidateState(savedState);

    const state = {
      filter: savedState.filter === "focus" ? "attention" : (savedState.filter || "all"),
      search: savedState.search || "",

      editingId: savedState.editingId || null,
      candidateTasks: migratedCandidates.candidateTasks,
      candidateOrderSeed: migratedCandidates.candidateOrderSeed,
      addedCandidateKeys: Array.isArray(savedState.addedCandidateKeys)
        ? savedState.addedCandidateKeys
        : migratedCandidates.addedCandidateKeys,
      aiStatus: savedState.aiStatus || "",
      aiStatusType: savedState.aiStatusType || "idle",
      notesFromDate: savedState.notesFromDate || getDefaultDate(7),
      notesToDate: savedState.notesToDate || dashboardData.today,
      notesAiStatus: savedState.notesAiStatus || "",
      notesAiStatusType: savedState.notesAiStatusType || "idle",
      candidateBlockShown: savedState.candidateBlockShown || false,
      candidateBlockError: savedState.candidateBlockError || "",
      selectedModel: savedState.selectedModel || "",
      advancedPanelOpen: savedState.advancedPanelOpen || false,
    };

    function getDefaultDate(daysAgo) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().split("T")[0];
    }

    const simplifiedSectionOrder = ["today", "planned", "unsorted", "done"];
    const simplifiedSectionTitles = {
      today: "Today",
      planned: "Planned",
      unsorted: "Unsorted",
      done: "Done",
    };
    const simplifiedSectionDescriptions = {
      today: "今日と期限超過",
      planned: "7日以内と先の予定",
      unsorted: "inbox や日付なしの棚卸し待ち",
      done: "完了済み",
    };

    const filterDefinitions = [
      { id: "all", label: "All", count: dashboardData.tasks.length },
      { id: "today", label: "Today", count: dashboardData.sectionCounts.overdue + dashboardData.sectionCounts.today },
      { id: "planned", label: "Planned", count: dashboardData.sectionCounts.upcoming + dashboardData.sectionCounts.scheduled },
      { id: "done", label: "Done", count: dashboardData.sectionCounts.done },
    ];

    const taskSearchInput = document.getElementById("task-search");
    const filterRow = document.getElementById("filter-row");
    const taskList = document.getElementById("dashboard-main-list");
    const newTaskText = document.getElementById("new-task-text");
    const aiStatus = document.getElementById("ai-status");
    const notesFromDateInput = document.getElementById("notes-from-date");
    const notesToDateInput = document.getElementById("notes-to-date");
    const notesStatus = document.getElementById("notes-extract-status");

    if (!taskSearchInput || !filterRow || !taskList || !newTaskText || !aiStatus || !notesFromDateInput || !notesToDateInput || !notesStatus) {
      throw new Error("Task Dashboard failed to initialize required webview controls.");
    }

    function persistState() {
      vscode.setState({
        filter: state.filter,
        search: state.search,

        editingId: state.editingId,
        candidateTasks: state.candidateTasks,
        candidateOrderSeed: state.candidateOrderSeed,
        addedCandidateKeys: state.addedCandidateKeys,
        aiStatus: state.aiStatus,
        aiStatusType: state.aiStatusType,
        notesFromDate: state.notesFromDate,
        notesToDate: state.notesToDate,
        notesAiStatus: state.notesAiStatus,
        notesAiStatusType: state.notesAiStatusType,
        candidateBlockShown: state.candidateBlockShown,
        candidateBlockError: state.candidateBlockError,
        selectedModel: state.selectedModel,
        advancedPanelOpen: state.advancedPanelOpen,
      });
    }

    function esc(value) {
      return String(value)
        .replace(new RegExp("&", "g"), "&amp;")
        .replace(new RegExp("<", "g"), "&lt;")
        .replace(new RegExp(">", "g"), "&gt;")
        .replace(new RegExp('"', "g"), "&quot;");
    }

    function formatDateLabel(date) {
      if (!date) {
        return "No date";
      }

      const parts = date.split("-");
      if (parts.length !== 3) {
        return date;
      }

      return Number.parseInt(parts[1], 10) + "/" + Number.parseInt(parts[2], 10);
    }

    function extractedTaskKey(task) {
      return normalizeTaskIdentity(task.text);
    }

    function canAddDashboardCandidate(task, existingTaskKeys) {
      if (existingTaskKeys && existingTaskKeys.has(extractedTaskKey(task))) {
        return false;
      }

      return !task.existsAlready;
    }

    function normalizeTaskIdentity(text) {
      return normalizedCandidateIdentity(text);
    }

    function createPendingCandidateRequestId(task) {
      return "candidate-" + String(task.order) + "-" + Date.now();
    }

    function removePendingCandidateAdd(requestId) {
      const index = pendingCandidateAdds.findIndex(function (pending) {
        return pending.requestId === requestId;
      });
      if (index < 0) {
        return null;
      }

      const pending = pendingCandidateAdds[index];
      pendingCandidateAdds.splice(index, 1);
      return pending;
    }

    function getExistingTaskKeys() {
      const persistedTaskKeys = (dashboardData.tasks || [])
        .map(function (task) {
          return normalizeTaskIdentity(task.text);
        })
        .filter(Boolean);
      state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {
        return !persistedTaskKeys.includes(key);
      });
      const locallyAddedKeys = (state.addedCandidateKeys || []).filter(Boolean);
      return new Set(
        persistedTaskKeys
          .concat(locallyAddedKeys)
          .filter(Boolean),
      );
    }

    function matchesDashboardListItemFilter(item, filter) {
      if (filter === "all") {
        return true;
      }

      if (item.kind === "candidate") {
        return false;
      }

      if (filter === "today") {
        return item.section === "overdue" || item.section === "today";
      }

      if (filter === "planned") {
        return item.section === "upcoming" || item.section === "scheduled";
      }

      if (filter === "done") {
        return item.section === "done";
      }

      return item.section === filter;
    }

    function matchesDashboardListItemSearch(item, query) {
      const normalizedQuery = String(query || "").trim().toLowerCase();
      if (!normalizedQuery) {
        return true;
      }

      const haystack = item.kind === "candidate"
        ? [
            item.text,
            item.sourceLabel || "",
            item.source || "",
            item.category || "",
            item.priority || "",
            item.dueDate || "",
            item.existsAlready ? "already exists" : "",
            "candidate",
          ]
        : [item.text, item.relativePath || "", item.date || "", item.dueDate || ""].concat(item.tags || []);

      return haystack.join(" ").toLowerCase().includes(normalizedQuery);
    }

    function buildDashboardListViewModel(items, filter, search) {
      function buildDashboardEmptyMessage(filter) {
        switch (filter) {
          case "all":
            return "No tasks yet||Use Add Task or AI Extract to create your first task.";
          case "today":
            return "Nothing scheduled for today";
          case "planned":
            return "No planned tasks";
          case "done":
            return "No completed tasks";
          default:
            return "No items in this filter";
        }
      }

      const normalizedSearch = String(search || "").trim();
      const filteredItems = items.filter(function (item) {
        return matchesDashboardListItemFilter(item, filter);
      });
      const visibleItems = filteredItems.filter(function (item) {
        return matchesDashboardListItemSearch(item, search);
      });
      if (filter === "all") {
        if (normalizedSearch && visibleItems.length === 0) {
          return { sections: [], emptyMessage: "No matching tasks" };
        }

        if (!normalizedSearch && filteredItems.length === 0) {
          return { sections: [], emptyMessage: buildDashboardEmptyMessage("all") };
        }

        const sections = [];

        simplifiedSectionOrder.forEach(function (simplifiedSection) {
          let internalSections;
          if (simplifiedSection === "today") {
            internalSections = ["overdue", "today"];
          } else if (simplifiedSection === "planned") {
            internalSections = ["upcoming", "scheduled"];
          } else if (simplifiedSection === "unsorted") {
            internalSections = ["backlog"];
          } else {
            internalSections = ["done"];
          }

          const taskItems = visibleItems.filter(function (item) {
            return item.kind === "task" && internalSections.includes(item.section);
          });
          if (!normalizedSearch || taskItems.length > 0) {
            sections.push({
              key: simplifiedSection,
              title: simplifiedSectionTitles[simplifiedSection],
              items: taskItems,
            });
          }
        });

        return { sections: sections, emptyMessage: null };
      }

      if (filteredItems.length === 0) {
        return {
          sections: [],
          emptyMessage: buildDashboardEmptyMessage(filter),
        };
      }

      if (visibleItems.length === 0) {
        return {
          sections: [],
          emptyMessage: normalizedSearch ? "No matching tasks" : buildDashboardEmptyMessage(filter),
        };
      }

      const title = simplifiedSectionTitles[filter] || (filter.charAt(0).toUpperCase() + filter.slice(1));

      return {
        sections: [],
        flatItems: visibleItems,
        emptyMessage: null,
      };
    }

    function getVisibleCandidates() {
      const existingTaskKeys = getExistingTaskKeys();
      return (state.candidateTasks || [])
        .map(function (task) {
          return {
            ...task,
            existsAlready: existingTaskKeys.has(extractedTaskKey(task)) || Boolean(task.existsAlready),
          };
        })
        .filter(function (task) {
          return !task.added;
        })
        .sort(function (a, b) {
          const aRunAt = a.extractRunAt || "";
          const bRunAt = b.extractRunAt || "";
          if (aRunAt !== bRunAt) {
            return bRunAt.localeCompare(aRunAt);
          }
          return (a.order || 0) - (b.order || 0);
        });
    }

    function mergeCandidateBatch(source, tasks) {
      const retained = (state.candidateTasks || []).filter(function (task) {
        return task.source !== source;
      });
      const extractRunAt = new Date().toISOString();
      const merged = (tasks || []).map(function (task) {
        return {
          kind: "candidate",
          source: source,
          sourceLabel: task.sourceLabel || (source === "notes" ? "Notes" : "Moments"),
          existsAlready: Boolean(task.existsAlready),
          order: state.candidateOrderSeed++,
          added: false,
          ...task,
          extractRunAt: extractRunAt,
        };
      });
      state.candidateTasks = retained.concat(merged);
    }

    function getListViewModel() {
      const listItems = (dashboardData.tasks || []).filter(function (item) {
        return item.kind === "task";
      });
      return buildDashboardListViewModel(listItems, state.filter, state.search);
    }

    function renderFilters() {
      filterDefinitions[0].count = dashboardData.tasks.length + getVisibleCandidates().length;
      filterDefinitions[1].count = dashboardData.sectionCounts.overdue + dashboardData.sectionCounts.today;
      filterDefinitions[2].count = dashboardData.sectionCounts.upcoming + dashboardData.sectionCounts.scheduled;
      filterDefinitions[3].count = dashboardData.sectionCounts.done;
      filterRow.innerHTML = filterDefinitions
        .map(function (filter) {
          const activeClass = filter.id === state.filter ? " is-active" : "";
          return '<button type="button" class="filter-chip' + activeClass + '" data-filter="' + esc(filter.id) + '">' +
            '<span>' + esc(filter.label) + '</span>' +
            '<strong>' + filter.count + '</strong>' +
          "</button>";
        })
        .join("");
    }

    function renderTaskMeta(task) {
      const badges = [];
      if (task.date) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-date">' + esc(formatDateLabel(task.date)) + "</span>");
      }
      if (task.dueDate) {
        const dueClass = task.section === "overdue" ? " is-danger" : task.section === "today" ? " is-warning" : " is-accent";
        badges.push('<span class="badge task-row-meta-item task-row-meta-due' + dueClass + '">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>");
      }
      for (const tag of task.tags || []) {
        badges.push('<span class="badge is-accent task-row-meta-item task-row-meta-tag">' + esc(tag) + "</span>");
      }
      badges.push('<span class="badge task-row-meta-item task-row-meta-source task-row-meta-source-saved">' + esc(task.relativePath) + "</span>");
      return '<div class="task-row-meta task-row-meta-saved">' + badges.join("") + "</div>";
    }

    function renderCandidateMeta(task) {
      const badges = [];
      if (task.dueDate) {
        badges.push('<span class="badge is-accent task-row-meta-item task-row-meta-candidate-due">Due ' + esc(formatDateLabel(task.dueDate)) + "</span>");
      }
      if (task.category) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-category">' + esc(task.category) + "</span>");
      }
      if (task.priority) {
        badges.push('<span class="badge task-row-meta-item task-row-meta-priority">' + esc(task.priority) + "</span>");
      }
      badges.push('<span class="badge task-row-meta-item task-row-meta-source task-row-meta-source-candidate">' + esc(task.sourceLabel || "Unknown") + "</span>");
      return '<div class="task-row-meta task-row-meta-candidate">' + badges.join("") + "</div>";
    }

    function renderTaskActionIcon(action) {
      const icons = {
        edit: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M11.7 1.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8 8L4 13l.7-2.7 8-8Zm-7 10.3 1.6-.4 6.9-6.9-1.2-1.2-6.9 6.9-.4 1.6Z"/></svg>',
        open: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 2h5v5h-1.5V4.6l-5.7 5.7-1-1 5.7-5.8H9V2Z"/><path fill="currentColor" d="M3 4.5A1.5 1.5 0 0 1 4.5 3H8v1.5H4.5v7h7V8H13v3.5A1.5 1.5 0 0 1 11.5 13h-7A1.5 1.5 0 0 1 3 11.5v-7Z"/></svg>',
        delete: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.5 2h3l.5 1H13v1.5H3V3h2.5l.5-1ZM4.5 6h1.5v6H4.5V6Zm3 0H9v6H7.5V6Zm3 0H12v6h-1.5V6Z"/><path fill="currentColor" d="M4 4.5h8V13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5Z" fill-opacity="0.18"/></svg>',
      };
      return icons[action] || "";
    }

    function renderTaskItem(task) {
      const itemClasses = [
        "task-row",
        "task-row-saved",
        task.done ? "is-done" : "",
        task.section === "overdue" ? "is-overdue" : "",
        task.section === "today" ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (state.editingId === task.id) {
        return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '" tabindex="-1">' +
          '<label class="task-row-toggle-entry"><input class="task-row-toggle" type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
          '<div class="task-row-body">' +
            '<div class="task-edit">' +
              '<label class="field">' +
                "<span>Task</span>" +
                '<textarea data-role="edit-text">' + esc(task.text) + "</textarea>" +
              "</label>" +
              '<div class="field-grid">' +
                '<label class="field-compact">' +
                  "<span>Due</span>" +
                  '<input type="date" data-role="edit-due" value="' + esc(task.dueDate || "") + '">' +
                "</label>" +
                '<div class="field-compact">' +
                  "<span>Source</span>" +
                  '<input type="text" value="' + esc(task.relativePath) + '" disabled>' +
                "</div>" +
              "</div>" +
              '<div class="inline-actions">' +
                '<button type="button" class="btn btn-primary" data-action="save-edit" data-task-id="' + esc(task.id) + '">Save</button>' +
                '<button type="button" class="btn" data-action="cancel-edit">Cancel</button>' +
                '<button type="button" class="btn" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">Open File</button>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</article>";
      }

      return '<article class="' + itemClasses + '" data-task-id="' + esc(task.id) + '" tabindex="-1">' +
        '<label class="task-row-toggle-entry"><input class="task-row-toggle" type="checkbox" data-action="toggle" data-task-id="' + esc(task.id) + '"' + (task.done ? " checked" : "") + "></label>" +
        '<div class="task-row-body">' +
          '<div class="task-row-main">' +
            '<div class="task-row-title-entry"><button type="button" class="task-row-title" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">' + esc(task.text) + "</button></div>" +
            '<div class="task-row-secondary-actions">' +
              '<button type="button" class="task-row-action-icon" data-action="edit" data-task-id="' + esc(task.id) + '" title="Edit" aria-label="Edit">' + renderTaskActionIcon("edit") + '</button>' +
              '<button type="button" class="task-row-action-icon" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '" title="Open" aria-label="Open">' + renderTaskActionIcon("open") + '</button>' +
              '<button type="button" class="task-row-action-icon" data-action="delete" data-task-id="' + esc(task.id) + '" title="Delete" aria-label="Delete">' + renderTaskActionIcon("delete") + '</button>' +
            "</div>" +
            '<div class="task-row-more-menu">' +
              '<button type="button" class="task-row-more-btn" data-action="more" data-task-id="' + esc(task.id) + '">More</button>' +
              '<div class="task-row-more-dropdown" data-more-dropdown="' + esc(task.id) + '">' +
                '<button type="button" data-action="edit" data-task-id="' + esc(task.id) + '">Edit</button>' +
                '<button type="button" data-action="open" data-file="' + esc(task.filePath) + '" data-line="' + task.lineIndex + '">Open</button>' +
                '<button type="button" class="is-danger" data-action="delete" data-task-id="' + esc(task.id) + '">Delete</button>' +
              "</div>" +
            "</div>" +
          "</div>" +
          renderTaskMeta(task) +
        "</div>" +
      "</article>";
    }

    function renderCandidateItem(task, index) {
      const canAdd = canAddDashboardCandidate(task, getExistingTaskKeys());
      const itemClasses = ["task-row", "task-row-candidate", task.existsAlready ? "is-candidate-blocked" : ""]
        .filter(Boolean)
        .join(" ");
      return '<article class="' + itemClasses + '">' +
        '<div class="task-row-leading"><span class="badge task-row-label">AI</span></div>' +
        '<div class="task-row-body">' +
          '<div class="task-row-main">' +
            '<div class="task-row-title-entry"><div class="task-row-title">' + esc(task.text) + '</div></div>' +
            '<div class="task-row-candidate-actions">' +
              '<span class="badge task-row-label">Candidate</span>' +
              '<button type="button" class="text-btn" data-action="dismiss-candidate" data-index="' + index + '">Dismiss</button>' +
              '<button type="button" class="text-btn' + (canAdd ? '' : ' is-danger') + '"' + (canAdd ? '' : ' disabled') + ' data-action="add-candidate" data-index="' + index + '">Add</button>' +
              (canAdd ? '' : '<span class="badge is-danger">Already exists</span>') +
            '</div>' +
          '</div>' +
          renderCandidateMeta(task) +
        '</div>' +
      '</article>';
    }

    function renderCandidateBlock() {
      const candidateBlock = document.getElementById("candidate-block");
      const candidateItems = document.getElementById("candidate-items");
      if (!candidateBlock || !candidateItems) {
        return;
      }

      const visibleCandidates = getVisibleCandidates();
      const hasCandidates = visibleCandidates.length > 0;
      const shouldShow = state.candidateBlockShown || hasCandidates;

      if (!shouldShow) {
        candidateBlock.style.display = "none";
        return;
      }

      candidateBlock.style.display = "";
      if (!state.candidateBlockShown) {
        state.candidateBlockShown = true;
      }

      let html = "";
      if (state.candidateBlockError) {
        html += '<div class="candidate-block-error">' +
          '<span class="candidate-block-error-text">' + esc(state.candidateBlockError) + '</span>' +
          '<button type="button" class="candidate-block-error-dismiss" data-action="dismiss-candidate-error" aria-label="Dismiss error">&times;</button>' +
          '</div>';
      }

      if (!hasCandidates) {
        html += '<div class="empty-state">' +
          '<strong class="empty-state-title">No candidates yet</strong>' +
          '<p class="empty-state-body">Use AI Extract or From Notes to find task candidates from your Moments and notes.</p>' +
        '</div>';
        candidateItems.innerHTML = html;
        return;
      }

      html += visibleCandidates
        .map(function (task, index) {
          return renderCandidateItem(task, index);
        })
        .join("");

      candidateItems.innerHTML = html;
    }

    var candidateBlockEl = document.getElementById("candidate-block");
    if (candidateBlockEl) {
      candidateBlockEl.addEventListener("click", function (event) {
        var actionEl = event.target.closest("[data-action]");
        if (!actionEl) {
          return;
        }
        var action = actionEl.dataset.action;
        if (action === "dismiss-candidate-error") {
          state.candidateBlockError = "";
          persistState();
          rerender();
        } else if (action === "add-extracted" || action === "add-candidate") {
          handleAddExtractedAction(actionEl);
        } else if (action === "dismiss-extracted" || action === "dismiss-candidate") {
          handleDismissExtractedAction(actionEl);
        }
      });
    }

    function renderEmptyState(message) {
      const parts = String(message || "").split("||");
      const title = parts[0] || "";
      const body = parts[1] || "";
      return '<div class="empty-state">' +
        '<strong class="empty-state-title">' + esc(title) + '</strong>' +
        (body ? '<p class="empty-state-body">' + esc(body) + '</p>' : '') +
      '</div>';
    }

    function renderTasks() {
      const viewModel = getListViewModel();
      if (viewModel.emptyMessage) {
        taskList.innerHTML = renderEmptyState(viewModel.emptyMessage);
        return;
      }

      const visibleCandidates = getVisibleCandidates();
      if (viewModel.flatItems && viewModel.flatItems.length > 0) {
        taskList.innerHTML = viewModel.flatItems
          .map(function (item) {
            if (item.kind === "candidate") {
              const index = visibleCandidates.findIndex(function (candidate) {
                return candidate.order === item.order;
              });
              return renderCandidateItem(item, index);
            }
            return renderTaskItem(item);
          })
          .join("");
        return;
      }

      const html = viewModel.sections
        .map(function (section) {
          const subtitle = state.filter === "all"
            ? simplifiedSectionDescriptions[section.key]
            : "filtered items";
          const items = section.items
            .map(function (item) {
              if (item.kind === "candidate") {
                const index = visibleCandidates.findIndex(function (candidate) {
                  return candidate.order === item.order;
                });
                return renderCandidateItem(item, index);
              }
              return renderTaskItem(item);
            })
            .join("");
          return '<section class="task-section">' +
            '<div class="task-section-header">' +
              "<h3>" + esc(section.title) + "</h3>" +
              "<span>" + section.items.length + " · " + esc(subtitle) + "</span>" +
            "</div>" +
            '<div class="task-items">' + items + "</div>" +
          "</section>";
        })
        .join("");

      taskList.innerHTML = html;
    }

    function setAiStatus(type, message) {
      state.aiStatusType = type;
      state.aiStatus = message || "";
      persistState();

      aiStatus.className = "status-line" + (type === "error" ? " is-error" : "");
      aiStatus.textContent = state.aiStatus;
    }

    function setNotesAiStatus(type, message) {
      state.notesAiStatusType = type;
      state.notesAiStatus = message || "";
      persistState();

      notesStatus.className = "status-line" + (type === "error" ? " is-error" : "");
      notesStatus.textContent = state.notesAiStatus;
    }

    function syncStaticInputs() {
      taskSearchInput.value = state.search;
      notesFromDateInput.value = state.notesFromDate;
      notesToDateInput.value = state.notesToDate;
      setAiStatus(state.aiStatusType, state.aiStatus);
      setNotesAiStatus(state.notesAiStatusType, state.notesAiStatus);

      // Sync advanced panel
      const advancedPanel = document.getElementById("extract-advanced-panel");
      if (advancedPanel) {
        advancedPanel.style.display = state.advancedPanelOpen ? "block" : "none";
      }

      // Sync model selector
      const modelSelect = document.getElementById("ai-model-select");
      if (modelSelect) {
        modelSelect.value = state.selectedModel;
      }
    }

    function rerender() {
      persistState();
      renderFilters();
      renderTasks();
      renderCandidateBlock();
    }

    document.getElementById("btn-refresh").addEventListener("click", function () {
      vscode.postMessage({ command: "refresh" });
    });

    document.getElementById("btn-create-task").addEventListener("click", function () {
      const text = newTaskText.value.trim();
      if (!text) {
        setAiStatus("error", "Task text is required.");
        return;
      }

      newTaskText.value = "";
      state.aiStatus = "";
      state.aiStatusType = "idle";
      if (state.filter !== "all") {
        state.filter = "all";
      }
      persistState();
      vscode.postMessage({
        command: "createTask",
        text,
        targetDate: null,
        dueDate: null,
      });
    });

    newTaskText.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.getElementById("btn-create-task").click();
      }
    });

    // Advanced panel toggle
    const advancedToggleBtn = document.getElementById("btn-extract-advanced");
    const advancedPanel = document.getElementById("extract-advanced-panel");
    if (advancedToggleBtn && advancedPanel) {
      advancedToggleBtn.addEventListener("click", function () {
        state.advancedPanelOpen = !state.advancedPanelOpen;
        advancedPanel.style.display = state.advancedPanelOpen ? "block" : "none";
        persistState();
      });
    }

    // Model selection
    const modelSelect = document.getElementById("ai-model-select");
    if (modelSelect) {
      modelSelect.value = state.selectedModel;
      modelSelect.addEventListener("change", function (event) {
        state.selectedModel = event.target.value;
        persistState();
      });
    }

    document.getElementById("btn-ai-extract").addEventListener("click", function () {
      mergeCandidateBatch("moments", []);
      setAiStatus("processing", state.notesFromDate + " ～ " + state.notesToDate + " の Moments を分析しています...");
      rerender();
      vscode.postMessage({
        command: "aiExtract",
        fromDate: state.notesFromDate,
        toDate: state.notesToDate,
        modelId: state.selectedModel,
      });
    });

    document.getElementById("btn-extract-notes").addEventListener("click", function () {
      mergeCandidateBatch("notes", []);
      setNotesAiStatus("processing", state.notesFromDate + " ～ " + state.notesToDate + " のノートを分析しています...");
      rerender();
      vscode.postMessage({
        command: "extractFromNotes",
        fromDate: state.notesFromDate,
        toDate: state.notesToDate,
        modelId: state.selectedModel,
      });
    });

    document.getElementById("notes-from-date").addEventListener("input", function (event) {
      state.notesFromDate = event.target.value || dashboardData.today;
      persistState();
    });

    document.getElementById("notes-to-date").addEventListener("input", function (event) {
      state.notesToDate = event.target.value || dashboardData.today;
      persistState();
    });

    taskSearchInput.addEventListener("input", function (event) {
      state.search = event.target.value;
      rerender();
    });



    function handleAddExtractedAction(actionEl) {
      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);
      const visibleCandidates = getVisibleCandidates();
      if (Number.isNaN(index) || !visibleCandidates[index]) {
        return;
      }

      const task = visibleCandidates[index];
      if (!canAddDashboardCandidate(task, getExistingTaskKeys())) {
        rerender();
        return;
      }

      const requestId = createPendingCandidateRequestId(task);
      pendingCandidateAdds.push({
        requestId: requestId,
        order: task.order,
        key: extractedTaskKey(task),
        source: task.source,
      });

      state.candidateTasks = (state.candidateTasks || []).map(function (candidate) {
        return candidate.order === task.order ? { ...candidate, added: true } : candidate;
      });
      if (!state.addedCandidateKeys.includes(extractedTaskKey(task))) {
        state.addedCandidateKeys = state.addedCandidateKeys.concat([extractedTaskKey(task)]);
      }
      persistState();

      vscode.postMessage({
        command: "addExtractedTask",
        requestId: requestId,
        text: task.text,
        dueDate: task.dueDate || null,
        targetDate: state.targetDate || null,
      });
      rerender();
    }

    function handleDismissExtractedAction(actionEl) {
      const index = Number.parseInt(actionEl.dataset.index || "-1", 10);
      const visibleCandidates = getVisibleCandidates();
      if (Number.isNaN(index) || !visibleCandidates[index]) {
        return;
      }

      const task = visibleCandidates[index];
      state.candidateTasks = (state.candidateTasks || []).filter(function (candidate) {
        return candidate.order !== task.order;
      });
      state.candidateBlockError = "";
      persistState();
      vscode.postMessage({
        command: "dismissExtractedTask",
        text: task.text,
      });
      rerender();
    }

    filterRow.addEventListener("click", function (event) {
      const button = event.target.closest("[data-filter]");
      if (!button) {
        return;
      }

      state.filter = button.dataset.filter;
      rerender();
    });

    taskList.addEventListener("click", function (event) {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) {
        return;
      }

      const action = actionEl.dataset.action;
      if (action === "edit") {
        state.editingId = actionEl.dataset.taskId || null;
        rerender();
        return;
      }

      if (action === "cancel-edit") {
        state.editingId = null;
        rerender();
        return;
      }

      if (action === "save-edit") {
        const taskEl = actionEl.closest("article[data-task-id]");
        if (!taskEl) {
          return;
        }

        const textInput = taskEl.querySelector("[data-role='edit-text']");
        const dueInput = taskEl.querySelector("[data-role='edit-due']");
        const nextText = textInput ? textInput.value : "";
        const nextDue = dueInput ? dueInput.value : "";
        state.editingId = null;
        persistState();
        vscode.postMessage({
          command: "updateTask",
          taskId: actionEl.dataset.taskId,
          text: nextText,
          dueDate: nextDue || null,
        });
        return;
      }

      if (action === "delete") {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) {
          return;
        }

        vscode.postMessage({ command: "deleteTask", taskId });
        return;
      }

      if (action === "open") {
        vscode.postMessage({
          command: "openFile",
          filePath: actionEl.dataset.file || "",
          lineIndex: Number.parseInt(actionEl.dataset.line || "0", 10),
        });
        return;
      }

      if (action === "more") {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) {
          return;
        }
        const dropdown = document.querySelector('[data-more-dropdown="' + taskId + '"]');
        if (!dropdown) {
          return;
        }
        const isOpen = dropdown.classList.contains("is-open");
        document.querySelectorAll(".task-row-more-dropdown.is-open").forEach(function (d) {
          d.classList.remove("is-open");
        });
        if (!isOpen) {
          dropdown.classList.add("is-open");
        }
        return;
      }

      if (action === "add-extracted" || action === "add-candidate") {
        handleAddExtractedAction(actionEl);
        return;
      }

      if (action === "dismiss-extracted" || action === "dismiss-candidate") {
        handleDismissExtractedAction(actionEl);
        return;
      }
    });

    taskList.addEventListener("change", function (event) {
      const checkbox = event.target.closest("[data-action='toggle']");
      if (!checkbox) {
        return;
      }

      vscode.postMessage({
        command: "toggleTask",
        taskId: checkbox.dataset.taskId,
        done: checkbox.checked,
      });
    });

    document.addEventListener("click", function (event) {
      const moreBtn = event.target.closest("[data-action='more']");
      if (!moreBtn) {
        const openDropdown = document.querySelector(".task-row-more-dropdown.is-open");
        if (openDropdown) {
          openDropdown.classList.remove("is-open");
        }
      }
    });

    window.addEventListener("message", function (event) {
      const message = event.data;
      if (message.type === "aiStatus") {
        setAiStatus(message.status, message.message || "");
        rerender();
        return;
      }

      if (message.type === "extractResult") {
        state.filter = "all";
        state.candidateBlockShown = true;
        state.candidateBlockError = "";
        mergeCandidateBatch("moments", message.tasks || []);
        persistState();
        rerender();
        return;
      }

      if (message.type === "candidateAddResult") {
        state.candidateBlockError = "";
        removePendingCandidateAdd(message.requestId || null);
        rerender();
        return;
      }

      if (message.type === "candidateAddFailed") {
        const pending = removePendingCandidateAdd(message.requestId || null);
        if (pending) {
          state.candidateTasks = (state.candidateTasks || []).map(function (candidate) {
            return candidate.order === pending.order ? { ...candidate, added: false } : candidate;
          });
          state.addedCandidateKeys = (state.addedCandidateKeys || []).filter(function (key) {
            return key !== pending.key;
          });
        }
        state.candidateBlockError = message.message || "Failed to add candidate task.";
        if (pending && pending.source === "notes") {
          setNotesAiStatus("error", message.message || "Failed to add candidate task.");
        } else {
          setAiStatus("error", message.message || "Failed to add candidate task.");
        }
        rerender();
        return;
      }

      if (message.type === "notesAiStatus") {
        setNotesAiStatus(message.status, message.message || "");
        rerender();
        return;
      }

      if (message.type === "notesExtractResult") {
        state.filter = "all";
        state.candidateBlockShown = true;
        state.candidateBlockError = "";
        mergeCandidateBatch("notes", message.tasks || []);
        persistState();
        rerender();
      }
    });

    syncStaticInputs();
    rerender();
  </script>
</body>
</html>`;
}
