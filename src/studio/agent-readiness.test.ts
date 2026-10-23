import { describe, expect, it } from "vitest";
import type { AgentHostStatus, LocalAgent } from "../agent-host/types";
import type { PluginInstallation } from "../plugin/desktop-install";
import {
  agentReadiness,
  agentSteps,
  connectionHost,
  localCodexAvailable,
} from "./AgentReadiness";
import {
  agentProblemOf,
  problemActions,
  readinessKindOf,
  unclassifiedProblem,
} from "./assistant/AgentProblemNotice";
import {
  pluginActionLabel,
  pluginHostState,
  pluginNeedsUpdate,
  pluginUpToDate,
} from "./usePluginHosts";

const agent = (id: LocalAgent["id"], found: boolean, auth: LocalAgent["auth"]) =>
  ({
    id,
    name: id,
    path: found ? `/usr/local/bin/${id}` : null,
    version: "",
    auth,
    detail: "",
    callable: null,
  }) satisfies LocalAgent;

function status(
  settings: Partial<AgentHostStatus["settings"]>,
  extra: Partial<AgentHostStatus> = {},
): AgentHostStatus {
  return {
    settings: {
      mode: "local",
      localAgent: "codex",
      sourceId: "",
      sources: [],
      ...settings,
    },
    agents: [agent("codex", true, "ready"), agent("claude", false, "missing")],
    runtime: { state: "ready", progress: "", root: "/runtime" },
    workspaceRoot: "/work",
    credentialRoot: "/credentials",
    tasks: [],
    authorization: { state: "idle" },
    ...extra,
  };
}
const source = {
  id: "s1",
  name: "DeepSeek",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  protocol: "responses" as const,
  credential: "api-key" as const,
  apiKeyPresent: true,
};

describe("built-in Agent readiness", () => {
  it("reports what blocks the selected local agent", () => {
    expect(agentReadiness(status({}))).toEqual({ kind: "ready" });
    expect(agentReadiness(status({ localAgent: "claude" }))).toEqual({
      kind: "agentMissing",
      name: "Claude Code",
    });
    expect(
      agentReadiness(
        status({}, { agents: [agent("codex", true, "missing")] }),
      ),
    ).toEqual({ kind: "signIn", name: "Codex" });
    expect(agentReadiness(status({}, { agents: [] })).kind).toBe("checking");
  });

  it("reports missing model sources, credentials, models and the SDK", () => {
    expect(agentReadiness(status({ mode: "api" })).kind).toBe("noSource");
    expect(
      agentReadiness(
        status({
          mode: "api",
          sourceId: "s1",
          sources: [{ ...source, apiKeyPresent: false }],
        }),
      ),
    ).toEqual({ kind: "credentials", name: "DeepSeek", chatgpt: false });
    expect(
      agentReadiness(
        status({
          mode: "api",
          sourceId: "s1",
          sources: [
            {
              ...source,
              apiKeyPresent: false,
              baseUrl: "http://127.0.0.1:11434/v1",
            },
          ],
        }),
      ).kind,
    ).toBe("ready");
    expect(
      agentReadiness(
        status({ mode: "api", sourceId: "s1", sources: [{ ...source, model: "" }] }),
      ).kind,
    ).toBe("model");
    expect(
      agentReadiness(
        status(
          { mode: "api", sourceId: "s1", sources: [source] },
          { runtime: { state: "absent", progress: "", root: "/runtime" } },
        ),
      ).kind,
    ).toBe("runtime");
  });

  it("offers ChatGPT and an API key side by side when no source exists", () => {
    expect(agentSteps("noSource")).toEqual(["chatgpt", "apiKey"]);
    expect(agentSteps("noSource", { localCodex: true })).toEqual([
      "chatgpt",
      "apiKey",
      "localCodex",
    ]);
    expect(agentSteps("credentials", { chatgpt: true })[0]).toBe("chatgpt");
    expect(agentSteps("credentials")[0]).toBe("apiKey");
    expect(localCodexAvailable(status({ mode: "api" }))).toBe(true);
    expect(
      localCodexAvailable(
        status({ mode: "api" }, { agents: [agent("codex", false, "missing")] }),
      ),
    ).toBe(false);
  });
});

describe("built-in Agent problems", () => {
  it("reads the host classification from an IPC error, not its text", () => {
    const problem = {
      code: "no_model_source" as const,
      summary: "还没有可用的模型",
    };
    expect(
      agentProblemOf({ code: "ERROR", message: "任意文字", problem }),
    ).toEqual(problem);
    expect(agentProblemOf({ code: "ERROR", message: "还没有可用的模型" })).toBeNull();
    expect(agentProblemOf({ problem: { code: "made_up", summary: "" } })).toBeNull();
    expect(unclassifiedProblem(new Error("boom"))).toMatchObject({
      code: "unknown",
      detail: "boom",
    });
  });

  it("chooses actions by code", () => {
    expect(problemActions({ code: "no_model_source" }, { localCodex: true })).toEqual([
      "connectChatgpt",
      "apiKey",
      "useLocalCodex",
    ]);
    expect(problemActions({ code: "invalid_credentials", chatgpt: true })).toEqual([
      "connectChatgpt",
      "retry",
    ]);
    expect(problemActions({ code: "invalid_credentials" })[0]).toBe("apiKey");
    expect(problemActions({ code: "rate_limited" })).toContain("retry");
    expect(problemActions({ code: "process_exited" })).toEqual(["retry", "viewLog"]);
    expect(problemActions({ code: "unknown" })).toEqual(["retry", "report"]);
    expect(readinessKindOf("no_model_source")).toBe("noSource");
    expect(readinessKindOf("rate_limited")).toBeNull();
  });
});

describe("host plugin connection", () => {
  it("maps MCP client names to plugin hosts", () => {
    expect(connectionHost("claude-code")).toBe("claude");
    expect(connectionHost("codex-mcp-client")).toBe("codex");
    expect(connectionHost("some-other-client")).toBeNull();
  });

  it("describes detection and plugin state for the welcome", () => {
    const host: PluginInstallation = {
      host: "codex",
      executable: "/usr/local/bin/codex",
      installed: false,
      enabled: false,
      otherSources: [],
    };
    expect(pluginHostState({ ...host, executable: null })).toBe(
      "connect.notFound",
    );
    expect(pluginHostState(host, "ready")).toBe("connect.signedIn");
    expect(pluginHostState(host, "missing")).toBe("connect.signedOut");
    expect(pluginHostState(host)).toBe("connect.found");
    expect(pluginActionLabel(host)).toBe("install");
    // Already running the plugin this App would install: offer only a repair.
    const current = { ...host, installed: true, enabled: true, current: true };
    expect(pluginHostState(current, "ready")).toBe("connect.enabled");
    expect(pluginActionLabel(current)).toBe("reinstall");
    expect(pluginUpToDate(current)).toBe(true);
    // Installed from an older App, another library or a moved App: an update is due.
    const outdated = { ...current, current: false };
    expect(pluginHostState(outdated)).toBe("connect.outdated");
    expect(pluginActionLabel(outdated)).toBe("update");
    expect(pluginUpToDate(outdated)).toBe(false);
    const disabled = { ...current, enabled: false };
    expect(pluginHostState(disabled)).toBe("connect.disabled");
    expect(pluginActionLabel(disabled)).toBe("update");
    expect(
      pluginHostState({ ...host, otherSources: ["showai@other"] }),
    ).toBe("connect.otherSource");
  });

  it("offers a startup update only for the App's own outdated plugin", () => {
    const outdated: PluginInstallation = {
      host: "claude",
      executable: "/usr/local/bin/claude",
      installed: true,
      enabled: true,
      current: false,
      otherSources: [],
    };
    expect(pluginNeedsUpdate(outdated)).toBe(true);
    // Harness bundles report freshness the same way once staged and enabled.
    expect(pluginNeedsUpdate({ ...outdated, host: "deepseek" })).toBe(true);
    expect(pluginNeedsUpdate({ ...outdated, current: true })).toBe(false);
    // Unknown freshness (nothing to compare) is not reported as an update.
    expect(pluginNeedsUpdate({ ...outdated, current: undefined })).toBe(false);
    expect(pluginNeedsUpdate({ ...outdated, enabled: false })).toBe(false);
    expect(pluginNeedsUpdate({ ...outdated, installed: false })).toBe(false);
    expect(
      pluginNeedsUpdate({ ...outdated, otherSources: ["showai@other"] }),
    ).toBe(false);
    expect(pluginNeedsUpdate({ ...outdated, error: "failed" })).toBe(false);
  });
});
