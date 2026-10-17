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
