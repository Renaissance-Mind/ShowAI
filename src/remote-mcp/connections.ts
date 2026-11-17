import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { RemoteMcpManager, validateRemoteMcpConfig } from "./manager";
import {
  remoteMcpProviders,
  type RemoteMcpProvider,
  type RemoteMcpStatus,
} from "./types";
import { tailscalePort } from "./network";
import { isTailscaleProvider } from "./client-setup";

type Options = Omit<
  ConstructorParameters<typeof RemoteMcpManager>[0],
  "provider" | "reserveHttpsPort" | "releaseHttpsPort"
>;
export class RemoteMcpConnections {
  private managers = new Map<RemoteMcpProvider, RemoteMcpManager>();
  private selected: RemoteMcpProvider = "lan";
  private legacy?: RemoteMcpProvider;
  private initialized?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private reservations = new Map<RemoteMcpProvider, number>();
  private restoreErrors = new Map<RemoteMcpProvider, string>();
  private installing?: Promise<string>;
  constructor(private options: Options) {}
  private provider(value: unknown): RemoteMcpProvider {
    if (
      typeof value !== "string" ||
      !remoteMcpProviders.includes(value as RemoteMcpProvider)
    )
      throw new Error("Unknown remote connection provider.");
    return value as RemoteMcpProvider;
  }
  private initialize() {
    return (this.initialized ??= (async () => {
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const read = (file: string) =>
        readFile(join(this.options.directory, file), "utf8").then(
          JSON.parse,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
      const [registry, legacy] = await Promise.all([
        read("connections.json"),
        read("config.json"),
      ]);
      this.legacy = registry?.legacyProvider
        ? this.provider(registry.legacyProvider)
        : legacy?.config
          ? this.provider(legacy.config.provider)
          : undefined;
      this.selected = registry?.selected
        ? this.provider(registry.selected)
        : (this.legacy ?? "lan");
      for (const provider of remoteMcpProviders) {
        const manager = new RemoteMcpManager({
          ...this.options,
          provider,
          directory:
            this.legacy === provider
              ? this.options.directory
              : join(this.options.directory, "connections", provider),
          toolsDirectory: join(this.options.directory, "tools"),
          reserveHttpsPort: (existing, preferred) => {
            const ports = Object.fromEntries(
              [...this.reservations]
                .filter(([key]) => key !== provider)
                .map(([, port]) => [port, { HTTPS: true }]),
            );
            const port = tailscalePort(
              { ...existing, TCP: { ...existing.TCP, ...ports } },
              preferred,
            );
            this.reservations.set(provider, port);
            return port;
          },
          releaseHttpsPort: () => {
            this.reservations.delete(provider);
          },
        });
        this.managers.set(provider, manager);
      }
    })());
  }
  private async manager(provider?: unknown) {
    await this.initialize();
    return this.managers.get(
      provider === undefined ? this.selected : this.provider(provider),
    )!;
  }
  private async select(provider: RemoteMcpProvider) {
    await this.initialize();
    this.selected = provider;
    this.restoreErrors.delete(provider);
    const value = JSON.stringify({
      version: 1,
      selected: provider,
      legacyProvider: this.legacy,
    });
    const operation = this.writes.then(async () => {
      const path = join(this.options.directory, "connections.json");
      await writeFile(path + ".tmp", value, { mode: 0o600 });
      await rename(path + ".tmp", path);
    });
    this.writes = operation.then(
      () => undefined,
      () => undefined,
    );
    await operation;
  }
  async status(refresh = false, provider?: unknown): Promise<RemoteMcpStatus> {
    await this.initialize();
    const values = await Promise.all(
      remoteMcpProviders.map(async (key) => {
        const value = await this.managers.get(key)!.status(refresh),
          error = this.restoreErrors.get(key);
        return {
          ...value,
          ...(error && value.phase === "stopped"
            ? { phase: "error" as const, error }
            : {}),
        };
      }),
    );
    const selected =
      values[
        remoteMcpProviders.indexOf(
          provider === undefined ? this.selected : this.provider(provider),
        )
      ];
    const executables = {
      cloudflare:
        values.find((value) => value.executables.cloudflare)?.executables
          .cloudflare ?? null,
      tailscale:
        values.find((value) => value.executables.tailscale)?.executables
          .tailscale ?? null,
    };
    return {
      ...selected,
      executables,
      connections: values.map((value) => ({
        provider: value.config.provider,
        phase: value.phase,
        configured: !!value.configured,
        enabled: !!value.resumeOnLaunch,
        config: value.config,
        url: value.url,
        reachable: value.reachable,
        clients: value.clients.length,
        error: value.error,
      })),
    };
  }
  async configure(value: unknown, token?: unknown) {
    const config = validateRemoteMcpConfig(value);
    await this.select(config.provider);
    await (await this.manager(config.provider)).configure(config, token);
    return this.status(false, config.provider);
  }
  async prepare(value: unknown) {
    const config = validateRemoteMcpConfig(value);
    await this.select(config.provider);
    await (await this.manager(config.provider)).prepare(config);
    return this.status(false, config.provider);
  }
  async start(value: unknown, token?: unknown) {
    const config = validateRemoteMcpConfig(value);
    await this.select(config.provider);
    if (
      !config.executable &&
      !isTailscaleProvider(config.provider) &&
      config.provider !== "lan"
    )
      config.executable =
        (await this.status(false, config.provider)).executables.cloudflare ??
        "";
    await (await this.manager(config.provider)).start(config, token);
    return this.status(false, config.provider);
  }
  async stop(provider?: unknown) {
    const manager = await this.manager(provider);
    this.restoreErrors.delete((await manager.status()).config.provider);
    await manager.stop();
    return this.status(false, provider);
  }
  async stopAll() {
    await this.initialize();
    await Promise.all(
      [...this.managers.values()].map(async (manager) => {
        const state = await manager.status();
        if (state.configured || state.phase !== "stopped") await manager.stop();
      }),
    );
  }
  async suspend() {
    await this.initialize();
    await Promise.all(
      [...this.managers.values()].map((manager) => manager.suspend()),
    );
  }
  async restore() {
    await this.initialize();
    await Promise.all(
      [...this.managers].map(async ([provider, manager]) => {
        try {
          await manager.restore();
        } catch (error) {
          this.restoreErrors.set(
            provider,
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
    return this.status();
  }
  async check(provider?: unknown) {
    await (await this.manager(provider)).check();
    return this.status(false, provider);
  }
  async createAccessKey(name: string, provider?: unknown) {
    return (await this.manager(provider)).createAccessKey(name);
  }
  async pair(provider?: unknown) {
    return (await this.manager(provider)).pair();
  }
  async revoke(id: string, provider?: unknown) {
    await (await this.manager(provider)).revoke(id);
    return this.status(false, provider);
  }
  async requests() {
    await this.initialize();
    return [...this.managers]
      .flatMap(([provider, manager]) =>
        manager.requests().map((request) => ({ ...request, provider })),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async decide(id: string, decision: "allow" | "deny") {
    await this.initialize();
    const manager = [...this.managers.values()].find((manager) =>
      manager.requests().some((request) => request.id === id),
    );
    if (!manager) throw new Error("The connection request has expired.");
    manager.decide(id, decision);
    return this.requests();
  }
  async rememberChatgptApp(id: string, endpoint: string, provider?: unknown) {
    return (await this.manager(provider)).rememberChatgptApp(id, endpoint);
  }
  async installCloudflare(provider?: unknown) {
    const existing = (await this.status(true, provider)).executables.cloudflare;
    if (existing) return existing;
    if (!this.installing)
      this.installing = (await this.manager(provider))
        .installCloudflare()
        .finally(() => {
          this.installing = undefined;
        });
    return this.installing;
  }
}
