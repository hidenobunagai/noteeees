// Temporary refactor helper — rewrites MomentsViewProvider._getHtml() to use
// the extracted webview assets (momentsStyle / momentsScript) with a nonce-based CSP.
import { readFileSync, writeFileSync } from "node:fs";

const p = "src/moments/panel.ts";
const src = readFileSync(p, "utf8");
const lines = src.split("\n");

const find = (s) => lines.findIndex((l) => l === s);
const styleStart = find("<style>");
const styleEnd = find("</style>");
const scriptStart = find("<script>");
const scriptEnd = find("</script>");
const headerStart = lines.findIndex((l) =>
  l.includes("const dueDatePatternSource = JSON.stringify"),
);

if ([styleStart, styleEnd, scriptStart, scriptEnd, headerStart].some((i) => i < 0)) {
  console.error("markers not found", { styleStart, styleEnd, scriptStart, scriptEnd, headerStart });
  process.exit(1);
}

// --- Build the new header block (replaces headerStart..styleStart inclusive) ---
const newHeader = `    const nonce = crypto.randomBytes(16).toString("hex");
    const dueDatePatternSource = JSON.stringify(DUE_DATE_RE.source);
    const i18nScript = buildWebviewI18nScript();
    const script = momentsScript.replace("__DUE_DATE_PATTERN_SOURCE__", dueDatePatternSource);

    return /* html */ \`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-\${nonce}' 'unsafe-inline'; script-src 'nonce-\${nonce}';">
<title>Moments</title>
<style nonce="\${nonce}">
\${momentsStyle}
</style>`.split("\n");

// --- New script opening block (replaces scriptStart..scriptStart+1 inclusive) ---
const newScriptOpen = [
  '<script nonce="${nonce}">${i18nScript}</script>',
  '<script nonce="${nonce}">',
];

// Splice from the back to keep indices valid:
// 1) script body: lines (scriptStart+2 .. scriptEnd-1) -> ["${script}"]
lines.splice(scriptStart + 2, scriptEnd - (scriptStart + 2), "${script}");
// 2) script open: replace scriptStart..scriptStart+1 with newScriptOpen
lines.splice(scriptStart, 2, ...newScriptOpen);
// 3) CSS body: lines (styleStart+1 .. styleEnd-1) -> remove (header now embeds ${momentsStyle})
lines.splice(styleStart + 1, styleEnd - (styleStart + 1));
// 4) header: headerStart..styleStart -> newHeader
lines.splice(headerStart, styleStart - headerStart + 1, ...newHeader);

writeFileSync(p, lines.join("\n") + "\n", "utf8");
console.log("rewrote", p);
