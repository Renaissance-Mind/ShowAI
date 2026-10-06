import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
const execute = promisify(execFile);
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const distribution = resolve(
  "release",
  `ShowAI-browser-${version}-${process.platform}-${process.arch}`,
);
const node = join(
  distribution,
  "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
const cli = join(distribution, "runtime/scripts/cli.mjs");
const home = await mkdtemp(join(tmpdir(), "showai-package-smoke-"));
const env = { ...process.env, SHOWAI_HOME: home };
delete env.SHOWAI_RUNTIME_ENTRY;
delete env.SHOWAI_VIEWER;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(node, [cli, "serve", "--no-open", "--json"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let errors = "";
child.stderr.on("data", (chunk) => {
  errors += chunk;
});
let exited = false;
const exit = new Promise((done) =>
  child.once("exit", (code) => {
    exited = true;
    done(code);
  }),
);
const startup = new Promise((done, reject) => {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("\n")) done(JSON.parse(output.split("\n")[0]).data);
  });
  child.once("error", reject);
  child.once("exit", (code) =>
    reject(new Error(`Packaged server exited ${code}: ${errors}`)),
  );
});
const timeout = setTimeout(() => child.kill(), 30000);
try {
  const { url } = await startup;
  const html = await (await fetch(url)).text();
  assert.match(html, /__SHOWAI_LOCAL__/);
  const build = JSON.parse(
    await readFile(join(distribution, "runtime/assets/build.json"), "utf8"),
  );
  assert.equal(build.version, version);
  assert.equal(build.pageModelVersion, 2);
  assert.match(build.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(html, /name="showai-model" content="2"/);
  for (const [path, digest] of Object.entries(build.frontendFiles)) {
    const bytes = await readFile(join(distribution, "runtime/web", path));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      digest,
      path,
    );
  }
  const script = html.match(/src="([^\"]+\.js)"/)[1];
  assert.equal((await fetch(new URL(script, url))).status, 200);
  const run = async (args) => {
    const output = await execute(node, [cli, ...args, "--json"], { env });
    const response = JSON.parse(output.stdout);
    assert.equal(response.ok, true);
    return response.data;
  };
  const project = await run(["projects", "create", "--name", "Packaged Agent"]);
  const page = await run([
    "pages",
    "create",
    "--project",
    project.id,
    "--title",
    "Bundled runtime",
  ]);
  assert.equal(page.document.content.type, "surface");
  await run([
    "catalog",
    "import",
    "--input",
    resolve("resources/catalog/value-slider"),
    "--project",
    project.id,
  ]);
  await run([
    "export",
    "--project",
    project.id,
    "--page",
    page.document.id,
    "--format",
    "html",
    "--out",
    join(home, "export.html"),
  ]);
  assert.match(
    await readFile(join(home, "export.html"), "utf8"),
    /showai-data/,
  );
  const launch = JSON.parse(
    await readFile(join(home, "agent-runtime.json"), "utf8"),
  ).launch;
  assert.equal(launch.command, node);
  assert.deepEqual(launch.args, [cli]);
  const credential = JSON.parse(
    html.match(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/)[1],
  ).token;
  const shutdown = await fetch(url + "api/shutdown", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`,
    },
    body: "{}",
  });
  assert.equal(shutdown.status, 200);
  assert.equal(await exit, 0);
  // The bundled CLI continues to operate after the UI service has stopped.
  const pages = await run(["pages", "list", "--project", project.id]);
  assert.equal(pages[0].id, page.document.id);
  await mkdir("artifacts", { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      "artifacts/browser-package-smoke.json",
      JSON.stringify(
        {
          version,
          pageModelVersion: build.pageModelVersion,
          sourceCommit: build.sourceCommit,
          sourceDirty: build.sourceDirty,
          platform: process.platform,
          architecture: process.arch,
          distribution,
          verified: [
            "bundled-node",
            "workbench-assets",
            "page-model-v2-and-frontend-fingerprints",
            "CLI-library",
            "component-compiler",
            "HTML-export",
            "runtime-registration",
            "clean-shutdown",
            "CLI-without-server",
          ],
        },
        null,
        2,
      ) + "\n",
    ),
  );
  console.log(`Verified standalone browser distribution: ${distribution}`);
} finally {
  clearTimeout(timeout);
  if (!exited) {
    child.kill("SIGTERM");
    await exit;
  }
  await rm(home, { recursive: true, force: true });
}
