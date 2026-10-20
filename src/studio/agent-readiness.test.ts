import { describe, expect, it } from "vitest";
import type { AgentHostStatus, LocalAgent } from "../agent-host/types";
import type { PluginInstallation } from "../plugin/desktop-install";
import agentHostMessages from "../i18n/messages/agentHost";
import {
  agentErrorKind,
  agentReadiness,
  connectionHost,
} from "./AgentReadiness";
import { pluginActionLabel, pluginHostState } from "./usePluginHosts";

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

  it("recognizes setup errors from the Agent host in both languages", () => {
    for (const catalog of Object.values(agentHostMessages.catalogs)) {
      const text = (key: keyof typeof catalog) => String(catalog[key]);
      expect(agentErrorKind(text("task.agentMissing"))).toBe("agentMissing");
      expect(agentErrorKind(text("task.signInRequired"))).toBe("signIn");
      expect(agentErrorKind(text("runtime.installFirst"))).toBe("runtime");
      expect(agentErrorKind(text("source.saveApiKey"))).toBe("credentials");
      expect(agentErrorKind(text("task.timeout"))).toBeNull();
    }
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
    const installed = { ...host, installed: true, enabled: true };
    expect(pluginHostState(installed, "ready")).toBe("connect.enabled");
    expect(pluginActionLabel(installed)).toBe("update");
    expect(
      pluginHostState({ ...host, otherSources: ["showai@other"] }),
    ).toBe("connect.otherSource");
  });
});
