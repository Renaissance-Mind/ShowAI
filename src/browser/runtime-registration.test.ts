import { test, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startBrowserServer } from "./server";

test("verification hosts preserve an existing Agent registration", async () => {
  const home = await mkdtemp(
    join(
      process.env.SHOWAI_TEST_FIXTURE_ROOT ?? tmpdir(),
      "paper-runtime-registration-",
    ),
  );
  const registration = join(home, "agent-runtime.json");
  const original = JSON.stringify({
    format: "showai-agent-runtime",
    protocol: 1,
    version: "0.9.0",
    home,
    launch: {
      command: process.execPath,
      args: [resolve("dist-agent/cli.mjs")],
      env: { SHOWAI_HOME: home },
    },
  });
  await writeFile(registration, original);
  const webRoot = join(home, "web");
  await mkdir(webRoot);
  const server = await startBrowserServer({
    home,
    port: 0,
    webRoot,
    cliEntry: resolve("dist-agent/cli.mjs"),
    settingsPath: join(home, "settings.json"),
    registerAgentRuntime: false,
  });
  try {
    expect(await readFile(registration, "utf8")).toBe(original);
  } finally {
    await server.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("ordinary browser hosts still register their actual CLI", async () => {
  const home = await mkdtemp(
    join(
      process.env.SHOWAI_TEST_FIXTURE_ROOT ?? tmpdir(),
      "paper-runtime-registration-",
    ),
  );
  const cliEntry = resolve("dist-agent/cli.mjs");
  const webRoot = join(home, "web");
  await mkdir(webRoot);
  const server = await startBrowserServer({
    home,
    port: 0,
    webRoot,
    cliEntry,
    settingsPath: join(home, "settings.json"),
  });
  try {
    expect(
      JSON.parse(await readFile(join(home, "agent-runtime.json"), "utf8"))
        .launch.args,
    ).toEqual([cliEntry]);
  } finally {
    await server.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("browser hosts launched via Electron preserve ELECTRON_RUN_AS_NODE in registered runtime", async () => {
  const home = await mkdtemp(
    join(
      process.env.SHOWAI_TEST_FIXTURE_ROOT ?? tmpdir(),
      "paper-runtime-electron-",
    ),
  );
  const cliEntry = resolve("dist-agent/cli.mjs");
  const webRoot = join(home, "web");
  await mkdir(webRoot);
  const descriptor = Object.getOwnPropertyDescriptor(
    process.versions,
    "electron",
  );
  Object.defineProperty(process.versions, "electron", {
    value: "44.10.1",
    configurable: true,
  });
  let server: Awaited<ReturnType<typeof startBrowserServer>> | undefined;
  try {
    server = await startBrowserServer({
      home,
      port: 0,
      webRoot,
      cliEntry,
      settingsPath: join(home, "settings.json"),
    });
    const registered = JSON.parse(
      await readFile(join(home, "agent-runtime.json"), "utf8"),
    );
    expect(registered.launch.env).toEqual({
      SHOWAI_HOME: resolve(home),
      ELECTRON_RUN_AS_NODE: "1",
    });
  } finally {
    if (descriptor) {
      Object.defineProperty(process.versions, "electron", descriptor);
    } else {
      delete (process.versions as Record<string, unknown>).electron;
    }
    await server?.close();
    await rm(home, { recursive: true, force: true });
  }
});
