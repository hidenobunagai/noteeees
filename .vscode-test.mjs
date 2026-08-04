import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/src/test/**/*.test.js",
  version: "1.121.0",
});
