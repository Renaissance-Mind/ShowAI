import { afterEach, expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectDshProfile, stageDshBundle } from "./dsh-stage.mjs";
// @ts-expect-error The Harness bundle is plain JavaScript without declarations.
import { createProvider } from "../../plugins/dsh-showai/skills.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function stage() {
  const root = await mkdtemp(join(tmpdir(), "showai-dsh-"));
  roots.push(root);
  const target = join(root, "plugins", "show ai");
  const receipt = await stageDshBundle({
    target,
    bundleRoot: resolve("plugins/dsh-showai"),
    pluginRoot: resolve("plugins/showai"),
    runtime: {
      command: "/Applications/ShowAI.app/Contents/MacOS/ShowAI",
      env: { ELECTRON_RUN_AS_NODE: "1", NOTE: 'quote " and: colon' },
    },
    home: join(root, "library"),
  });
  return { root, target, receipt };
}

test("stages the bundle with Skills, the launcher and a literal MCP row", async () => {
  const { root, target, receipt } = await stage();
  const skills = (await readdir(resolve("plugins/showai/skills"))).sort();
  expect((await readdir(join(target, "skills"))).sort()).toEqual(skills);
  await stat(join(target, "mcp/launch.mjs"));
  expect(
    JSON.parse(await readFile(join(target, "host-profile.json"), "utf8"))
      .profile,
  ).toBe("deepseek");
  expect(
    await readFile(
      join(target, "skills/use-showai/references/host-adapter.md"),
      "utf8",
    ),
  ).toBe(
    await readFile(resolve("plugins/showai/host-adapters/deepseek.md"), "utf8"),
  );
  expect(await readdir(target)).not.toContain("test");
  const manifest = JSON.parse(
    await readFile(join(target, "package.json"), "utf8"),
  );
  expect(manifest.name).toBe("@showai/dsh-showai");
  expect(manifest.version).toBe(receipt.version);
  const patch = await readFile(join(target, "cordis.patch.yml"), "utf8");
  for (const row of ["showai-preview", "showai-skills", "showai-mcp"])
    expect(patch).toContain(`id: ${row}`);
  expect(receipt.server).toEqual({
    command: "/Applications/ShowAI.app/Contents/MacOS/ShowAI",
    args: [join(target, "mcp/launch.mjs")],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      NOTE: 'quote " and: colon',
      SHOWAI_HOME: join(root, "library"),
      SHOWAI_HOST_DISPLAY: "fragment-file",
    },
    // The MCP child keeps a stable working directory: staging replaces the
    // bundle directory, which would invalidate a cwd inside it.
    cwd: join(root, "library"),
  });
  expect(patch).toContain(
    `- ${JSON.stringify(join(target, "mcp/launch.mjs"))}`,
  );
  expect(patch).toContain(`"NOTE": ${JSON.stringify('quote " and: colon')}`);
  const again = await stageDshBundle({
    target,
    bundleRoot: resolve("plugins/dsh-showai"),
    pluginRoot: resolve("plugins/showai"),
    runtime: {
      command: "/Applications/ShowAI.app/Contents/MacOS/ShowAI",
      env: { ELECTRON_RUN_AS_NODE: "1", NOTE: 'quote " and: colon' },
    },
    home: join(root, "library"),
  });
  expect(again.treeSha256).toBe(receipt.treeSha256);
  expect(
    (await readdir(join(root, "plugins"))).filter((name) =>
      name.includes("staging"),
    ),
  ).toEqual([]);
});

test("publishes every staged Skill without its frontmatter", async () => {
  const { target } = await stage();
  const provider = createProvider(join(target, "skills"));
  const listed = await provider.list();
  expect(listed.map((skill: { name: string }) => skill.name).sort()).toEqual(
    (await readdir(resolve("plugins/showai/skills"))).sort(),
  );
  const show = listed.find(
    (skill: { name: string }) => skill.name === "show-document",
  );
  expect(show).toMatchObject({
    provider: "showai",
    rank: 600,
    resourceBase: {
      kind: "directory",
      path: join(target, "skills/show-document"),
    },
  });
  const loaded = await provider.get(show);
  expect(loaded.description).toBe(show.description);
  expect(loaded.content.startsWith("---")).toBe(false);
  expect(loaded.content).toContain("component.props.set");
});

test("reports Harness profile steps without editing the profile", async () => {
  const { root, target } = await stage();
  const home = join(root, "dsh");
  expect(
    await inspectDshProfile({ target, home, skillNames: ["use-showai"] }),
  ).toMatchObject({ profileFound: false, installed: false });
  const profile = join(home, "profiles/desktop");
  await mkdir(profile, { recursive: true });
  await mkdir(join(home, "skills/use-showai"), { recursive: true });
  await mkdir(join(home, "skills/other"), { recursive: true });
  const manifest = JSON.stringify({
    dependencies: {
      "@showai/dsh-showai": `link:${target}`,
      "@showai/dsh-showai-preview": "link:/old/preview",
    },
    dsh: {
      profile: {
        bundles: ["@deepseek-ai/dsh-base", "@showai/dsh-showai-preview"],
      },
    },
  });
  const patch =
    "- insert:\n    - id: mcp-showai\n      name: '@deepseek-ai/dsh-mcp-client'\n";
  await writeFile(join(profile, "package.json"), manifest);
  await writeFile(join(profile, "cordis.patch.yml"), patch);
  expect(
    await inspectDshProfile({ target, home, skillNames: ["use-showai"] }),
  ).toMatchObject({
    profileFound: true,
    installed: true,
    enabled: false,
    otherSource: undefined,
    legacyBundles: ["@showai/dsh-showai-preview"],
    manualMcpRow: true,
    shadowingSkills: ["use-showai"],
  });
  expect(await readFile(join(profile, "package.json"), "utf8")).toBe(manifest);
  expect(await readFile(join(profile, "cordis.patch.yml"), "utf8")).toBe(patch);
  const elsewhere = await inspectDshProfile({
    target: join(root, "another"),
    home,
  });
  expect(elsewhere).toMatchObject({
    installed: false,
    otherSource: await realpath(target),
  });
});
