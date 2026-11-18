import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const exec = promisify(execFile);
const output = process.env.SHOWAI_PLUGIN_TEST_OUTPUT;

async function runCase(fn) {
  await mkdir(output, { recursive: true });
  const dir = await mkdtemp(join(output, "codex-market-"));
  const install = async (profile, ...args) => {
    const codexProfile = join(dir, profile);
    await mkdir(codexProfile, { recursive: true });
    const { stdout } = await exec(
      process.execPath,
      ["scripts/install-codex-plugin.mjs", ...args, "--json"],
      { env: { ...process.env, CODEX_HOME: codexProfile } },
    );
    return JSON.parse(stdout);
  };
  try {
    await fn(dir, install);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  "rejected cloud updates preserve an existing market and package",
  { skip: !output },
  () =>
    runCase(async (dir, install) => {
      const remote = (profile, market, url) =>
        install(profile, "--marketplace-root", market, "--remote-url", url);
      const a = join(dir, "market-a");
      const b = join(dir, "market-b");
      const endpoint = "https://example.org/mcp";
      await remote("host-a", a, endpoint);
      const first = await remote("host-b", b, endpoint);
      const manifest = join(first.sourcePath, "plugin.json");
      const server = join(first.sourcePath, "mcp.json");
      const listing = join(b, ".agents/plugins/marketplace.json");
      const snapshot = () =>
        Promise.all(
          [manifest, server, listing].map((file) => readFile(file, "utf8")),
        );
      const before = await snapshot();
      await assert.rejects(
        remote("host-a", b, endpoint),
        /already points to another source/,
      );
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(remote("host-b", b, "invalid-endpoint"));
      assert.deepEqual(await snapshot(), before);
      const updated = await remote("host-b", b, endpoint);
      assert.equal(updated.treeSha256, first.treeSha256);
      const switched = await remote("host-b", b, endpoint + "/next");
      const config = JSON.parse(
        await readFile(join(switched.installedPath, "mcp.json"), "utf8"),
      );
      assert.equal(Object.values(config.mcpServers)[0].url, endpoint + "/next");
    }),
);

test(
  "workbench channels have independent registrations and retain checkout ownership",
  { skip: !output },
  () =>
    runCase(async (dir, install) => {
      const home = join(dir, "library");
      await mkdir(home);
      const stage = (market, ...args) =>
        install("codex", "--workbench-test", market, "--home", home, ...args);
      const first = await stage(join(dir, "first"));
      const other = join(dir, "other");
      await assert.rejects(stage(other), /already points to another source/);
      const second = await stage(other, "--workbench-channel", "files");
      assert.equal(first.registeredMcp, "showai_workbench_test");
      assert.equal(second.registeredMcp, "showai_workbench_test_files");
      const { stdout } = await exec("codex", ["mcp", "list", "--json"], {
        env: { ...process.env, CODEX_HOME: join(dir, "codex") },
      });
      const connections = JSON.parse(stdout);
      for (const receipt of [first, second]) {
        const server = connections.find(
          (item) => item.name === receipt.registeredMcp,
        );
        assert(server.enabled);
        const binding = JSON.parse(
          await readFile(server.transport.env.SHOWAI_RUNTIME_CONFIG, "utf8"),
        );
        assert.equal(binding.home, receipt.home);
        assert.equal(binding.launch.args[0], receipt.runtime);
        assert(
          server.transport.args.includes(
            join(receipt.installedPath, "mcp/launch.mjs"),
          ),
        );
      }
      const record = join(other, "agent-runtime.json");
      const before = await readFile(record, "utf8");
      await writeFile(
        join(other, "workbench-checkout.json"),
        JSON.stringify({ checkout: dir }),
      );
      await assert.rejects(
        stage(other, "--workbench-channel", "files"),
        /belongs to/,
      );
      assert.equal(await readFile(record, "utf8"), before);
    }),
);
