// Actual OS process interruption. Observers use persisted files; no mocked I/O.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync, watch } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
if (process.platform === "win32")
  throw new Error(
    "This acceptance uses SIGSTOP/SIGKILL; run it on macOS or Linux.",
  );
const root = resolve(import.meta.dirname, ".."),
  parent = join(root, "output", "storage-crashes");
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, "run-")),
  entry = join(output, "worker.mjs");
process.env.SHOWAI_VIEWER = join(root, "dist-portable/portable.html");
await build({
  stdin: {
    contents: `import {GitLibrary} from './src/core/git-library.ts'; import {FileStore} from './src/core/store.ts'; import {LibraryImport} from './src/core/library-import.ts'; import {openLibrary} from './src/core/open-library.ts'; export {GitLibrary,FileStore,LibraryImport,openLibrary}; const [mode,home,id]=process.argv.slice(2); if(mode==='init')await openLibrary(home); if(mode==='write'){const lib=new GitLibrary(home);const files=new Map(Array.from({length:500},(_,i)=>['packages/crash-input/file-'+i+'.txt',Buffer.from('recoverable input '+i)]));await lib.writeFiles(files,{actor:{kind:'system'},channel:'system',operationId:'crash-write'});} if(mode==='activate')await new LibraryImport(home).activate(id);`,
    resolveDir: root,
    sourcefile: "crash-worker.ts",
    loader: "ts",
  },
  outfile: entry,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  plugins: [rawSourcePlugin],
});
// Import the same saved bundle without a work mode for parent-side verification.
const { GitLibrary, FileStore, LibraryImport, openLibrary } = await import(
  pathToFileURL(entry).href
);
const checks = [],
  result = { passed: false, output, checks };
async function interrupt(mode, home, observe, id) {
  const child = spawn(
    process.execPath,
    [entry, mode, home, ...(id ? [id] : [])],
    {
      cwd: root,
      env: {
        ...process.env,
        SHOWAI_VIEWER: join(root, "dist-portable/portable.html"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "",
    caught = false;
  child.stderr.on("data", (data) => {
    logs += data;
  });
  const watchers = [];
  const inspect = () => {
    if (caught || child.exitCode !== null || child.signalCode !== null) return;
    if (observe()) {
      process.kill(child.pid, "SIGSTOP");
      caught = true;
    }
  };
  for (const path of [
    home,
    join(home, "local"),
    join(home, "repository.git", "refs", "heads"),
    ...(id ? [join(home, "local", "imports", id)] : []),
  ])
    if (existsSync(path)) watchers.push(watch(path, inspect));
  const timer = setInterval(inspect, 2),
    deadline = Date.now() + 15000;
  try {
    while (
      !caught &&
      child.exitCode === null &&
      child.signalCode === null &&
      Date.now() < deadline
    )
      await new Promise((done) => setTimeout(done, 5));
    assert.ok(
      caught,
      `The process did not reach the observed interruption point: ${mode}: ${logs}`,
    );
    process.kill(child.pid, "SIGKILL");
    await once(child, "exit");
    assert.equal(child.signalCode, "SIGKILL");
    return logs;
  } finally {
    clearInterval(timer);
    for (const watcher of watchers) watcher.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  }
}
try {
  const bootstrap = join(output, "bootstrap");
  await mkdir(join(bootstrap, "local"), { recursive: true });
  await interrupt(
    "init",
    bootstrap,
    () =>
      existsSync(join(bootstrap, "local/library-bootstrap.json")) &&
      !existsSync(join(bootstrap, "library.json")),
  );
  const pending = JSON.parse(
    await readFile(join(bootstrap, "local/library-bootstrap.json"), "utf8"),
  );
  await openLibrary(bootstrap);
  assert.equal((await new GitLibrary(bootstrap).manifest()).id, pending.id);
  checks.push(
    "SIGKILL during initialization resumes the same library identity",
  );
  const before = join(output, "before-publication"),
    beforeLib = new GitLibrary(before);
  await beforeLib.initialize();
  await interrupt("write", before, () => {
    const directory = join(before, "local/transactions");
    if (!existsSync(directory)) return false;
    return readdirSync(directory).some(
      (name) =>
        existsSync(
          join(directory, name, "input/packages/crash-input/file-499.txt"),
        ) && !existsSync(join(before, "repository.git/refs/heads/content")),
    );
  });
  assert.equal(await beforeLib.head(), null);
  await beforeLib.recover();
  const drafts = readdirSync(join(before, "local/drafts"));
  assert.ok(drafts.some((name) => name.startsWith("interrupted-")));
  checks.push(
    "SIGKILL before ref publication retains incoming edits as an interrupted draft",
  );
  const preserved = drafts.find((name) => name.startsWith("interrupted-"));
  assert.equal(
    await readFile(
      join(
        before,
        "local/drafts",
        preserved,
        "input/packages/crash-input/file-499.txt",
      ),
      "utf8",
    ),
    "recoverable input 499",
  );
  const after = join(output, "after-publication"),
    afterLib = new GitLibrary(after);
  await afterLib.initialize();
  await interrupt("write", after, () =>
    existsSync(join(after, "repository.git/refs/heads/content")),
  );
  const revision = await afterLib.head();
  assert.ok(revision);
  await afterLib.recover();
  assert.equal(
    (await afterLib.readFile("packages/crash-input/file-499.txt")).toString(),
    "recoverable input 499",
  );
  assert.equal(
    await readFile(
      join(afterLib.workspace, "packages/crash-input/file-499.txt"),
      "utf8",
    ),
    "recoverable input 499",
  );
  await afterLib.verify();
  checks.push(
    "SIGKILL after ref publication rebuilds every missing projection from committed objects",
  );
  const original = join(output, "migration"),
    store = new FileStore(original),
    project = await store.createProject({ name: "Interrupted migration" }),
    page = await store.createPage(project.id);
  const raw = await readFile(page.path),
    importer = new LibraryImport(original),
    report = await importer.prepare(original),
    plan = join(original, "local/imports", report.id, "installation.json");
  await interrupt(
    "activate",
    original,
    () =>
      JSON.parse(readFileSync(plan, "utf8")).state === "installing" &&
      !existsSync(join(original, "library.json")),
    report.id,
  );
  await importer.activate(report.id);
  assert.deepEqual(await readFile(page.path), raw);
  assert.equal(
    (await store.readPage(project.id, page.document.id)).document.id,
    page.document.id,
  );
  await new GitLibrary(original).verify();
  checks.push(
    "SIGKILL during activation resumes the verified import and preserves original files",
  );
  result.passed = true;
} catch (error) {
  result.failure = error.stack;
  throw error;
} finally {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
