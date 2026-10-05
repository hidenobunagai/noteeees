// Real Moments webview capture: seeds sample notes, serves the harness page
// (real panel markup + real feed), drives it with Playwright and writes one PNG
// plus element boxes per step for tools/demo/make_demo.py.
//
//   bun tools/demo/capture.ts          # -> tools/demo/shots/
//
// Playwright is deliberately not a dependency of this repo: the script uses a
// local install if one exists, then $PLAYWRIGHT_MODULE, then any
// `~/projects/*/node_modules/playwright` on this machine.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HERE = import.meta.dir;
const OUT = path.join(HERE, "shots");
const VIEWPORT = { width: 420, height: 860 }; // sidebar-like Moments panel
const DSF = 3; // device pixels per CSS pixel in every PNG
const TEXT = "Draft the release notes #work"; // typed into the composer live

type Box = { x: number; y: number; width: number; height: number } | null;
type Shot = { png: string; name: string; box: Box };

async function loadPlaywright(): Promise<any> {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    "playwright",
    ...localPlaywrightInstalls(),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch {
      // try the next install location
    }
  }
  throw new Error(
    "playwright not found — `bun add -d playwright` here, or set PLAYWRIGHT_MODULE to an install",
  );
}

function localPlaywrightInstalls(): string[] {
  const projects = path.join(homedir(), "projects");
  if (!existsSync(projects)) return [];
  return readdirSync(projects)
    .map((name) => path.join(projects, name, "node_modules", "playwright"))
    .filter((dir) => existsSync(dir));
}

/** Starts tools/demo/harness.ts and returns its base URL. */
async function startHarness(): Promise<{ url: string; stop: () => void }> {
  const proc = Bun.spawn(
    [
      process.execPath,
      "--tsconfig-override",
      path.join(HERE, "tsconfig.json"),
      path.join(HERE, "harness.ts"),
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("harness exited before printing its URL");
    buffer += decoder.decode(value, { stream: true });
    const line = buffer.split("\n")[0];
    if (line.startsWith("HARNESS ")) {
      return { url: line.slice("HARNESS ".length).trim(), stop: () => proc.kill() };
    }
  }
}

const harness = await startHarness();
const shots: Shot[] = [];
const boxes: Record<string, Box> = {};
let browser: { close: () => Promise<void> } | null = null;
try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const { chromium } = await loadPlaywright();
  // Fall back to installed Chrome when Playwright's bundled browser is missing.
  browser = (await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }))) as never;
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF });
  const page = await context.newPage();
  let index = 0;

  const shot = async (name: string, box: Box = null): Promise<void> => {
    const png = `${String(index++).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, png), timeout: 15000 });
    shots.push({ png, name, box });
  };

  await page.goto(harness.url, { waitUntil: "load" });
  await page.waitForSelector("#timeline .entry");
  await page.waitForTimeout(600);

  boxes.labelToday = await page.locator(".day-section-label").nth(0).boundingBox();
  boxes.labelOlder = await page.locator(".day-section-label").nth(1).boundingBox();
  boxes.timeline = await page.locator("#timeline").boundingBox();
  await shot("feed-top");
  // Focus the composer, then capture every prefix of the typed moment so
  // make_demo.py can play the typing back frame by frame.
  await page.locator("#inputBox").click();
  await page.waitForTimeout(250);
  boxes.input = await page.locator("#inputBox").boundingBox();
  await shot("type");
  for (const char of TEXT) {
    await page.keyboard.type(char);
    await shot("type");
  }

  // Enter -> addMoment -> the real appendMoment() writes the file and the
  // extension's update message renders the new entry at the top of today.
  await page.keyboard.press("Enter");
  await page.waitForSelector(`#timeline .entry:has-text("${TEXT}")`);
  await page.waitForTimeout(400);
  boxes.addedEntry = await page.locator("#timeline .entry").nth(0).boundingBox();
  const tag = page.locator("#timeline button.tag").filter({ hasText: "#work" }).first();
  boxes.tag = await tag.boundingBox();
  await shot("added", boxes.tag);

  await tag.click();
  await page.waitForTimeout(400);
  if (!(await page.locator("#activeTagBtn").isVisible())) {
    throw new Error("#work tag click did not activate the filter chip");
  }
  await shot("filtered");
  boxes.resultLabelToday = await page.locator(".day-section-label").nth(0).boundingBox();
  boxes.resultLabelOlder = await page.locator(".day-section-label").nth(1).boundingBox();

  writeFileSync(
    path.join(OUT, "shots.json"),
    JSON.stringify(
      {
        viewport: [VIEWPORT.width, VIEWPORT.height],
        deviceScaleFactor: DSF,
        text: TEXT,
        boxes,
        shots,
      },
      null,
      2,
    ),
  );
  console.log(`${shots.length} shots -> ${OUT}`);
} finally {
  await browser?.close().catch(() => {});
  harness.stop();
}
