import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchRole, libraryInstances } from "./dev-instances.mjs";
import { developmentSessions } from "./dev-session.mjs";
import { publishInstance } from "../src/core/instance-presence.mjs";

test("registered launches tell open Apps from their CLI and MCP children", () => {
  const packaged = {
    command: "/Applications/ShowAI 稳定版.app/Contents/MacOS/ShowAI 稳定版",
    entry:
      "/Applications/ShowAI 稳定版.app/Contents/Resources/runtime/scripts/cli.mjs",
  };
  assert.equal(launchRole(packaged.command, packaged), "app");
  assert.equal(launchRole(`${packaged.command} -psn_0_1234`, packaged), "app");
  assert.equal(launchRole(`${packaged.command} ${packaged.entry} mcp`, packaged), "cli");
  assert.equal(
    launchRole(`${packaged.command} /Users/me/.dsh/plugins/showai/mcp/launch.mjs`, packaged),
    undefined,
  );
  assert.equal(launchRole(`${packaged.command} Helper --type=gpu`, packaged), undefined);
  const development = {
    command: "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    entry: "/repo/.showai-dev/desktop-5173/runtime/scripts/cli.mjs",
  };
  assert.equal(
    launchRole(`${development.command} /repo/.showai-dev/desktop-5173/desktop`, development),
    "app",
  );
  // Every development desktop shares the Electron binary; only its own directory matches.
  assert.equal(
    launchRole(`${development.command} /repo/.showai-dev/desktop-5763/desktop`, development),
    undefined,
  );
  assert.equal(
    launchRole(`${development.command} ${development.entry} mcp --project p`, development),
    "cli",
  );
  const browser = { command: "/usr/bin/node", entry: "/opt/showai/runtime/scripts/cli.mjs" };
  assert.equal(launchRole(`/usr/bin/node ${browser.entry} serve --port 4000`, browser), "app");
  assert.equal(launchRole(`/usr/bin/node ${browser.entry} projects list`, browser), "cli");
});

const idle = (args) =>
  spawn(process.execPath, args, { stdio: "ignore" });

test("dev:status lists every instance of a library and which one is registered", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "showai-dev-status-")));
  const home = join(root, "library");
  const folder = join(root, ".showai-dev", "desktop-5999");
  await mkdir(join(folder, "runtime", "scripts"), { recursive: true });
  await mkdir(home, { recursive: true });
  // Stand-ins: a launcher whose command names dev.mjs and its desktop backend.
  await writeFile(join(folder, "desktop"), "setInterval(() => {}, 1e6);\n");
  const launcher = idle(["-e", "setInterval(() => {}, 1e6)", "dev.mjs"]);
  const backend = idle([join(folder, "desktop")]);
  await Promise.all([once(launcher, "spawn"), once(backend, "spawn")]);
  t.after(async () => {
    launcher.kill();
    backend.kill();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    join(folder, "session.json"),
    JSON.stringify({
      root,
      mode: "desktop",
      branch: "main",
      commit: "c0ffee1",
      startedCommit: "c0ffee1",
      url: "http://127.0.0.1:5999/",
      pid: launcher.pid,
      backendPid: backend.pid,
      home,
      runtime: join(folder, "runtime"),
      startedAt: new Date().toISOString(),
    }),
  );
  await writeFile(
    join(home, "agent-runtime.json"),
    JSON.stringify({
      format: "showai-agent-runtime",
      protocol: 1,
      version: "0.0.0",
      home,
      launch: {
        command: process.execPath,
        args: [join(folder, "runtime", "scripts", "cli.mjs")],
        env: {},
      },
      channel: "development",
    }),
  );
  // This test process plays a browser edition serving the same library.
  const presence = await publishInstance(home, {
    mode: "browser",
    channel: "packaged",
    appVersion: "0.0.0",
    url: "http://127.0.0.1:4000/",
  });
  t.after(() => presence.remove());
  const result = await libraryInstances({
    root,
    home,
    selfLauncher: launcher.pid,
  });
  const byPid = new Map(result.instances.map((item) => [item.pid, item]));
  assert.deepEqual([...byPid.keys()].sort(), [process.pid, backend.pid].sort());
  assert.deepEqual(byPid.get(backend.pid).evidence, [
    "development-session",
    "registered-command",
  ]);
  assert.equal(byPid.get(backend.pid).self, true);
  assert.equal(byPid.get(backend.pid).registered, true);
  assert.equal(byPid.get(backend.pid).port, 5999);
  assert.deepEqual(byPid.get(process.pid).evidence, ["presence"]);
  assert.equal(byPid.get(process.pid).registered, false);
  assert.deepEqual(result.registered.pids, [backend.pid]);
  assert.equal(result.registered.self, true);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ["MULTIPLE_INSTANCES"],
  );
  assert.match(result.warnings[0].message, /development desktop :5999/);
  // Stopping the registered App leaves a registration nobody serves.
  backend.kill();
  await once(backend, "exit");
  const later = await libraryInstances({ root, home });
  assert.deepEqual(
    later.warnings.map((warning) => warning.code),
    ["REGISTERED_NOT_RUNNING"],
  );
});

function fakeSocket() {
  const handlers = new Map();
  const sent = [];
  const clients = [];
  return {
    sent,
    on(type, handler) {
      handlers.set(type, handler);
    },
    send(type, data) {
      sent.push([type, data]);
      if (type === "showai:prepare-restart")
        for (const client of clients) client.prepared(data);
    },
    connect(url, answer) {
      const client = {
        socket: { once() {} },
        send(type, data) {
          if (type === "showai:prepare-restart") this.prepared(data);
        },
        prepared({ id }) {
          const reply = answer();
          if (reply) handlers.get("showai:restart-result")({ id, ...reply }, client);
        },
      };
      clients.push(client);
      handlers.get("showai:hello")({ url }, client);
    },
  };
}

test("a paused development restart says which window refused and why", async () => {
  const ws = fakeSocket();
  const sessions = developmentSessions(ws, 50);
  assert.deepEqual(await sessions.prepare(), { allow: true, blockers: [] });
  ws.connect("http://127.0.0.1:5999/?page=a", () => ({
    allow: false,
    blockers: [
      { code: "PAGE_CONFLICT", source: "pages", pageId: "a", title: "Plan", junk: 1 },
    ],
  }));
  assert.deepEqual(await sessions.prepare(), {
    allow: false,
    blockers: [
      {
        code: "PAGE_CONFLICT",
        source: "pages",
        pageId: "a",
        title: "Plan",
        url: "http://127.0.0.1:5999/?page=a",
      },
    ],
  });
  assert.deepEqual(ws.sent.at(-1), [
    "showai:restart-cancelled",
    { reason: "[PAGE_CONFLICT] 「Plan」" },
  ]);
  const silent = fakeSocket();
  const waiting = developmentSessions(silent, 30);
  silent.connect("http://127.0.0.1:5999/", () => undefined);
  const timedOut = await waiting.prepare();
  assert.equal(timedOut.allow, false);
  assert.deepEqual(
    timedOut.blockers.map((blocker) => [blocker.code, blocker.url]),
    [["NO_REPLY", "http://127.0.0.1:5999/"]],
  );
});
