function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildDashboardExtractSectionHtml(today: string): string {
  return `              <!-- Moments Extract -->
              <div style="margin-bottom: 24px;">
                <span style="font-size: 12px; font-weight: 600; color: var(--muted); display: block; margin-bottom: 8px;">From Moments</span>
                <div class="extract-stack">
                  <input id="ai-source-date" type="date" value="${escAttr(today)}" class="extract-date-input" />
                  <div class="extract-submit-row">
                    <button class="btn" id="btn-ai-extract" type="button">Extract</button>
                  </div>
                </div>
                <div class="status-line" id="ai-status" style="margin-top: 4px;"></div>
                <div class="ai-result" id="ai-result" style="margin-top: 8px;"></div>
              </div>

              <!-- Notes Extract -->
              <div>
                <span style="font-size: 12px; font-weight: 600; color: var(--muted); display: block; margin-bottom: 8px;">From Notes</span>
                <div class="extract-stack">
                  <div class="extract-range-row">
                    <input id="notes-from-date" type="date" value="${escAttr(today)}" class="extract-date-input" />
                    <span class="extract-range-separator">-</span>
                    <input id="notes-to-date" type="date" value="${escAttr(today)}" class="extract-date-input" />
                  </div>
                  <div class="extract-submit-row">
                    <button class="btn" id="btn-extract-notes" type="button">Extract</button>
                  </div>
                </div>
                <div class="status-line" id="notes-extract-status" style="margin-top: 4px;"></div>
                <div class="ai-result" id="notes-extract-result" style="margin-top: 8px;"></div>
              </div>`;
}
