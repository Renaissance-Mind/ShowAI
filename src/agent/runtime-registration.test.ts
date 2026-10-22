import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";
import {
  compareVersions,
  registerRuntime,
  registerRuntimeOnStartup,
  runtimeRegistrationStatus,
  type RuntimeLaunch,
} from "./runtime";

const cleanup: string[] = [];
afterEach(async () => {
  for (const path of cleanup.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "showai-runtime-registration-"));
  cleanup.push(root);
  const entry = async (name: string) => {
    const path = join(root, `${name}.mjs`);
    await writeFile(path, "");
    return path;
  };
  const launch = (path: string): RuntimeLaunch => ({
    command: process.execPath,
    args: [path],
    env: {},
  });
  return {
    home: join(root, "library"),
    self: launch(await entry("this-app")),
    other: launch(await entry("other-app")),
    launch,
    root,
  };
}

const registered = async (home: string) =>
  JSON.parse(await readFile(join(home, "agent-runtime.json"), "utf8"));

async function writeRegistration(
  home: string,
  launch: RuntimeLaunch,
  fields: Record<string, unknown>,
) {
  await registerRuntime(home, launch);
  await writeFile(
    join(home, "agent-runtime.json"),
    JSON.stringify({ ...(await registered(home)), ...fields }),
  );
}

test("startup registers a missing or invalid registration", async () => {
  const { home, self } = await setup();
  expect((await runtimeRegistrationStatus(home, self)).state).toBe("missing");
  const first = await registerRuntimeOnStartup(home, self, "packaged");
  expect(first).toMatchObject({ written: true, state: "current" });
  expect(await registered(home)).toMatchObject({ version, channel: "packaged" });
  await writeFile(join(home, "agent-runtime.json"), "{");
  expect((await runtimeRegistrationStatus(home, self)).state).toBe("invalid");
  expect((await registerRuntimeOnStartup(home, self, "packaged")).written).toBe(
    true,
  );
});

test("startup keeps another valid app of the same or a newer version", async () => {
  const { home, self, other } = await setup();
  await registerRuntime(home, other, "packaged");
  const kept = await registerRuntimeOnStartup(home, self, "packaged");
  expect(kept).toMatchObject({
    written: false,
    state: "other",
    reason: "same-version",
    registered: { entry: other.args[0], version },
  });
  await writeRegistration(home, other, { version: "999.0.0" });
  expect(await registerRuntimeOnStartup(home, self, "development")).toMatchObject(
    { written: false, reason: "newer" },
  );
  expect((await registered(home)).launch.args[0]).toBe(other.args[0]);
  // 修复登记 replaces it explicitly.
  await registerRuntime(home, self, "development");
  expect((await runtimeRegistrationStatus(home, self)).state).toBe("current");
});

test("startup replaces an older, unreachable or development registration", async () => {
  const { home, self, other, launch, root } = await setup();
  await writeRegistration(home, other, { version: "0.0.1" });
  expect(await registerRuntimeOnStartup(home, self, "development")).toMatchObject(
    { written: true, state: "current" },
  );
  // The registered App was moved or deleted.
  await writeRegistration(home, other, {
    launch: launch(join(root, "moved/cli.mjs")),
    channel: "packaged",
  });
  expect((await runtimeRegistrationStatus(home, self)).reason).toBe(
    "unreachable",
  );
  expect((await registerRuntimeOnStartup(home, self, "packaged")).written).toBe(
    true,
  );
  // A development build of the same version gives way to the installed App.
  await registerRuntime(home, other, "development");
  expect((await registerRuntimeOnStartup(home, self, "packaged")).written).toBe(
    true,
  );
  // But a development build does not replace an installed App.
  await registerRuntime(home, other, "packaged");
  expect(
    (await registerRuntimeOnStartup(home, self, "development")).written,
  ).toBe(false);
});

test("versions compare numerically and ignore build suffixes", () => {
  expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
  expect(compareVersions("0.10.0", "0.10.0+desktop.abc")).toBe(0);
  expect(compareVersions("1.0.0-beta", "1.0.1")).toBe(-1);
});
