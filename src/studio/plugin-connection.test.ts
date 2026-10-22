import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginInstallation } from "../plugin/desktop-install";
import type { AgentConnectionRecord } from "../agent/mcp-connections";
import { launchSnippet, runtimeMcpLaunch } from "../plugin/launch-snippets";
import { PluginInstallError } from "../plugin/plugin-errors";
import { errorResult } from "../agent/service";
import { verifyState } from "./PluginInstallSettings";
import {
  pluginErrorText,
  pluginHostState,
  pluginLibraryMismatch,
} from "./usePluginHosts";
import { setLocale } from "../i18n";

const host: PluginInstallation = {
  host: "claude",
  executable: "/usr/local/bin/claude",
  installed: true,
  enabled: true,
  current: true,
  version: "0.22.0+desktop.new",
  otherSources: [],
};
const at = (minute: number) => `2026-10-23T10:${String(minute).padStart(2, "0")}:00.000Z`;
const record = (fields: Partial<AgentConnectionRecord>): AgentConnectionRecord => ({
  client: "claude-code",
  firstConnectedAt: at(0),
  lastConnectedAt: at(1),
  ...fields,
});

test("verification compares calls with the current installation", () => {
  expect(verifyState(host, [])).toEqual({ kind: "waiting" });
  // A call by the earlier plugin does not prove the new one works.
  expect(
    verifyState(host, [
      record({
        pluginVersion: "0.21.0+desktop.old",
        lastCallAt: at(2),
        callPluginVersion: "0.21.0+desktop.old",
      }),
    ]),
  ).toEqual({ kind: "notSinceInstall", at: at(2) });
  // Records from launchers that did not report a version predate this installation.
  expect(verifyState(host, [record({ lastCallAt: at(2) })]).kind).toBe(
    "notSinceInstall",
  );
  expect(
    verifyState(host, [record({ pluginVersion: host.version })]),
  ).toEqual({ kind: "connected", at: at(1) });
  expect(
    verifyState(host, [
      record({
        pluginVersion: host.version,
        lastCallAt: at(3),
        callPluginVersion: host.version,
      }),
    ]),
  ).toEqual({ kind: "called", at: at(3) });
  // A host that reports no version keeps the earlier behaviour.
  expect(
    verifyState({ ...host, version: undefined }, [record({ lastCallAt: at(2) })])
      .kind,
  ).toBe("called");
});

test("a launcher failure after the latest connection is the current state", () => {
  const failure = {
    code: "RUNTIME_OUTDATED",
    message: "older",
    at: at(5),
    pluginVersion: host.version,
  };
  expect(
    verifyState(host, [
      record({
        pluginVersion: host.version,
        lastCallAt: at(1),
        callPluginVersion: host.version,
        lastFailure: failure,
      }),
    ]),
  ).toMatchObject({ kind: "failed", code: "RUNTIME_OUTDATED", at: at(5) });
  // A later successful connection supersedes it.
  expect(
    verifyState(host, [
      record({
        pluginVersion: host.version,
        lastConnectedAt: at(6),
        lastCallAt: at(6),
        callPluginVersion: host.version,
        lastFailure: failure,
      }),
    ]).kind,
  ).toBe("called");
  // A failure of an earlier plugin does not describe this installation.
  expect(
    verifyState(host, [
      record({
        neverConnected: true,
        lastFailure: { ...failure, pluginVersion: "0.21.0" },
      }),
    ]).kind,
  ).toBe("waiting");
});

test("a plugin bound to another library is its own state", () => {
  const bound = { ...host, current: false, boundHome: "/Users/a/.showai" };
  expect(pluginLibraryMismatch(bound, "/Users/a/Other")).toBe(true);
  expect(pluginHostState(bound, undefined, "/Users/a/Other")).toBe(
    "connect.libraryMismatch",
  );
  expect(pluginHostState(bound, undefined, "/Users/a/.showai")).toBe(
    "connect.outdated",
  );
});

test("plugin errors are localized with the host output kept as details", () => {
  setLocale("zh-CN");
  const error = errorResult(
    new PluginInstallError("PLUGIN_HOST_TOO_OLD", "old codex", {
      host: "codex",
      minimumVersion: "0.163.0",
      output: "Usage: codex plugin …",
    }),
  );
  expect(error.code).toBe("PLUGIN_HOST_TOO_OLD");
  const text = pluginErrorText(error);
  expect(text.message).toContain("0.163.0");
  expect(text.message).toContain("Codex");
  expect(text.details).toContain("Usage: codex plugin");
  // Unknown codes keep the original message.
  expect(pluginErrorText({ code: "OTHER", message: "raw" })).toEqual({
    message: "raw",
  });
});

test("agent-facing errors carry a next step and a sentence to relay", () => {
  const unknown = errorResult(new Error("boom"));
  expect(unknown).toMatchObject({ code: "ERROR", message: "boom" });
  expect(unknown.nextStep).toContain("About & feedback");
  expect(unknown.nextStep).toContain("Do not file a report");
});

const run = promisify(execFile);
test("per-host launch configuration is accepted by the Claude Code CLI", async () => {
  const server = {
    command: "/Applications/ShowAI.app/Contents/MacOS/ShowAI",
    args: ["/Applications/ShowAI.app/Contents/Resources/runtime/assets/agent-plugin/mcp/launch.mjs"],
    env: { ELECTRON_RUN_AS_NODE: "1", SHOWAI_HOME: "/Users/me/My Library" },
  };
  const codex = launchSnippet("codex", server);
  expect(codex).toContain("[mcp_servers.showai]");
  expect(codex).toContain('SHOWAI_HOME = "/Users/me/My Library"');
  expect(JSON.parse(launchSnippet("json", server)).mcpServers.showai.args).toEqual(
    server.args,
  );
  expect(runtimeMcpLaunch({ ...server, args: ["/cli.mjs"] }).args).toEqual([
    "/cli.mjs",
    "mcp",
  ]);
  const claude = launchSnippet("claude", server);
  expect(claude).toContain("'SHOWAI_HOME=/Users/me/My Library'");
  const executable = await run("/bin/sh", ["-c", "command -v claude"]).then(
    (result) => result.stdout.trim(),
    () => "",
  );
  if (!executable) return;
  // A disposable configuration directory; the person's Claude Code settings are untouched.
  const config = await mkdtemp(join(tmpdir(), "showai-claude-config-"));
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: config };
    await run("/bin/sh", ["-c", claude], { env });
    const saved = JSON.parse(await readFile(join(config, ".claude.json"), "utf8"));
    expect(saved.mcpServers.showai).toMatchObject({
      command: server.command,
      args: server.args,
      env: server.env,
    });
  } finally {
    await rm(config, { recursive: true, force: true });
  }
});
