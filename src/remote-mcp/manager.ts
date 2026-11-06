import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { execute, findExecutable } from "../agent-host/process";
import { startMcpHttpServer } from "../agent/mcp-http";
import { FileStore, assertId } from "../core/store";
import type { RemoteMcpConfig, RemoteMcpStatus } from "./types";
import { installCloudflared } from "./install";
import { localLibraryPolicy } from "./local-library";

const defaults: RemoteMcpConfig = {
  provider: "cloudflare-quick",
  publicUrl: "",
  port: 0,
  access: "all",
  executable: "",
  projects: [],
};
export function validateRemoteMcpConfig(value: unknown): RemoteMcpConfig {
  const c = value as RemoteMcpConfig;
  if (
    !c ||
    !["cloudflare-quick", "cloudflare", "tailscale"].includes(c.provider) ||
    !Number.isInteger(c.port) ||
    (c.port !== 0 && c.port < 1024) ||
    c.port > 65535 ||
    typeof c.publicUrl !== "string" ||
    typeof c.executable !== "string" ||
    (c.executable && !isAbsolute(c.executable)) ||
    (c.access !== undefined && !["all", "selected"].includes(c.access)) ||
    !Array.isArray(c.projects)
  )
    throw new Error("Invalid remote connection configuration.");
  const projects = c.projects.map((p) => {
    if (!p || typeof p.id !== "string" || typeof p.write !== "boolean")
      throw new Error("Invalid project permission.");
    return { id: assertId(p.id), write: p.write };
  });
  if (new Set(projects.map((p) => p.id)).size !== projects.length)
    throw new Error("Duplicate project permissions.");
  let publicUrl = c.publicUrl.trim();
  if (c.provider === "cloudflare" && publicUrl) {
    const u = new URL(publicUrl);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !["/", "/mcp"].includes(u.pathname)
    )
      throw new Error(
        "Enter the HTTPS tunnel hostname, without a query or credentials.",
      );
    publicUrl = u.origin;
  }
  return {
    provider: c.provider,
    access: c.access ?? "all",
    port: c.port,
    publicUrl,
    executable: c.executable.trim(),
    projects,
  };
}

/** Owns only the foreground connector it starts. Never resets an existing tunnel or tailnet. */
export class RemoteMcpManager {
  private config = { ...defaults };
  private encryptedToken?: string;
  private managedCloudflared?: string;
  private phase: RemoteMcpStatus["phase"] = "stopped";
  private error?: string;
  private diagnostics?: string;
  private checkedAt?: string;
  private reachable?: boolean;
  private lastCallAt?: string;
  private lastCallClientId?: string;
  private child?: ChildProcess;
  private childClosed?: Promise<void>;
  private http?: Awaited<ReturnType<typeof startMcpHttpServer>>;
  private pairing?: { hash: Buffer; expires: number };
  private instanceId = randomBytes(16).toString("hex");
  private initialized?: Promise<void>;
  private task?: Promise<void>;
  private commands: Promise<unknown> = Promise.resolve();
  private abort?: AbortController;
  private executables = {
    cloudflare: null as string | null,
    tailscale: null as string | null,
  };
  constructor(
    private options: {
      directory: string;
      home: () => string;
      encrypt: (value: string) => string;
      decrypt: (value: string) => string;
    },
  ) {}
  private initialize() {
    return (this.initialized ??= (async () => {
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const saved = await readFile(
        join(this.options.directory, "config.json"),
        "utf8",
      ).then(JSON.parse, (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (saved) {
        // Legacy setup required picking projects without an explicit access mode.
        // New defaults are library-wide; old limited grants are revoked before use.
        this.config = validateRemoteMcpConfig(saved.config);
        this.managedCloudflared =
          typeof saved.managedCloudflared === "string"
            ? saved.managedCloudflared
            : undefined;
        this.encryptedToken =
          typeof saved.encryptedToken === "string"
            ? saved.encryptedToken
            : undefined;
      }
    })());
  }
  installCloudflare() {
    return this.command(async () => {
      await this.initialize();
      if (this.phase === "starting" || this.phase === "running")
        throw new Error("Stop the connection before installing a connector.");
      const executable = await installCloudflared(
        join(this.options.directory, "tools"),
      );
      this.config = { ...this.config, executable };
      this.managedCloudflared = executable;
      const path = join(this.options.directory, "config.json");
      await writeFile(
        path + ".tmp",
        JSON.stringify({
          config: this.config,
          encryptedToken: this.encryptedToken,
          managedCloudflared: this.managedCloudflared,
        }),
        { mode: 0o600 },
      );
      await rename(path + ".tmp", path);
      return executable;
    });
  }
  private async discover() {
    const [cloudflare, found] = await Promise.all([
      findExecutable("cloudflared"),
      findExecutable("tailscale"),
    ]);
    let tailscale = found;
    if (!tailscale && process.platform === "darwin") {
      const candidate = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
      if (
        await access(candidate, constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        tailscale = candidate;
    }
    if (!tailscale && process.platform === "win32") {
      const candidate = join(
        process.env.PROGRAMFILES ?? "C:/Program Files",
        "Tailscale",
        "tailscale.exe",
      );
      if (
        await access(candidate, constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        tailscale = candidate;
    }
    const managed =
      this.managedCloudflared &&
      (await access(this.managedCloudflared, constants.X_OK).then(
        () => this.managedCloudflared,
        () => undefined,
      ));
    this.executables = { cloudflare: cloudflare ?? managed ?? null, tailscale };
  }
  async status(refresh = false): Promise<RemoteMcpStatus> {
    await this.initialize();
    if (refresh) await this.discover();
    const projects = await new FileStore(this.options.home()).listProjects();
    return {
      phase: this.phase,
      config: this.config,
      tokenSaved: !!this.encryptedToken,
      url: this.http ? this.http.url + "/mcp" : undefined,
      localUrl: this.http?.localUrl,
      error: this.error,
      diagnostics: this.diagnostics,
      checkedAt: this.checkedAt,
      reachable: this.reachable,
      lastCallAt: this.lastCallAt,
      lastCallClientId: this.lastCallClientId,
      clients: this.http?.authorization.connections() ?? [],
      projects: projects
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id, name: p.name })),
      executables: this.executables,
    };
  }
  private command<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.commands.then(operation);
    this.commands = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  start(value: unknown, token?: unknown) {
    return this.command(() => this.startImpl(value, token));
  }
  prepare(value: unknown) {
    return this.command(async () => {
      await this.initialize();
      if (["starting", "running"].includes(this.phase))
        throw new Error("Stop the connection before changing its route.");
      const input = value as RemoteMcpConfig;
      const config = validateRemoteMcpConfig({
        ...input,
        publicUrl: "https://setup.invalid",
      });
      config.publicUrl = input.publicUrl;
      await this.stopImpl();
      this.config = config;
      this.http = await this.openListener(config);
      this.config = {
        ...config,
        port: Number(new URL(this.http.localUrl).port),
      };
      this.phase = "prepared";
      this.error = undefined;
      return this.status();
    });
  }
  private localPolicy(c: RemoteMcpConfig) {
    const home = this.options.home();
    return {
      root: home,
      ...localLibraryPolicy(home, c),
      consumePairingCode: (code: string) => {
        const digest = createHash("sha256").update(code.trim()).digest();
        if (
          !this.pairing ||
          this.pairing.expires < Date.now() ||
          !timingSafeEqual(digest, this.pairing.hash)
        )
          return false;
        this.pairing = undefined;
        return true;
      },
      onCall: (_name: string, clientId: string) => {
        this.lastCallClientId = clientId;
        this.lastCallAt = new Date().toISOString();
      },
    };
  }
  private serverOptions(c: RemoteMcpConfig, origin?: string) {
    return {
      local: this.localPolicy(c),
      instanceId: this.instanceId,
      stateDirectory: join(
        this.options.directory,
        createHash("sha256")
          .update(this.options.home() + (origin ?? this.instanceId))
          .digest("hex"),
      ),
    };
  }
  private async openListener(c: RemoteMcpConfig, origin?: string) {
    const options = this.serverOptions(c, origin);
    try {
      return await startMcpHttpServer({
        ...options,
        port: c.provider === "cloudflare" ? c.port : 0,
        publicUrl: origin,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      return startMcpHttpServer({ ...options, port: 0, publicUrl: origin });
    }
  }
  private async startImpl(value: unknown, token?: unknown) {
    await this.initialize();
    if (this.phase === "starting" || this.phase === "running")
      throw new Error(
        "Stop the current connection before changing its configuration.",
      );
    if (this.phase !== "prepared") await this.stopImpl();
    const config = validateRemoteMcpConfig(value);
    if (config.provider === "cloudflare" && !config.publicUrl)
      throw new Error("Enter the public HTTPS domain before connecting.");
    if (config.access === "selected" && !config.projects.length)
      throw new Error("Select at least one project.");
    const store = new FileStore(this.options.home());
    for (const p of config.projects) await store.readProject(p.id);
    if (
      config.provider === "cloudflare" &&
      typeof token === "string" &&
      token.trim()
    )
      this.encryptedToken = this.options.encrypt(token.trim());
    if (config.provider === "cloudflare" && !this.encryptedToken)
      throw new Error("Enter your Cloudflare tunnel token.");
    this.config = config;
    const path = join(this.options.directory, "config.json");
    await writeFile(
      path + ".tmp",
      JSON.stringify({
        config,
        encryptedToken: this.encryptedToken,
        managedCloudflared: this.managedCloudflared,
      }),
      { mode: 0o600 },
    );
    await rename(path + ".tmp", path);
    this.phase = "starting";
    this.error = undefined;
    this.diagnostics = undefined;
    this.lastCallAt = undefined;
    this.lastCallClientId = undefined;
    this.checkedAt = undefined;
    this.reachable = undefined;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.task = this.launch(signal).catch(async (error: Error) => {
      if (!signal.aborted) {
        this.phase = "error";
        this.error = error.message;
      }
      await this.cleanup();
    });
    return this.status();
  }
  private async launch(signal: AbortSignal) {
    await this.discover();
    signal.throwIfAborted();
    const c = this.config;
    const executable =
      c.executable ||
      (c.provider === "tailscale"
        ? this.executables.tailscale
        : this.executables.cloudflare);
    if (!executable)
      throw new Error(
        `Install ${c.provider === "tailscale" ? "Tailscale" : "cloudflared"}, then check again.`,
      );
    await access(executable, constants.X_OK);
    let origin = c.provider === "cloudflare" ? c.publicUrl : undefined;
    if (c.provider === "tailscale") {
      const status = await execute(executable, ["status", "--json"], {
        timeout: 15000,
        signal,
      });
      if (status.code !== 0)
        throw new Error(status.stderr || "Open Tailscale and sign in first.");
      const state = JSON.parse(status.stdout);
      if (state.BackendState !== "Running" || !state.Self?.DNSName)
        throw new Error(
          "Open Tailscale, sign in and enable MagicDNS before starting Funnel.",
        );
      const serving = await execute(executable, ["serve", "status", "--json"], {
        timeout: 15000,
        signal,
      });
      if (serving.code !== 0)
        throw new Error(
          serving.stderr ||
            "Cannot inspect existing Tailscale Serve configuration.",
        );
      const existing = JSON.parse(serving.stdout || "{}");
      const occupied = (value: {
        TCP?: Record<string, unknown>;
        Foreground?: Record<string, { TCP?: Record<string, unknown> }>;
      }) =>
        !!value.TCP?.["443"] ||
        Object.values(value.Foreground ?? {}).some(
          (config) => !!config.TCP?.["443"],
        );
      if (occupied(existing))
        throw new Error(
          "Tailscale port 443 already serves another application. Keep it running; use a dedicated Tailscale device or remove that route yourself before enabling ShowAI.",
        );
      origin = `https://${String(state.Self.DNSName).replace(/\.$/, "")}`;
    }
    if (this.http)
      await this.http.configure({
        ...this.serverOptions(c, origin),
        publicUrl: origin ?? this.http.localUrl,
      });
    else this.http = await this.openListener(c, origin);
    if (c.access !== "selected") {
      for (const client of this.http.authorization.connections())
        if (client.projectAccess !== "account")
          this.http.authorization.revoke(client.id);
    }
    const actualPort = Number(new URL(this.http.localUrl).port);
    if (c.provider === "cloudflare" && actualPort !== c.port) {
      this.config = { ...c, port: actualPort };
      this.phase = "prepared";
      this.error =
        "The local route changed. Copy the new address to your Cloudflare route, then connect again.";
      return;
    }
    signal.throwIfAborted();
    const tunnelToken =
      c.provider === "cloudflare"
        ? this.options.decrypt(this.encryptedToken!)
        : "";
    const args =
      c.provider === "tailscale"
        ? ["funnel", "--yes", String(actualPort)]
        : c.provider === "cloudflare"
          ? ["tunnel", "--no-autoupdate", "run"]
          : ["tunnel", "--no-autoupdate", "--url", this.http.localUrl];
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        TUNNEL_TOKEN: tunnelToken || undefined,
      },
    });
    this.child = child;
    let output = "";
    let resolveUrl: (url: string) => void;
    let rejectUrl: (reason: Error) => void;
    const urlReady = new Promise<string>((resolve, reject) => {
      resolveUrl = resolve;
      rejectUrl = reject;
    });
    // All modes observe failures; fixed hostnames do not wait for log wording.
    void urlReady.catch(() => undefined);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output = (
        output +
        (tunnelToken ? text.split(tunnelToken).join("[redacted]") : text)
      ).slice(-4000);
      this.diagnostics = output;
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) resolveUrl(match[0]);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (error) => rejectUrl(error));
    this.childClosed = new Promise((resolve) =>
      child.once("close", (code) => {
        rejectUrl(new Error(output || `Tunnel exited (${code}).`));
        if (!signal.aborted) {
          this.phase = "error";
          this.reachable = false;
          this.error = output || `Tunnel exited (${code}).`;
        }
        resolve();
      }),
    );
    if (c.provider === "cloudflare-quick") {
      origin = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                output ||
                  "Cloudflare did not return a temporary URL within 45 seconds.",
              ),
            ),
          45000,
        );
        const abort = () => reject(new Error("Connection stopped."));
        signal.addEventListener("abort", abort, { once: true });
        urlReady.then(resolve, reject).finally(() => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        });
      });
      signal.throwIfAborted();
      await this.http.configure({
        ...this.serverOptions(c, origin),
        publicUrl: origin,
      });
    }
    signal.throwIfAborted();
    if (child.exitCode !== null || !child.pid)
      throw new Error(output || "Tunnel failed to start.");
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      await this.check();
      if (this.reachable || child.exitCode !== null) break;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, 2000);
        signal.addEventListener("abort", done, { once: true });
      });
    }
    signal.throwIfAborted();
    if (child.exitCode !== null) throw new Error(output || "Tunnel exited.");
    this.phase = "running";
  }
  async check() {
    if (!this.http) throw new Error("Start the connection first.");
    const expected = this.instanceId;
    const current = this.http;
    try {
      const response = await fetch(current.url + "/health", {
        signal: AbortSignal.any([
          AbortSignal.timeout(15000),
          ...(this.abort ? [this.abort.signal] : []),
        ]),
        redirect: "error",
      });
      const health = await response.json();
      if (!response.ok || health.instanceId !== expected)
        throw new Error(
          "The public address does not reach this ShowAI instance. Check the tunnel route and local port.",
        );
      if (current === this.http) {
        this.reachable = true;
        this.error = undefined;
      }
    } catch (error) {
      if (current === this.http) {
        this.reachable = false;
        const reason = error as Error & {
          cause?: { code?: string; message?: string };
        };
        this.error = [reason.message, reason.cause?.code, reason.cause?.message]
          .filter(Boolean)
          .join(": ");
      }
    }
    this.checkedAt = new Date().toISOString();
    return this.status();
  }
  pair() {
    if (!this.http || this.phase !== "running")
      throw new Error("Start the connection first.");
    const code = randomBytes(18).toString("base64url");
    const expires = Date.now() + 10 * 60_000;
    this.pairing = {
      hash: createHash("sha256").update(code).digest(),
      expires,
    };
    return { code, expiresAt: new Date(expires).toISOString() };
  }
  async revoke(id: string) {
    this.http?.authorization.revoke(id);
    return this.status();
  }
  private async cleanup() {
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await this.childClosed;
      clearTimeout(timer);
    }
    const http = this.http;
    this.http = undefined;
    await http?.close();
    this.pairing = undefined;
  }
  stop() {
    return this.command(() => this.stopImpl());
  }
  private async stopImpl() {
    this.abort?.abort();
    await this.task;
    this.task = undefined;
    await this.cleanup();
    this.phase = "stopped";
    this.error = undefined;
    this.reachable = false;
    return this.status();
  }
}
