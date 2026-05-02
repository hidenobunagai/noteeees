/** Dashboard webview CSS — injected inline via a <style nonce> block. */
export function buildDashboardWebviewCss(_nonce: string): string {
  return `
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
  }`;
}
