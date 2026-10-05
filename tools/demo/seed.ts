// Seeds a scratch notes directory with the extension's own code, so the demo
// comes from real storage/UX code instead of hand-written fixtures:
//   - Moments feed: appendMoment()/collectMomentsFeed() (front matter, `- HH:MM
//     text` lines, tag extraction) via the fake clock below.
//   - Sample notes: the real filename rules (resolveFilename/resolveUniqueFilePath,
//     default `{dt}_{title}.{ext}` template) plus front matter with the keys the
//     default snippet (snippets/markdown.json) writes.
//   - Sidebar/backlink data: the real NotesTreeProvider and BacklinksProvider
//     tree logic (buildSidebarTagGroups/orderPinnedNotes/limitSidebarNotes,
//     collectBacklinks), dumped to .notes/notes-data.json for make_demo.py.
//
//   bun --tsconfig-override=tools/demo/tsconfig.json tools/demo/seed.ts   # prints the feed JSON
//
// Timestamps come from a fixed fake clock (fake-clock.ts), so reruns produce
// byte-identical files and the demo keeps saying "today" is TODAY.
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { getMomentsSubfolderSetting } from "../../src/notesConfig.js";
import { appendMoment, collectMomentsFeed } from "../../src/moments/fileIo.js";
import type { MomentsFeedData } from "../../src/moments/fileIo.js";
import { getIndexedNotesCached } from "../../src/notesIndexCache.js";
import { resolveFilename, resolveUniqueFilePath } from "../../src/noteCommands.js";
import { buildSidebarTagGroups, buildTagSummary, NotesTreeProvider } from "../../src/sidebarProvider.js";
import { BacklinksProvider, parseWikiLinks } from "../../src/wikiLinks.js";
import { installFakeClock, setNow } from "./fake-clock";

export const NOTES_DIR = path.join(import.meta.dir, ".notes");
export const NOTES_DATA = path.join(NOTES_DIR, "notes-data.json");
export const TODAY = "2026-10-05";
export const YESTERDAY = "2026-10-04";
/** Timestamp given to a moment captured live during the demo. */
export const CAPTURED_AT = `${TODAY}T17:06:00`;

/** [file date, capture timestamp, text] — neutral sample content, no real data. */
const ENTRIES: ReadonlyArray<readonly [string, string, string]> = [
  [YESTERDAY, `${YESTERDAY}T08:47:00`, "Sprint kickoff notes #work"],
  [YESTERDAY, `${YESTERDAY}T10:15:00`, "Changelog draft ready for review #work"],
  [YESTERDAY, `${YESTERDAY}T12:30:00`, "Idea: tag heatmap over the whole month #idea"],
  [YESTERDAY, `${YESTERDAY}T14:50:00`, "Read the VS Code webview API changelog"],
  [YESTERDAY, `${YESTERDAY}T16:10:00`, "Sidebar search feels much faster now"],
  [YESTERDAY, `${YESTERDAY}T17:25:00`, "Drafted the release checklist #work"],
  [YESTERDAY, `${YESTERDAY}T18:05:00`, "Booked the Friday demo slot #work"],
  [TODAY, `${TODAY}T11:40:00`, "Export a day of Moments as a note #idea"],
];

// ---------------------------------------------------------------- sample notes

interface SampleNote {
  title: string;
  tags: string[]; // front-matter tags (the inline `tags: [...]` form the parser reads)
  stamp: string; // creation time -> filename token + mtime
  pin?: boolean; // goes into the sidebar's pinned list (extension storage in real use)
  body: string; // markdown written after the front matter, with [[wiki-links]] and #tags
}

/** Five neutral sample notes, linked to each other. */
const SAMPLES: readonly SampleNote[] = [
  {
    title: "Project Kickoff",
    tags: ["project", "planning"],
    stamp: "2026-10-01T09:00:00",
    pin: true,
    body:
      "\n## Goals\nShip the sidebar rewrite #project\n\n" +
      "## Next steps\n- Review [[Release Checklist]]\n- Prep [[Meeting 2026-10-05]]\n",
  },
  {
    title: "Release Checklist",
    tags: ["release"],
    stamp: "2026-10-02T10:30:00",
    pin: true,
    body:
      "\n- [ ] Bump the version #release\n- [ ] Update the changelog\n" +
      "- [ ] Tag, push, publish\n\nScope: [[Project Kickoff]]\n",
  },
  {
    title: "Architecture Overview",
    tags: ["project", "tech"],
    stamp: "2026-10-03T14:00:00",
    body:
      "\nNotes are plain .md files #tech\n\nNo database, just a folder.\n\n" +
      "Context: [[Project Kickoff]]\n",
  },
  {
    title: "Reading List",
    tags: ["reading"],
    stamp: "2026-10-04T16:45:00",
    body: "\n- VS Code extension API\n- Markdown tooling #reading\n\nPairs with [[Release Checklist]].\n",
  },
  {
    title: "Meeting 2026-10-05",
    tags: ["project"],
    stamp: `${TODAY}T09:15:00`,
    body:
      "\nTeam sync notes\n\n- Tag counts agreed #meeting\n- Demo plan drafted\n\n" +
      "Follow [[Project Kickoff]].\n",
  },
];

/** Title typed in the Cmd+Shift+N input during the demo. */
const NEW_NOTE_TITLE = "Sprint Retro";
const NEW_NOTE_AT = `${TODAY}T11:20:00`;

const SNIPPET_PATH = path.join(import.meta.dir, "..", "..", "snippets", "markdown.json");

/** Expands the real default snippet (snippets/markdown.json), as VS Code would. */
function renderNewNoteTemplate(title: string, section: string): string {
  const snippets = JSON.parse(readFileSync(SNIPPET_PATH, "utf8"));
  const body = (snippets["noteeees_template_note"].body as string[]).join("\n");
  return body
    .replaceAll("\t", "    ") // snippet indentation is inserted as editor indentation
    .replace("$1", () => "retro")
    .replace("$2", () => title)
    .replace("$3", () => NEW_NOTE_AT.slice(0, 10))
    .replace("$4", () => section);
}

function sampleContent(note: SampleNote): string {
  const date = note.stamp.slice(0, 10);
  return `---\ntags: [${note.tags.join(", ")}]\ntitle: ${note.title}\ndate: ${date}\n---\n\n# ${note.title}\n${note.body}`;
}

// ---------------------------------------------------------------- tree dumping

interface TreeNode {
  kind: string;
  label: string;
  description?: string;
  icon?: string;
  children?: TreeNode[];
}

/** Flattens a real TreeItem (stubbed vscode classes) into JSON. */
function toNode(item: {
  kind?: string;
  label?: unknown;
  description?: unknown;
  iconPath?: { id?: string };
}): TreeNode {
  return {
    kind: String(item.kind ?? "item"),
    label: String(item.label ?? ""),
    description:
      item.description === undefined || item.description === false
        ? undefined
        : String(item.description),
    icon: item.iconPath?.id,
  };
}

async function dumpSidebar(notesDir: string, pinned: string[]): Promise<TreeNode[]> {
  const provider = new NotesTreeProvider(
    () => notesDir,
    () => pinned,
    () => "frequency",
  );
  const sections: TreeNode[] = [];
  for (const root of await provider.getChildren()) {
    const node = toNode(root as never);
    node.children = [];
    for (const child of await provider.getChildren(root)) {
      const childNode = toNode(child as never);
      if (child.kind === "tagGroup") {
        childNode.children = (await provider.getChildren(child)).map((n) => toNode(n as never));
      }
      node.children.push(childNode);
    }
    sections.push(node);
  }
  return sections;
}

async function dumpBacklinks(notesDir: string, openFile: string): Promise<TreeNode[]> {
  // BacklinksProvider reads window.activeTextEditor.document.uri.fsPath.
  vscode.window.activeTextEditor = { document: { uri: { fsPath: openFile } } };
  const provider = new BacklinksProvider(() => notesDir);
  const backlinks: TreeNode[] = [];
  for (const root of await provider.getChildren()) {
    const node = toNode(root as never);
    node.children = (await provider.getChildren(root)).map((n) => toNode(n as never));
    backlinks.push(node);
  }
  vscode.window.activeTextEditor = undefined;
  return backlinks;
}

/** Writes the sample notes, then .notes/notes-data.json for make_demo.py. */
async function seedNotes(notesDir: string): Promise<void> {
  const pinned: string[] = [];
  const byTitle = new Map<string, string>(); // title -> relative path

  for (const sample of SAMPLES) {
    const when = new Date(sample.stamp);
    const filename = resolveFilename(sample.title, when);
    const filePath = await resolveUniqueFilePath(notesDir, filename);
    await fs.writeFile(filePath, sampleContent(sample), "utf8");
    const mtime = Date.parse(sample.stamp) / 1000;
    await fs.utimes(filePath, mtime, mtime);
    const relativePath = path.relative(notesDir, filePath);
    byTitle.set(sample.title, relativePath);
    if (sample.pin) pinned.push(relativePath);
  }

  // Sidebar tree from the real provider (pinned order / recent limit / tag groups).
  const sections = await dumpSidebar(notesDir, pinned);

  // Tag counts straight from the real helpers, as a flat summary.
  const indexed = await getIndexedNotesCached(notesDir, [getMomentsSubfolderSetting()]);
  const tagSummary = buildTagSummary(indexed.map((note) => ({ tags: note.metadata.tags })));
  const tagGroups = buildSidebarTagGroups(
    indexed.map((note) => ({
      tags: note.metadata.tags,
      title: note.metadata.title,
      relativePath: note.relativePath,
      mtime: note.mtime,
    })),
    "frequency",
  );

  // The note shown open in the editor scenes, read back from disk.
  const openRelativePath = byTitle.get("Project Kickoff")!;
  const openAbsolutePath = path.join(notesDir, openRelativePath);
  const openContent = await fs.readFile(openAbsolutePath, "utf8");
  const wikiLinks = parseWikiLinks(openContent);

  // Backlinks pointing at the open note (real BacklinksProvider tree).
  const backlinks = await dumpBacklinks(notesDir, openAbsolutePath);

  const noteMeta = indexed
    .slice()
    .sort((a, b) => b.mtime - a.mtime)
    .map((note) => ({
      relativePath: note.relativePath,
      title: note.metadata.title,
      tags: note.metadata.tags,
      preview: note.preview,
    }));

  // The Cmd+Shift+N note: real filename rules + real default snippet expansion.
  // Written after the sidebar dump so it is the "just created" file, not part of
  // the sidebar snapshot above.
  const newWhen = new Date(NEW_NOTE_AT);
  const newFilename = resolveFilename(NEW_NOTE_TITLE, newWhen);
  const newFilePath = await resolveUniqueFilePath(notesDir, newFilename);
  const newContent = renderNewNoteTemplate(NEW_NOTE_TITLE, "Summary");
  await fs.writeFile(newFilePath, newContent, "utf8");
  const newMtime = Date.parse(NEW_NOTE_AT) / 1000;
  await fs.utimes(newFilePath, newMtime, newMtime);

  await fs.writeFile(
    NOTES_DATA,
    JSON.stringify(
      {
        pinned,
        sections,
        tagSummary,
        tagGroups,
        backlinks,
        wikiLinks,
        notes: noteMeta,
        openNote: { relativePath: openRelativePath, content: openContent },
        newNote: {
          title: NEW_NOTE_TITLE,
          relativePath: path.relative(notesDir, newFilePath),
          filename: newFilename,
          content: newContent,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function seed(notesDir: string = NOTES_DIR): Promise<MomentsFeedData> {
  await fs.rm(notesDir, { recursive: true, force: true });
  installFakeClock(ENTRIES[0][1]);
  for (const [date, timestamp, text] of ENTRIES) {
    setNow(timestamp);
    await appendMoment(notesDir, date, text);
  }
  setNow(CAPTURED_AT);
  await seedNotes(notesDir);
  return collectMomentsFeed(notesDir, TODAY);
}

if (import.meta.main) {
  console.log(JSON.stringify(await seed(), null, 2));
}
