import { join } from "node:path";
import type { AgentConnectionRecord } from "../../agent/mcp-connections";
import type {
  AgentHostStatus,
  AgentSettings,
  LocalAgent,
  ModelSource,
} from "../../agent-host/types";
import { APP_UPDATE_RESTART_DELAY_MS, type AppUpdateState } from "../../host/protocol";
import type {
  PluginHost,
  PluginInstallation,
  PluginInstallReceipt,
} from "../../plugin/desktop-install";
import { remoteConnectionFixture } from "./remote-connection";
import type { SceneFixture } from "../types";

export function settingsFixture(
  home: string,
  projects: Array<{ id: string; name: string }>,
  automatic: boolean,
): SceneFixture {
  const remote = remoteConnectionFixture(projects, automatic);
  const copy = <T>(value: T): T => structuredClone(value);

  let syncConnected = false;
  let defaultConnectionId: string | null = "conn-cloud";
  let conflictResolved = false;

  const connectionsState = [
    {
      id: "conn-cloud",
      serverId: "srv-cloud",
      name: "ShowAI Cloud",
      url: "https://showai.example/cloud",
      signedOut: false,
      capabilities: ["account-security-v1", "account-federation-v1"],
      user: { id: "u-ada", name: "ada", email: "ada@example.com" },
    },
    {
      id: "conn-team",
      serverId: "srv-team",
      name: "Studio Team",
      url: "https://team.showai.example/cloud",
      signedOut: true,
      capabilities: ["account-security-v1", "account-federation-v1"],
      user: { id: "u-ada-team", name: "ada-team", email: "ada@team.example" },
    },
  ];

  let appUpdate: AppUpdateState = {
    supported: true,
    automatic: true,
    currentVersion: "0.12.0",
    phase: "current",
    checkedAt: "2026-11-21T06:00:00.000Z",
  };

  let hosts: PluginInstallation[] = [
    {
      host: "claude",
      executable: "/opt/homebrew/bin/claude",
      installed: true,
      enabled: true,
      version: "0.12.0",
      current: true,
      expected: "0.12.0",
      installedPath: join(home, "plugins/claude"),
      otherSources: [],
      boundHome: home,
    },
    {
      host: "codex",
      executable: "/opt/homebrew/bin/codex",
      installed: true,
      enabled: true,
      version: "0.11.0",
      current: false,
      expected: "0.12.0",
      installedPath: join(home, "plugins/codex"),
      otherSources: [],
      boundHome: home,
    },
    {
      host: "antigravity",
      executable: null,
      installed: false,
      enabled: false,
      otherSources: [],
      searched: ["/opt/homebrew/bin", "/usr/local/bin"],
    },
    {
      host: "deepseek",
      executable: "/Applications/DeepSeek.app/Contents/MacOS/dsh",
      installed: false,
      enabled: false,
      otherSources: [],
    },
  ];

  const currentRuntime = {
    version: "0.12.0",
    command: "/usr/local/bin/node",
    entry: join(home, "cli.mjs"),
    channel: "development" as const,
  };
  let runtimeState = {
    path: join(home, "agent-runtime.json"),
    state: "current" as const,
    current: currentRuntime,
    registered: {
      ...currentRuntime,
      protocol: 1,
      home,
    },
  };

  const connectionRecords: AgentConnectionRecord[] = [
    {
      client: "claude-code",
      firstConnectedAt: "2026-11-20T09:00:00.000Z",
      lastConnectedAt: "2026-11-21T06:10:00.000Z",
      lastCallAt: "2026-11-21T06:12:00.000Z",
      pluginVersion: "0.12.0",
      callPluginVersion: "0.12.0",
    },
    {
      client: "codex-mcp-client",
      firstConnectedAt: "2026-11-19T08:00:00.000Z",
      lastConnectedAt: "2026-11-19T08:00:00.000Z",
      lastFailure: {
        code: "RUNTIME_OUTDATED",
        message: "Runtime outdated",
        pluginVersion: "0.11.0",
        at: "2026-11-21T05:30:00.000Z",
      },
    },
  ];

  const defaultLocalAgents: LocalAgent[] = [
    {
      id: "claude",
      name: "Claude Code",
      path: "/opt/homebrew/bin/claude",
      version: "1.0.24",
      auth: "ready",
      detail: "",
      callable: true,
      testedAt: "2026-11-21T06:00:00.000Z",
    },
    {
      id: "codex",
      name: "Codex",
      path: "/opt/homebrew/bin/codex",
      version: "0.42.0",
      auth: "ready",
      detail: "",
      callable: true,
      testedAt: "2026-11-21T06:00:00.000Z",
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      path: null,
      version: "",
      auth: "unknown",
      detail: "",
      callable: null,
    },
  ];

  let localAgents: LocalAgent[] = copy(defaultLocalAgents);

  let agentSettings: AgentSettings = {
    mode: "api",
    localAgent: "claude",
    sourceId: "src-openai",
    sources: [
      {
        id: "src-openai",
        name: "OpenAI API",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.2",
        protocol: "responses",
        credential: "api-key",
        apiKeyPresent: true,
      },
      {
        id: "src-deepseek",
        name: "DeepSeek",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        protocol: "chat",
        credential: "api-key",
        apiKeyPresent: true,
      },
    ],
  };

  function agentStatus(): AgentHostStatus {
    return copy({
      executionKind: "mac",
      settings: agentSettings,
      agents: localAgents,
      runtime: {
        state: "ready",
        version: "0.12.0",
        progress: "",
        root: join(home, "runtime"),
      },
      workspaceRoot: join(home, "agent-workspaces"),
      credentialRoot: join(home, "credentials"),
      tasks: [],
      authorization: { state: "idle" },
    });
  }

  function syncStatus() {
    if (!syncConnected) {
      return {
        version: 1,
        deviceId: "dev-ui-lab",
        defaultConnectionId: null,
        running: false,
        connections: [],
        projects: [],
        hiddenProjectIds: [],
      };
    }
    return {
      version: 1,
      deviceId: "dev-ui-lab",
      defaultConnectionId,
      running: true,
      connections: copy(connectionsState),
      projects: [
        ...(projects[0]
          ? [
              {
                projectId: projects[0].id,
                connectionId: "conn-cloud",
                remoteProjectId: "remote-p1",
                role: "admin" as const,
                remoteHead: "rev-2",
                localRevision: "rev-2",
                status: conflictResolved
                  ? ("synced" as const)
                  : ("conflict" as const),
              },
            ]
          : []),
        ...(projects[1]
          ? [
              {
                projectId: projects[1].id,
                connectionId: "conn-cloud",
                remoteProjectId: "remote-p2",
                role: "editor" as const,
                remoteHead: "rev-5",
                localRevision: "rev-5",
                status: "synced" as const,
              },
            ]
          : []),
      ],
      hiddenProjectIds: [],
    };
  }

  const ownActions = new Set([
    "plugins:status",
    "plugins:runtime",
    "plugins:repairRuntime",
    "plugins:install",
    "plugins:setPath",
    "plugins:choosePath",
    "settings:chooseFolder",
    "agent:onboarding",
    "agent:status",
    "agent:scan",
    "agent:settings",
    "agent:source",
    "agent:removeSource",
    "agent:models",
    "appUpdate:state",
    "appUpdate:check",
    "appUpdate:download",
    "appUpdate:install",
    "appUpdate:defer",
    "sync:status",
    "sync:serverInfo",
    "sync:connect",
    "sync:default",
    "sync:signOut",
    "sync:disconnect",
    "sync:projects",
    "sync:previewInvite",
    "sync:conflict",
    "sync:resolve",
    "sync:sessions",
    "sync:loginMethods",
    "sync:accountProfile",
    "sync:createToken",
    "sync:resources",
  ]);

  const actions = new Set([...remote.actions, ...ownActions]);

  return {
    actions,
    async invoke(action, args) {
      if (remote.actions.has(action)) return remote.invoke(action, args);
      switch (action) {
        case "plugins:status":
          return copy(hosts);
        case "plugins:runtime":
          return copy(runtimeState);
        case "plugins:repairRuntime":
          runtimeState = {
            path: join(home, "agent-runtime.json"),
            state: "current",
            current: currentRuntime,
            registered: {
              ...currentRuntime,
              protocol: 1,
              home,
            },
          };
          return copy(runtimeState);
        case "plugins:install": {
          const target = String(args.host) as PluginHost;
          hosts = hosts.map((item) =>
            item.host === target
              ? {
                  ...item,
                  installed: true,
                  enabled: true,
                  current: true,
                  version: "0.12.0",
                  expected: "0.12.0",
                  installedPath: join(home, "plugins", target),
                  boundHome: home,
                }
              : item,
          );
          const receipt: PluginInstallReceipt = {
            host: target,
            version: "0.12.0",
            installedPath: join(home, "plugins", target),
            verifiedFiles: 14,
            treeSha256: "0".repeat(64),
            home,
          };
          return receipt;
        }
        case "plugins:setPath": {
          const target = String(args.host) as PluginHost;
          const path = String(args.path ?? "").trim();
          hosts = hosts.map((item) =>
            item.host === target
              ? {
                  ...item,
                  manualPath: path || undefined,
                  executable: path || null,
                }
              : item,
          );
          return copy(hosts);
        }
        case "plugins:choosePath":
          return "/opt/homebrew/bin/antigravity";
        case "settings:chooseFolder":
          return join(home, "work-records");

        case "agent:onboarding":
          return { connections: copy(connectionRecords) };
        case "agent:status":
        case "agent:scan":
          return agentStatus();
        case "agent:settings": {
          const next = (args.settings ?? args) as Partial<AgentSettings>;
          agentSettings = {
            ...agentSettings,
            ...(next.mode ? { mode: next.mode } : {}),
            ...(next.localAgent ? { localAgent: next.localAgent } : {}),
            ...(typeof next.sourceId === "string"
              ? { sourceId: next.sourceId }
              : {}),
          };
          return agentStatus();
        }
        case "agent:source": {
          const incoming = (args.source ?? args) as Partial<ModelSource>;
          const id = incoming.id || `src-${Date.now()}`;
          const source: ModelSource = {
            id,
            name: incoming.name || "Custom API",
            provider: incoming.provider || "custom",
            baseUrl: incoming.baseUrl || "https://api.openai.com/v1",
            model: incoming.model || "gpt-5.2",
            protocol: incoming.protocol || "responses",
            credential: incoming.credential || "api-key",
            apiKeyPresent: true,
          };
          const exists = agentSettings.sources.some((item) => item.id === id);
          agentSettings = {
            ...agentSettings,
            sourceId: id,
            sources: exists
              ? agentSettings.sources.map((item) =>
                  item.id === id ? source : item,
                )
              : [...agentSettings.sources, source],
          };
          return agentStatus();
        }
        case "agent:removeSource": {
          const id = String(args.sourceId ?? args.id ?? "");
          const remaining = agentSettings.sources.filter(
            (item) => item.id !== id,
          );
          agentSettings = {
            ...agentSettings,
            sources: remaining,
            sourceId:
              agentSettings.sourceId === id
                ? (remaining[0]?.id ?? "")
                : agentSettings.sourceId,
          };
          return agentStatus();
        }
        case "agent:models":
          return [
            { id: "gpt-5.2", name: "GPT-5.2" },
            { id: "gpt-5.2-mini", name: "GPT-5.2 Mini" },
            { id: "deepseek-chat", name: "DeepSeek Chat" },
          ];

        case "appUpdate:state":
          return copy(appUpdate);
        case "appUpdate:check":
          appUpdate = {
            ...appUpdate,
            phase: "current",
            version: undefined,
            restartAt: undefined,
            installMode: undefined,
            checkedAt: "2026-11-21T07:30:00.000Z",
          };
          return copy(appUpdate);
        case "appUpdate:download":
          appUpdate = {
            ...appUpdate,
            phase: "ready",
            version: appUpdate.version ?? "0.12.1",
            installMode: args.mode === "restart" ? "restart" : "onQuit",
            restartAt: args.mode === "restart" ? Date.now() + APP_UPDATE_RESTART_DELAY_MS : undefined,
          };
          return copy(appUpdate);
        case "appUpdate:defer":
          appUpdate = { ...appUpdate, restartAt: undefined, installMode: "onQuit" };
          return copy(appUpdate);
        case "appUpdate:install":
          appUpdate = { ...appUpdate, phase: "installing", restartAt: undefined };
          return copy(appUpdate);

        case "sync:status":
          return syncStatus();
        case "sync:serverInfo":
          return {
            name: "ShowAI Cloud",
            auth: ["password", "token", "github", "google"],
            registration: "open",
          };
        case "sync:connect":
          syncConnected = true;
          connectionsState[0].signedOut = false;
          return { id: "conn-cloud" };
        case "sync:default":
          defaultConnectionId = args.connectionId
            ? String(args.connectionId)
            : null;
          return syncStatus();
        case "sync:signOut": {
          const id = String(args.connectionId ?? "");
          const found = connectionsState.find((item) => item.id === id);
          if (found) found.signedOut = true;
          return syncStatus();
        }
        case "sync:disconnect": {
          const idx = connectionsState.findIndex(
            (item) => item.id === String(args.connectionId ?? ""),
          );
          if (idx >= 0) connectionsState.splice(idx, 1);
          if (!connectionsState.length) syncConnected = false;
          return syncStatus();
        }
        case "sync:projects":
          return [
            {
              id: "remote-p1",
              name: projects[0]?.name ?? "Research",
              role: "admin",
              head: "rev-2",
              archived: false,
            },
            {
              id: "remote-p2",
              name: projects[1]?.name ?? "Project",
              role: "editor",
              head: "rev-5",
              archived: false,
            },
            {
              id: "remote-p3",
              name: "Cloud Roadmap",
              role: "viewer",
              head: "rev-8",
              archived: false,
            },
          ];
        case "sync:previewInvite":
          return {
            url: "https://showai.example/cloud",
            invite: "inv-demo",
            project_id: "remote-p3",
            name: "Cloud Roadmap",
            role: "editor",
            serverId: "srv-cloud",
            serverName: "ShowAI Cloud",
            invitedBy: "lin",
          };
        case "sync:conflict":
          return conflictResolved || !projects[0]
            ? null
            : {
                projectId: projects[0].id,
                recovery: false,
                files: [
                  {
                    path: "pages/overview.json",
                    local: Buffer.from(
                      JSON.stringify(
                        { title: "Overview (Local Edit)", blocks: [] },
                        null,
                        2,
                      ),
                      "utf8",
                    ).toString("base64"),
                    remote: Buffer.from(
                      JSON.stringify(
                        { title: "Overview (Server Update)", blocks: [] },
                        null,
                        2,
                      ),
                      "utf8",
                    ).toString("base64"),
                  },
                ],
              };
        case "sync:resolve":
          conflictResolved = true;
          return syncStatus();
        case "sync:sessions":
          return [
            {
              digest: "sess-current",
              device: "MacBook Pro (macOS)",
              created_at: "2026-11-20T10:00:00.000Z",
              expires_at: "2027-11-20T10:00:00.000Z",
              revoked: 0,
              current: 1,
            },
            {
              digest: "sess-ipad",
              device: "iPad Pro",
              created_at: "2026-11-18T15:20:00.000Z",
              expires_at: "2027-11-18T15:20:00.000Z",
              revoked: 0,
            },
          ];
        case "sync:loginMethods":
          return [
            {
              provider: "github",
              subject: "ada",
              email: "ada@example.com",
              created_at: "2026-11-01T09:00:00.000Z",
            },
          ];
        case "sync:accountProfile":
          return {
            identity: {
              serverId: "srv-cloud",
              serverName: "ShowAI Cloud",
              url: "https://showai.example/cloud",
              user: { id: "u-ada", name: "ada" },
            },
            peers: [],
          };
        case "sync:createToken":
          return {
            token: "showai_pat_demo_0123456789abcdef",
            expiresAt: "2027-11-21T00:00:00.000Z",
          };
        case "sync:resources":
          return [];
        default:
          throw new Error(`Unhandled settings fixture action: ${action}`);
      }
    },
    async event(name, input) {
      if (name === "sync.connected") {
        syncConnected = true;
        conflictResolved = false;
        return;
      }
      if (name === "sync.localOnly") {
        syncConnected = false;
        return;
      }
      if (name === "agent.noLocal") {
        localAgents = defaultLocalAgents.map((agent) => ({
          ...agent,
          path: null,
          version: "",
          auth: "unknown",
          callable: null,
        }));
        agentSettings = { ...agentSettings, mode: "local" };
        return;
      }
      if (name === "update.available") {
        appUpdate = {
          ...appUpdate,
          phase: "available",
          version: "0.12.1",
        };
        return;
      }
      return remote.event(name, input);
    },
    inspect() {
      return {
        ...remote.inspect(),
        syncConnected,
        conflictResolved,
        localAgentsInstalled: localAgents.some((agent) => !!agent.path),
        pluginUpdates: hosts.filter((host) => host.installed && host.current === false)
          .length,
      };
    },
    close() {
      remote.close();
    },
  };
}
