import { dashboardStyle } from "./webview/generated.js";

/** Dashboard webview CSS — injected inline via a <style nonce> block. */
export function buildDashboardWebviewCss(): string {
  return dashboardStyle;
}
