import { dashboardScript } from "./webview/generated.js";

/**
 * Dashboard webview script — embedded into the panel HTML.
 *
 * The script body lives in webview/dashboard-script.js (a real JS file) and is
 * inlined at build time by scripts/embed-webview.mjs. Placeholders:
 *   __DASHBOARD_DATA__             → serialized DashboardData JSON
 *   __DUE_TOKEN_PATTERN_SOURCE__   → source of the due-token regex
 */
export function buildDashboardWebviewScript(
  nonce: string,
  dashboardData: string,
  browserDueTokenPatternSource: string,
): string {
  const script = dashboardScript
    .replace("__DASHBOARD_DATA__", dashboardData)
    .replace("__DUE_TOKEN_PATTERN_SOURCE__", browserDueTokenPatternSource);

  return `<script nonce="${nonce}">
${script}
  </script>`;
}
