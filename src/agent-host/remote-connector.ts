import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { syncManager } from "../sync/manager";
import { readOptional, writeProtected } from "./storage";
import { RemoteAgentEngine } from "./remote-engine";
import {
  defaultAgentGateway,
  secureGateway,
  type AgentInvocation,
} from "./remote-protocol";
import type { AgentHost } from "./host";
import { LanPeerServer } from "./lan-peer";
import { FileStore } from "../core/store";

export interface ConnectorSettings {
  enabled: boolean;
  nearbyEnabled?: boolean;
  gatewayUrl: string;
  connectionId: string;
  projectIds: string[];
  deviceId: string;
  name: string;
  trustedClients?: { id: string; name: string }[];
}
export const remoteDeviceActions = new Set([
  "agent:remoteDevice",
  "agent:shareDevice",
  "agent:approveRemoteClient",
]);
/** Outbound only. The desktop keeps its own model credentials and project grants. */
export class RemoteMacConnector {
  readonly lan: LanPeerServer;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private renew?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private generation = 0;
  private settings?: ConnectorSettings;
  private initialization?: Promise<void>;
  private error = "";
  private online = false;
  private sharedHome?: string;
  private originalAfterTurn: AgentHost["options"]["afterTurn"];
  private pendingClients = new Map<string, string>();
  private engine?: RemoteAgentEngine;
  private engineKey = "";
  constructor(
    readonly host: AgentHost,
    readonly home: () => string,
  ) {
    this.lan = new LanPeerServer(host, home, () => this.settings);
    this.originalAfterTurn = host.options.afterTurn;
  }
  private get path() {
    return join(this.host.options.root, "remote-device.json");
  }
  async status() {
    if (this.online && this.sharedHome !== this.home()) this.close();
    this.initialization ??= (async () => {
      const saved = await readOptional<ConnectorSettings>(this.path);
      this.settings = saved
        ? { ...saved, nearbyEnabled: saved.nearbyEnabled ?? saved.enabled }
        : {
            enabled: false,
            nearbyEnabled: true,
            gatewayUrl: defaultAgentGateway,
            connectionId: "",
            projectIds: [],
            deviceId: randomUUID(),
            name: hostname(),
          };
      await writeProtected(this.path, this.settings);
    })();
    await this.initialization;
    const settings = this.settings!;
    const config = await syncManager(this.home()).configuration();
    const projects = await new FileStore(this.home()).listProjects();
    return {
      settings,
      lan: this.lan.status,
      online: this.online,
      error: this.error,
      pendingClients: [
        ...this.lan.status.pending,
        ...[...this.pendingClients].map(([id, name]) => ({ id, name })),
      ],
      connections: config.connections
        .filter((c) => !c.signedOut)
        .map((c) => ({ id: c.id, name: `${c.name} · ${c.user.name}` })),
      projects: config.projects.map((p) => ({
        id: p.remoteProjectId,
        localId: p.projectId,
        name: projects.find((project) => project.id === p.projectId)?.name,
        connectionId: p.connectionId,
      })),
    };
  }
  async approveClient(id: string, approve: boolean) {
    if (id.startsWith("lan:")) {
      await this.lan.approve(id.slice(4), approve);
      return this.status();
    }
    const { settings } = await this.status(),
      name =
        this.pendingClients.get(id) ??
        settings.trustedClients?.find((c) => c.id === id)?.name;
    if (!name) throw new Error("The pairing request has expired.");
    settings.trustedClients = [
      ...(settings.trustedClients ?? []).filter((c) => c.id !== id),
      ...(approve ? [{ id, name }] : []),
    ];
    await writeProtected(this.path, settings);
    this.settings = settings;
    if (!approve) {
      void this.engine?.turns
        .stopAll()
        .catch((error) =>
          console.error("Remote task cancellation:", error.message),
        );
    }
    this.pendingClients.delete(id);
    return this.status();
  }
  async save(input: ConnectorSettings) {
    const { settings: previous } = await this.status();
    if (this.settings && this.settings.connectionId !== input.connectionId)
      input.trustedClients = [];
    secureGateway(input.gatewayUrl);
    const config = await syncManager(this.home()).configuration();
    const grantsChanged =
      !previous.enabled ||
      previous.connectionId !== input.connectionId ||
      JSON.stringify(previous.projectIds) !== JSON.stringify(input.projectIds);
    if (
      input.enabled &&
      grantsChanged &&
      (!config.connections.some(
        (c) => c.id === input.connectionId && !c.signedOut,
      ) ||
        !input.projectIds.length)
    )
      throw new Error(
        "Choose a signed-in server account and at least one synchronized project.",
      );
    if (
      input.enabled &&
      grantsChanged &&
      input.projectIds.some(
        (id) =>
          !config.projects.some(
            (p) =>
              p.connectionId === input.connectionId && p.remoteProjectId === id,
          ),
      )
    )
      throw new Error(
        "Only synchronized projects from the selected account can be shared.",
      );
    if (
      !/^[a-f0-9-]{36}$/.test(input.deviceId) ||
      !input.name.trim() ||
      input.name.length > 100
    )
      throw new Error("Invalid device identity.");
    await writeProtected(this.path, input);
    this.settings = input;
    this.close();
    await this.lan.close();
    await this.start();
    return this.status();
  }
  async start() {
    const { settings } = await this.status();
    await this.lan.start().catch((error) => {
      this.lan.error = error.message;
    });
    if (!settings.enabled) return;
    this.stopped = false;
    const generation = ++this.generation;
    let retryDelay = 10000;
    const connect = async () => {
      const sharedHome = this.home();
      const connection = (
        await syncManager(this.home()).configuration()
      ).connections.find((c) => c.id === settings.connectionId && !c.signedOut);
      if (!connection) throw new Error("The shared account is signed out.");
      const gateway = secureGateway(settings.gatewayUrl);
      const response = await fetch(gateway + "/devices/ticket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings,
          serverUrl: connection.url,
          token: connection.token,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      const ticket = await response.json();
      const retryAfter = Number(response.headers.get("retry-after"));
      retryDelay = response.ok
        ? 10000
        : Math.max(10000, Math.min(86400000, retryAfter * 1000 || 10000));
      if (!response.ok || !ticket.ticket)
        throw new Error(ticket.error?.message ?? "Device registration failed.");
      if (this.stopped || generation !== this.generation) return;
      if (sharedHome !== this.home())
        throw new Error(
          "The content library changed. Reconnect remote execution.",
        );
      this.sharedHome = sharedHome;
      const engineKey = JSON.stringify([
        sharedHome,
        settings.connectionId,
        settings.projectIds,
      ]);
      const engine =
        this.engineKey === engineKey && this.engine
          ? this.engine
          : new RemoteAgentEngine({
              root: this.host.options.root,
              library: this.home(),
              cli: this.host.options.cli,
              pluginRoot: this.host.options.pluginRoot,
              host: this.host,
              connectionId: settings.connectionId,
              projectIds: settings.projectIds,
            });
      this.engine = engine;
      this.engineKey = engineKey;
      this.host.options.afterTurn = async (projectId, turn) => {
        await this.originalAfterTurn?.(projectId, turn);
        if (!turn || !engine.turns.owns(turn.id)) return;
        const manager = syncManager(sharedHome);
        const mapping = (await manager.configuration()).projects.find(
          (p) =>
            p.projectId === projectId &&
            p.connectionId === settings.connectionId &&
            settings.projectIds.includes(p.remoteProjectId),
        );
        if (mapping) {
          const state = (await manager.run(projectId)).projects.find(
            (p) => p.projectId === projectId,
          );
          if (state?.status !== "synced")
            throw new Error(
              state?.error ?? "Agent changes have not synchronized.",
            );
        }
      };
      const url = new URL(`/devices/connect/${ticket.tenant}`, gateway);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket.ticket);
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        this.online = true;
        this.error = "";
        this.heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: "ping" }));
        }, 30000);
        this.renew = setTimeout(
          () => socket.close(1000, "Renew authorization"),
          9 * 60 * 1000,
        );
      };
      socket.onmessage = (event) => {
        const run = async () => {
          const input = JSON.parse(String(event.data)) as AgentInvocation & {
            type: string;
          };
          if (input.type !== "invoke") return;
          let reply;
          try {
            if (sharedHome !== this.home())
              throw new Error(
                "The Mac content library changed. Reconnect remote execution.",
              );
            const current = this.settings ?? settings;
            if (
              !input.clientId ||
              !current.trustedClients?.some((c) => c.id === input.clientId)
            ) {
              if (input.clientId && this.pendingClients.size < 30)
                this.pendingClients.set(
                  input.clientId,
                  input.clientName ?? "ShowAI iPad",
                );
              throw new Error(
                "Confirm this iPad in ShowAI on the Mac: Settings → Agent → Remote execution.",
              );
            }
            const data = await engine.invoke(input);
            reply = { ok: true, data };
          } catch (error) {
            reply = { ok: false, error: { message: (error as Error).message } };
          }
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                type: "reply",
                requestId: input.requestId,
                reply,
              }),
            );
        };
        void run().catch((error) => {
          this.error = error.message;
          socket.close(1008, "Invalid relay message");
        });
      };
      socket.onerror = () => {
        this.error = "Remote connection interrupted.";
      };
      socket.onclose = () => {
        this.online = false;
        clearInterval(this.heartbeat);
        clearTimeout(this.renew);
        if (!this.stopped && generation === this.generation)
          this.retry = setTimeout(() => {
            void connect().catch(failed);
          }, 3000);
      };
    };
    const failed = (error: Error) => {
      this.error = error.message;
      this.online = false;
      if (!this.stopped && generation === this.generation)
        this.retry = setTimeout(() => {
          void connect().catch(failed);
        }, retryDelay);
    };
    await connect().catch(failed);
  }
  close() {
    void this.lan
      .close()
      .catch((error) => console.error("Local sharing:", error.message));
    this.stopped = true;
    this.generation++;
    clearTimeout(this.retry);
    clearTimeout(this.renew);
    clearInterval(this.heartbeat);
    this.socket?.close();
    this.online = false;
    void this.engine?.turns
      .stopAll()
      .catch((error) =>
        console.error("Remote task cancellation:", error.message),
      );
  }
}
