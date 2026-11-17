import {
  remoteMcpActions,
  remoteMcpProviders,
  defaultRemoteMcpConfig,
  type RemoteMcpProvider,
  type RemoteApprovalRequest,
  type RemoteMcpStatus,
} from "../../remote-mcp/types";
import { validateRemoteMcpConfig } from "../../remote-mcp/manager";
import type { SceneFixture } from "../types";

function singleConnectionFixture(
  projects: Array<{ id: string; name: string }>,
  automatic: boolean,
  provider: RemoteMcpProvider,
  index: number,
): SceneFixture {
  let sequence = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let requests: RemoteApprovalRequest[] = [];
  let lastDecision: "allow" | "deny" | undefined;
  const state: RemoteMcpStatus = {
    phase: "stopped",
    configured: false,
    config: defaultRemoteMcpConfig(provider),
    tokenSaved: false,
    clients: [],
    projects,
    addresses: [
      { name: "en0", address: "192.168.50.20" },
      { name: "en1", address: "10.0.0.20" },
    ],
    executables: {
      cloudflare: "/ui-lab/bin/cloudflared",
      tailscale: "/ui-lab/bin/tailscale",
    },
  };
  const copy = <T>(value: T): T => structuredClone(value);
  function ready() {
    if (state.phase !== "starting" && state.phase !== "running")
      throw new Error("Start the service before completing its connection.");
    state.phase = "running";
    state.reachable = true;
    state.error = undefined;
    state.checkedAt = "2026-11-17T00:00:00.000Z";
    state.localUrl =
      state.config.provider === "lan"
        ? `http://${state.config.bindAddress}:${8789 + index}`
        : `http://127.0.0.1:${8789 + index}`;
    state.url =
      (state.config.provider === "lan"
        ? state.localUrl
        : state.config.provider === "cloudflare"
          ? state.config.publicUrl
          : state.config.provider === "cloudflare-quick"
            ? "https://quick.showai.example"
            : `https://macbook.ui-lab.ts.net${state.config.provider === "tailscale-private" ? ":8443" : ""}`) +
      "/mcp";
  }
  return {
    actions: remoteMcpActions,
    async invoke(action, args) {
      switch (action) {
        case "remoteMcp:status":
          return copy(state);
        case "remoteMcp:requests":
          return copy(requests);
        case "remoteMcp:configure":
          state.config = validateRemoteMcpConfig(args.config);
          if (args.token) state.tokenSaved = true;
          state.configured = true;
          return copy(state);
        case "remoteMcp:prepare":
          state.config = {
            ...validateRemoteMcpConfig(args.config),
            port: 8789 + index,
          };
          state.phase = "prepared";
          state.configured = true;
          state.localUrl = `http://127.0.0.1:${8789 + index}`;
          return copy(state);
        case "remoteMcp:start": {
          clearTimeout(timer);
          const config = validateRemoteMcpConfig(args.config);
          if (config.access === "selected" && !config.projects.length)
            throw new Error("Select at least one project.");
          if (
            config.provider === "lan" &&
            !state.addresses.some(
              (address) => address.address === config.bindAddress,
            )
          )
            throw new Error("Choose an available LAN address.");
          if (
            config.provider === "cloudflare" &&
            (!config.publicUrl || (!args.token && !state.tokenSaved))
          )
            throw new Error("Enter the domain and tunnel token.");
          state.config = config;
          state.phase = "starting";
          state.configured = true;
          state.reachable = undefined;
          state.error = undefined;
          state.lastCallAt = undefined;
          state.lastCallClientId = undefined;
          state.clients = [];
          lastDecision = undefined;
          state.approval = undefined;
          state.resumeOnLaunch = true;
          if (args.token) state.tokenSaved = true;
          if (automatic) timer = setTimeout(ready, 500);
          return copy(state);
        }
        case "remoteMcp:stop":
          clearTimeout(timer);
          requests = [];
          state.phase = "stopped";
          state.url = undefined;
          state.localUrl = undefined;
          state.resumeOnLaunch = false;
          state.error = undefined;
          state.reachable = false;
          state.clients = [];
          state.lastCallAt = undefined;
          return copy(state);
        case "remoteMcp:check":
          return copy(state);
        case "remoteMcp:createAccessKey": {
          if (state.phase !== "running" || state.config.provider !== "lan")
            throw new Error("Start a LAN connection first.");
          if (typeof args.name !== "string" || !args.name.trim())
            throw new Error("Enter a client name.");
          const id = `ui-lab-${provider}-client-${++sequence}`;
          state.clients.push({
            id,
            name: args.name.trim(),
            projectIds: state.config.projects.map((project) => project.id),
            scopes:
              state.config.access === "selected"
                ? ["projects.read"]
                : ["projects.read", "projects.write", "projects.create"],
          });
          return {
            id,
            token: "UI_LAB_DEMONSTRATION_KEY_NOT_A_REAL_CREDENTIAL",
            expiresAt: "2027-02-15T00:00:00.000Z",
          };
        }
        case "remoteMcp:decide": {
          const request = requests.find((request) => request.id === args.id);
          if (!request) throw new Error("Authorization request not found.");
          if (args.decision !== "allow" && args.decision !== "deny")
            throw new Error("Invalid authorization decision.");
          lastDecision = args.decision;
          state.approval = {
            decision: args.decision,
            clientName: request.clientName,
            at: "2026-11-17T00:00:00.000Z",
          };
          requests = requests.filter((request) => request.id !== args.id);
          if (args.decision === "allow")
            state.clients.push({
              id: request.id,
              name: request.clientName,
              projectIds: state.config.projects.map((project) => project.id),
              scopes: request.scopes,
            });
          else if (args.decision !== "deny")
            throw new Error("Invalid authorization decision.");
          return copy(requests);
        }
        case "remoteMcp:revoke":
          state.clients = state.clients.filter(
            (client) => client.id !== args.id,
          );
          return copy(state);
        case "remoteMcp:chooseExecutable":
          return "/ui-lab/bin/tailscale";
        case "remoteMcp:installCloudflare":
          state.executables.cloudflare = "/ui-lab/bin/cloudflared";
          return state.executables.cloudflare;
        case "remoteMcp:exportPlugin": {
          if (state.phase !== "running" || !state.url)
            throw new Error("Start the connection first.");
          if (
            typeof args.connection !== "string" ||
            !/asdk_app_[A-Za-z0-9]+/.test(args.connection)
          )
            throw new Error("Enter the ChatGPT connection link.");
          state.config.chatgptAppId = "asdk_app_UILAB";
          state.config.chatgptEndpoint = state.url;
          return {
            path: "/ui-lab/exports/showai-personal.zip",
            url: state.url,
          };
        }
        default:
          throw new Error(`Unsupported remote fixture action: ${action}`);
      }
    },
    async event(name, input) {
      if (name === "tools.empty") {
        state.executables = { cloudflare: null, tailscale: null };
      } else if (name === "addresses.empty") {
        state.addresses = [];
      } else if (name === "service.ready") {
        clearTimeout(timer);
        ready();
      } else if (name === "service.error") {
        clearTimeout(timer);
        state.phase = "error";
        state.reachable = false;
        state.error = "UI_LAB_NETWORK_UNREACHABLE";
        state.diagnostics =
          "The simulated service could not reach its configured address.";
      } else if (name === "authorization.request") {
        lastDecision = undefined;
        if (state.phase !== "running")
          throw new Error("The service is not running.");
        requests = [
          {
            id: `ui-lab-${provider}-oauth-${++sequence}`,
            code: "A17B-2026",
            clientName:
              typeof input.clientName === "string"
                ? input.clientName
                : "UI Lab MCP client",
            callbackOrigin: "https://chatgpt.com",
            access: state.config.access ?? "all",
            scopes: ["projects.read", "projects.write", "projects.create"],
            createdAt: "2026-11-17T00:00:00.000Z",
            expiresAt: "2099-11-17T00:10:00.000Z",
          },
        ];
      } else if (name === "client.call") {
        if (state.phase !== "running" || !state.clients.length)
          throw new Error("Client has no authorization.");
        state.lastCallAt = "2026-11-17T00:01:00.000Z";
        state.lastCallClientId = state.clients.at(-1)!.id;
      } else throw new Error(`Unknown remote fixture event: ${name}`);
    },
    inspect: () => copy({ ...state, requests, lastDecision }),
    close: () => clearTimeout(timer),
  };
}

export function remoteConnectionFixture(
  projects: Array<{ id: string; name: string }>,
  automatic: boolean,
): SceneFixture {
  const profiles = new Map(
    remoteMcpProviders.map((provider, index) => [
      provider,
      singleConnectionFixture(projects, automatic, provider, index),
    ]),
  );
  let selected: RemoteMcpProvider = "lan";
  const get = (provider: unknown = selected) => {
    if (!remoteMcpProviders.includes(provider as RemoteMcpProvider))
      throw new Error("Unknown connection provider.");
    return profiles.get(provider as RemoteMcpProvider)!;
  };
  const requests = () =>
    [...profiles].flatMap(([provider, fixture]) =>
      (fixture.inspect().requests as RemoteApprovalRequest[]).map(
        (request) => ({ ...request, provider }),
      ),
    );
  const connections = () =>
    [...profiles].map(([provider, fixture]) => {
      const value = fixture.inspect() as unknown as RemoteMcpStatus;
      return {
        provider,
        phase: value.phase,
        configured: !!value.configured,
        enabled: !!value.resumeOnLaunch,
        config: value.config,
        url: value.url,
        reachable: value.reachable,
        clients: value.clients.length,
        error: value.error,
      };
    });
  const inspect = () => ({
    ...get().inspect(),
    connections: connections(),
    requests: requests(),
  });
  return {
    actions: remoteMcpActions,
    async invoke(action, args) {
      if (action === "remoteMcp:requests") return requests();
      if (action === "remoteMcp:decide") {
        const request = requests().find((request) => request.id === args.id);
        if (!request) throw new Error("Authorization request not found.");
        await get(request.provider).invoke(action, args);
        return requests();
      }
      const provider =
        (args.config as { provider?: RemoteMcpProvider } | undefined)
          ?.provider ??
        args.provider ??
        selected;
      const fixture = get(provider);
      selected = provider as RemoteMcpProvider;
      const result = await fixture.invoke(action, args);
      if (
        [
          "remoteMcp:status",
          "remoteMcp:start",
          "remoteMcp:stop",
          "remoteMcp:configure",
          "remoteMcp:prepare",
          "remoteMcp:check",
          "remoteMcp:revoke",
        ].includes(action)
      )
        return { ...(result as object), connections: connections() };
      return result;
    },
    async event(name, input) {
      if (name === "connections.multiple") {
        for (const provider of [
          "lan",
          "tailscale-private",
          "cloudflare-quick",
        ] as const) {
          const config = {
            ...defaultRemoteMcpConfig(provider),
            bindAddress: "192.168.50.20",
          };
          await get(provider).invoke("remoteMcp:start", { config });
          await get(provider).event("service.ready", {});
        }
        return;
      }
      if (input.provider) selected = input.provider as RemoteMcpProvider;
      if (name === "tools.empty") {
        for (const fixture of profiles.values())
          await fixture.event(name, input);
        return;
      }
      await get().event(name, input);
    },
    inspect,
    close() {
      for (const fixture of profiles.values()) fixture.close();
    },
  };
}
