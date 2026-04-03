function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildDashboardExtractSectionHtml(today: string): string {
  return `              <!-- Moments Extract -->
               <section class="action-bar-extract-group" data-extract-group="moments">
                 <span class="extract-group-label">From Moments</span>
                 <div class="extract-stack">
                   <input id="ai-source-date" type="date" value="${escAttr(today)}" class="extract-date-input" />
                   <div class="extract-submit-row">
                     <button class="btn" id="btn-ai-extract" type="button">Extract</button>
                   </div>
                 </div>
                 <div class="status-line" id="ai-status"></div>
               </section>

               <!-- Notes Extract -->
               <section class="action-bar-extract-group" data-extract-group="notes">
                 <span class="extract-group-label">From Notes</span>
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
                 <div class="status-line" id="notes-extract-status"></div>
               </section>`;
}
