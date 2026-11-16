import { startBrowserServer } from "../src/browser/server";
import { FileStore } from "../src/core/store";
import { SqliteLibrary } from "../src/core/sqlite-library";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicLibraryFile } from "../src/core/library-files";
import { selectPerfPages } from "./interaction-perf-fixture.mjs";

const [
  home,
  profile,
  webRoot,
  cliEntry,
  output,
  documentId,
  boardId,
  listOnly,
] = process.argv.slice(2);
const library = new SqliteLibrary(home);
const store = new FileStore(home);
const projects = await store.listProjects();
const catalog = [];
for (const project of projects) {
  const pages = await store.listPages(project.id);
  for (const page of pages) {
    const bytes = await library.readFile(
      `projects/${project.id}/pages/${page.id}.json`,
    );
    if (!bytes) continue;
    const decoded = JSON.parse(bytes.toString());
    const document = decoded.document ?? decoded;
    let nodes = 0,
      text = 0,
      widgets = 0,
      pdfs = 0;
    function visit(node: any) {
      nodes++;
      if (node.type === "text") text += node.text?.length ?? 0;
      if (node.type === "widget" || node.type === "component") widgets++;
      if (node.attrs?.kind === "pdf") pdfs++;
      for (const child of node.content ?? []) visit(child);
    }
    visit(document.content);
    const folders: string[] = [];
    let parent = document.parentId;
    while (parent) {
      folders.unshift(parent);
      parent = project.folders?.find(
        (folder) => folder.id === parent,
      )?.parentId;
    }
    catalog.push({
      projectId: project.id,
      projectTitle: project.name,
      pageId: page.id,
      title: page.title,
      archived: document.archived,
      folders,
      rootId: document.content.attrs.id,
      kind: document.content.attrs.kind,
      nodes,
      text,
      widgets,
      pdfs,
      topObjects: document.content.content?.length ?? 0,
    });
  }
}
await writeFile(join(output, "catalog.json"), JSON.stringify(catalog, null, 2));
if (!listOnly) {
  const selected = selectPerfPages(catalog, {
    document: documentId,
    board: boardId,
  });
  const previous = JSON.parse(
    await readFile(join(output, "prepared.json"), "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return '{"paths":[]}';
    }),
  );
  const revision = await library.head();
  const paths = [
    ...new Set(
      Object.values(selected).flatMap((page: any) => [
        `projects/${page.projectId}/project.json`,
        `projects/${page.projectId}/pages/${page.pageId}.json`,
      ]),
    ),
  ];
  for (const [path, bytes] of await library.readFiles(
    paths.filter((path) => !previous.paths.includes(path)),
    revision!,
  ))
    await atomicLibraryFile(home, join(home, "workspace", path), bytes);
  await writeFile(
    join(output, "prepared.json"),
    JSON.stringify({
      revision,
      paths: [...new Set([...previous.paths, ...paths])],
      workspaceMaterializedFromSnapshot: true,
    }),
  );
}
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const server = await startBrowserServer({
  home,
  settingsPath: join(profile, "settings.json"),
  webRoot,
  cliEntry,
  registerAgentRuntime: false,
});
process.stdout.write(
  JSON.stringify({ url: server.url, home, pid: process.pid }) + "\n",
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  loop.disable();
  await writeFile(
    join(output, "server-performance.json"),
    JSON.stringify(
      {
        eventLoopP95Ms: loop.percentile(95) / 1e6,
        eventLoopMaxMs: loop.max / 1e6,
        memory: process.memoryUsage(),
        scope: "Whole backend run, including setup and orchestration waits",
      },
      null,
      2,
    ),
  );
}
process.on("SIGTERM", () => {
  void stop().then(() => process.exit(0));
});
process.on("SIGINT", () => {
  void stop().then(() => process.exit(0));
});
