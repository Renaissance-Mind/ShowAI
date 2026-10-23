import { createHash, X509Certificate, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import { watch, type FSWatcher } from "chokidar";
import { readOptional, writeProtected } from "./storage";
import { translator } from "../i18n";
import lanMessages from "../i18n/messages/lanPairing";
import type { AgentHost } from "./host";
import type { ConnectorSettings } from "./remote-connector";
import { remoteTaskActions, remoteReadActions } from "./remote-protocol";
import { syncManager } from "../sync/manager";
import {
  FileStore,
  CoreError,
  assertId,
  validateProjectMetadata,
} from "../core/store";
import {
  mutateLibrary,
  workspaceRoot,
  writeLibraryFiles,
  versionedLibrary,
} from "../core/library-runtime";
import {
  validateDocument,
  serializeArtifact,
} from "../portable/validation.mjs";
import {
  resolveDocumentComponents,
  lockDocumentComponents,
  importCompiledComponents,
} from "../core/catalog";
import { canCommitPageMerge, mergePageContent } from "../core/page-merge-model";
import { mergeValues } from "../core/catalog-merge";
import { canonicalJson, documentHash } from "../core/diff";
import { changeContext } from "../core/history-context";
import type { ShowDocument } from "../types";

interface TrustedPeer {
  id: string;
  name: string;
  digest: string;
  projectIds: string[];
  pairedAt: string;
}
interface PairRequest {
  id: string;
  name: string;
  clientId: string;
  digest: string;
  code: string;
  expiresAt: number;
  state: "pending" | "approved" | "rejected";
  /** Why a rejected request ended: the Mac declined it or the iPad withdrew it. */
  reason?: "declined" | "cancelled";
}
const t = translator(lanMessages);
/** Pairing failures carry a code the iPad and the Mac localize. */
const pairingError = (
  code: "PAIRING_EXPIRED" | "PAIRING_QUEUE_FULL" | "PAIRING_RATE_LIMITED",
  message: string,
) => Object.assign(new Error(message), { code });
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const denied = (message: string) =>
  Object.assign(new Error(message), { code: "FORBIDDEN" });
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
/** Local TLS endpoint. Discovery is untrusted; the approval code binds both devices to the certificate and secret. */
export class LanPeerServer {
  private server?: Server;
  private sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  private clients = new Map<WebSocket, TrustedPeer>();
  private publisher?: ChildProcess;
  private watcher?: FSWatcher;
  private changes?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, PairRequest>();
  private trusted: TrustedPeer[] = [];
  private rates = new Map<string, { at: number; count: number }>();
  private requests = new Map<
    string,
    { fingerprint: string; task: Promise<unknown> }
  >();
  private syncWork = new Set<Promise<unknown>>();
  private syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closing?: Promise<void>;
  private starting?: Promise<void>;
  private generation = 0;
  private incoming = new Map<
    string,
    Promise<{ projectId: string; role: string; serverLinked: boolean }>
  >();
  private pin = "";
  private port = 0;
  error = "";
  constructor(
    readonly host: AgentHost,
    readonly home: () => string,
    readonly settings: () => ConnectorSettings | undefined,
  ) {}
  private get root() {
    return join(this.host.options.root, "lan-peer");
  }
  get status() {
    this.expire();
    return {
      online: !!this.server,
      port: this.port,
      fingerprint: this.pin,
      error: this.error,
      pending: [...this.pending.values()]
        .filter((p) => p.state === "pending")
        .map(({ id, name, code, expiresAt }) => ({
          id: `lan:${id}`,
          name,
          code,
          expiresAt,
        })),
      trusted: this.trusted.map(({ id, name, projectIds }) => ({
        id: `lan:${id}`,
        name,
        projectIds,
      })),
    };
  }
  private expire() {
    for (const [id, value] of this.pending)
      if (value.expiresAt < Date.now()) this.pending.delete(id);
  }
  async approve(id: string, approve: boolean) {
    this.expire();
    const request = this.pending.get(id),
      existing = this.trusted.find((p) => p.id === id);
    if (!request && !existing)
      throw pairingError("PAIRING_EXPIRED", t("error.expired"));
    const peerId = request?.clientId ?? id;
    this.trusted = this.trusted.filter((p) => p.id !== peerId);
    if (request) {
      request.state = approve ? "approved" : "rejected";
      if (!approve) request.reason = "declined";
      if (approve)
        this.trusted.push({
          id: peerId,
          name: request.name,
          digest: request.digest,
          projectIds: [...(this.settings()?.projectIds ?? [])],
          pairedAt: new Date().toISOString(),
        });
    }
    await writeProtected(join(this.root, "trusted.json"), this.trusted);
    for (const [socket, peer] of this.clients)
      if (peer.id === peerId) socket.close(4001, "Pairing changed");
  }
  async start() {
    const generation = this.generation;
    await this.closing;
    if (generation !== this.generation || this.server) return;
    const work = this.starting ?? this.open();
    this.starting = work;
    try {
      await work;
    } finally {
      if (this.starting === work) this.starting = undefined;
    }
  }
  private async open() {
    const settings = this.settings();
    if (!settings || !(settings.nearbyEnabled ?? settings.enabled)) return;
    const sharedHome = this.home();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const keyPath = join(this.root, "identity.key"),
      certPath = join(this.root, "identity.crt");
    if (!(await readOptionalFile(keyPath))) {
      await promisify(execFile)("/usr/bin/openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "3650",
        "-subj",
        `/CN=ShowAI-${settings.deviceId}`,
      ]);
      await chmod(keyPath, 0o600);
      await chmod(certPath, 0o600);
    }
    const [key, cert] = await Promise.all([
      readFile(keyPath),
      readFile(certPath),
    ]);
    this.pin = new X509Certificate(cert).fingerprint256
      .replaceAll(":", "")
      .toLowerCase();
    this.trusted =
      (await readOptional<TrustedPeer[]>(join(this.root, "trusted.json"))) ??
      [];
    const server = createServer(
      { key, cert, minVersion: "TLSv1.3" },
      (req, res) => {
        void this.route(req, res, sharedHome).catch((error) => {
          if (res.headersSent) {
            res.destroy();
            return;
          }
          res.writeHead(
            error.code === "UNAUTHORIZED"
              ? 401
              : error.code === "FORBIDDEN"
                ? 403
                : error.code === "CONFLICT"
                  ? 409
                  : error.code === "PAIRING_QUEUE_FULL" ||
                      error.code === "PAIRING_RATE_LIMITED"
                    ? 429
                    : 400,
            { "content-type": "application/json", "cache-control": "no-store" },
          );
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: error.code ?? "PEER_ERROR",
                message: error.message,
              },
            }),
          );
        });
      },
    );
    server.on("upgrade", (req, socket, head) => {
      const peer = this.authenticate(req);
      if (
        !peer ||
        req.url !== "/events" ||
        req.headers.origin ||
        this.home() !== sharedHome
      ) {
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(req, socket, head, (ws) => {
        this.clients.set(ws, peer);
        ws.on("close", () => this.clients.delete(ws));
        ws.send(JSON.stringify({ type: "ready" }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.server = server;
    this.port = (server.address() as { port: number }).port;
    this.watcher = watch(join(workspaceRoot(sharedHome), "projects"), {
      ignoreInitial: true,
      depth: 8,
    });
    this.watcher.on("all", () => {
      clearTimeout(this.changes);
      this.changes = setTimeout(() => {
        this.notify();
        void syncManager(sharedHome)
          .configuration()
          .then((config) => {
            for (const project of config.projects)
              if (
                project.connectionId === this.settings()?.connectionId &&
                this.settings()?.projectIds.includes(project.remoteProjectId)
              )
                this.queueSync(project.projectId);
          })
          .catch((error) => {
            this.error = error.message;
          });
      }, 100);
    });
    if (process.platform === "darwin") {
      this.publisher = spawn(
        "/usr/bin/dns-sd",
        [
          "-R",
          settings.name,
          "_showai-agent._tcp",
          "local.",
          String(this.port),
          `id=${settings.deviceId}`,
          `fp=${this.pin}`,
          "v=2",
        ],
        { stdio: "ignore" },
      );
      this.publisher.on("error", (error) => {
        this.error = error.message;
      });
    }
    server.on("error", (error) => {
      this.error = error.message;
    });
  }
  private notify() {
    for (const [socket, peer] of this.clients) {
      if (
        !this.trusted.some((t) => t.id === peer.id && t.digest === peer.digest)
      ) {
        socket.close(4001);
        continue;
      }
      if (socket.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: "changed",
            projectIds: peer.projectIds,
          }),
        );
    }
  }
  private authenticate(req: IncomingMessage) {
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const id = req.headers["x-showai-device"];
    if (!/^[a-f0-9]{64}$/.test(token) || typeof id !== "string")
      return undefined;
    const hashed = digest(token);
    return this.trusted.find((p) => p.id === id && equal(p.digest, hashed));
  }
  private async route(req: IncomingMessage, res: ServerResponse, home: string) {
    if (
      req.headers.origin ||
      this.home() !== home ||
      !(this.settings()?.nearbyEnabled ?? this.settings()?.enabled)
    )
      throw denied("Local access is unavailable.");
    const reply = (value: unknown) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (req.method === "GET" && req.url === "/info")
      return reply({
        id: this.settings()!.deviceId,
        name: this.settings()!.name,
        fingerprint: this.pin,
        version: 2,
      });
    if (req.method !== "POST") throw new Error("Use POST.");
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) throw new Error("Request exceeds 32 MiB.");
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === "/pair") {
      this.expire();
      if (
        !uuid(body.id) ||
        !uuid(body.clientId) ||
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100 ||
        !/^[a-f0-9]{64}$/.test(body.secret)
      )
        throw new Error("Invalid pairing request.");
      let pending = this.pending.get(body.id);
      if (pending) {
        if (
          pending.clientId !== body.clientId ||
          !equal(pending.digest, digest(body.secret))
        )
          throw denied(t("error.identityChanged"));
      } else {
        const ip = req.socket.remoteAddress ?? "",
          rate = this.rates.get(ip);
        if (rate && Date.now() - rate.at < 60000 && rate.count >= 5)
          throw pairingError("PAIRING_RATE_LIMITED", t("error.rateLimited"));
        this.rates.set(ip, {
          at: rate && Date.now() - rate.at < 60000 ? rate.at : Date.now(),
          count: rate && Date.now() - rate.at < 60000 ? rate.count + 1 : 1,
        });
        if (this.pending.size >= 20)
          throw pairingError("PAIRING_QUEUE_FULL", t("error.queueFull"));
        const code = (
          parseInt(
            digest(`${this.pin}:${body.clientId}:${body.secret}`).slice(0, 12),
            16,
          ) % 1000000
        )
          .toString()
          .padStart(6, "0");
        pending = {
          id: body.id,
          clientId: body.clientId,
          name: body.name,
          digest: digest(body.secret),
          code,
          expiresAt: Date.now() + 120000,
          state: "pending",
        };
        this.pending.set(body.id, pending);
      }
      if (body.cancel === true && pending.state === "pending") {
        pending.state = "rejected";
        pending.reason = "cancelled";
      }
      return reply({
        state: pending.state,
        ...(pending.reason ? { reason: pending.reason } : {}),
        code: pending.code,
        expiresAt: pending.expiresAt,
        id: this.settings()!.deviceId,
        projectIds:
          pending.state === "approved"
            ? this.trusted.find((p) => p.id === body.clientId)?.projectIds
            : [],
      });
    }
    const peer = this.authenticate(req);
    if (!peer)
      throw Object.assign(new Error(t("error.pairAgain")), {
        code: "UNAUTHORIZED",
      });
    if (
      req.url !== "/rpc" ||
      !uuid(body.requestId) ||
      typeof body.action !== "string"
    )
      throw new Error("Invalid local request.");
    if (body.action === "agent:status" && !body.projectId) {
      const status = await this.host.status();
      return reply({
        ok: true,
        data: { ...status, workspaceRoot: "", credentialRoot: "", tasks: [] },
      });
    }
    if (!uuid(body.projectId)) throw new Error("Invalid project identity.");
    let mapping = await this.projectMapping(home, peer, body.projectId);
    if (body.action === "replica:attach") {
      if (!mapping)
        mapping = await this.receiveProject(
          home,
          peer,
          body.projectId,
          body.args?.metadata,
        );
      return reply({
        ok: true,
        data: {
          projectId: body.projectId,
          serverLinked: mapping.serverLinked,
          metadata: {
            ...(await new FileStore(home).readProject(mapping.projectId)),
            id: body.projectId,
          },
        },
      });
    }
    if (!mapping)
      throw denied("Connect this project to the Mac before running a task.");
    const read =
      remoteReadActions.has(body.action) ||
      ["replica:index", "replica:page"].includes(body.action);
    if (!read && mapping.role === "viewer")
      throw denied("This project is read only.");
    const fingerprint = digest(
      canonicalJson([peer.id, body.projectId, body.action, body.args]),
    );
    const receiptPath = join(this.root, "receipts", body.requestId + ".json");
    const run = async () => {
      const receipt = read
        ? undefined
        : await readOptional<{
            fingerprint: string;
            completed?: boolean;
            value?: unknown;
          }>(receiptPath);
      if (receipt && receipt.fingerprint !== fingerprint)
        throw new Error("Request identity was reused.");
      if (receipt?.completed) {
        if (body.action === "replica:savePage")
          return remapProjects(
            await this.invoke(
              home,
              mapping.projectId,
              "replica:page",
              { pageId: (body.args.document as ShowDocument).id },
              body.requestId,
            ),
            mapping.projectId,
            body.projectId,
          );
        if (body.action === "replica:metadata")
          return {
            ...(await new FileStore(home).readProject(mapping.projectId)),
            id: body.projectId,
          };
        return receipt.value;
      }
      if (receipt && body.action === "agent:send") {
        const list = await this.host.conversations.list(mapping.projectId);
        for (const item of list) {
          const c = await this.host.conversations.get(
            mapping.projectId,
            item.id,
          );
          if (c.turns.some((t) => t.id === body.requestId)) return c;
        }
        throw new Error(
          "The Mac restarted during admission. Review conversations before sending again.",
        );
      }
      if (!read) await writeProtected(receiptPath, { fingerprint });
      let value = await this.invoke(
        home,
        mapping.projectId,
        body.action,
        body.args ?? {},
        body.requestId,
      );
      value = remapProjects(value, mapping.projectId, body.projectId);
      if (body.action === "replica:index")
        (value as any).metadata.id = body.projectId;
      if (body.action === "replica:metadata")
        (value as any).id = body.projectId;
      if (!read) {
        await writeProtected(receiptPath, {
          fingerprint,
          completed: true,
          ...(body.action.startsWith("replica:") ? {} : { value }),
        });
        if (mapping.serverLinked) this.queueSync(mapping.projectId);
        this.notify();
      }
      return value;
    };
    const inflight = this.requests.get(body.requestId);
    // Serialize only a retry of the same request. FileStore's transactional CAS handles independent writers.
    if (inflight && inflight.fingerprint !== fingerprint)
      throw new Error("Request identity was reused.");
    const task = inflight?.task ?? run();
    this.requests.set(body.requestId, { fingerprint, task });
    try {
      return reply({ ok: true, data: await task });
    } finally {
      if (this.requests.get(body.requestId)?.task === task)
        this.requests.delete(body.requestId);
    }
  }
  private incomingPath(home: string, peerId: string, projectId: string) {
    return join(
      this.root,
      "incoming",
      digest(home),
      peerId,
      projectId + ".json",
    );
  }
  private async projectMapping(
    home: string,
    peer: TrustedPeer,
    wireId: string,
  ) {
    const incoming = await readOptional<{
      projectId: string;
      clientId: string;
      wireId: string;
    }>(this.incomingPath(home, peer.id, wireId));
    if (incoming?.clientId === peer.id && incoming.wireId === wireId) {
      await new FileStore(home).readProject(incoming.projectId);
      return {
        projectId: incoming.projectId,
        role: "admin",
        serverLinked: false,
      };
    }
    const config = await syncManager(home).configuration();
    if (
      !config.connections.some(
        (c) => c.id === this.settings()?.connectionId && !c.signedOut,
      )
    )
      return;
    const existing = config.projects.find(
      (p) =>
        p.connectionId === this.settings()?.connectionId &&
        p.remoteProjectId === wireId &&
        this.settings()?.projectIds.includes(wireId) &&
        peer.projectIds.includes(wireId) &&
        p.status !== "revoked",
    );
    if (existing)
      return {
        projectId: existing.projectId,
        role: existing.role,
        serverLinked: true,
      };
  }
  private async receiveProject(
    home: string,
    peer: TrustedPeer,
    wireId: string,
    input: unknown,
  ) {
    const metadata = validateProjectMetadata(input, wireId),
      key = `${peer.id}/${wireId}`;
    const prior = this.incoming.get(key);
    if (prior) return prior;
    // A device may supply its own project. It never names an existing Mac
    // workspace or gains access to other projects on this computer.
    const work = (async () => {
      const existing = await this.projectMapping(home, peer, wireId);
      if (existing) return existing;
      const project = await new FileStore(home).createProject({
        name: metadata.name,
        icon: metadata.icon,
        binding: { harness: "showai-ipad", sessionId: key },
      });
      await writeProtected(this.incomingPath(home, peer.id, wireId), {
        projectId: project.id,
        clientId: peer.id,
        wireId,
      });
      return { projectId: project.id, role: "admin", serverLinked: false };
    })();
    this.incoming.set(key, work);
    try {
      return await work;
    } finally {
      if (this.incoming.get(key) === work) this.incoming.delete(key);
    }
  }
  private queueSync(projectId: string) {
    if (!this.server || this.closing) return;
    clearTimeout(this.syncTimers.get(projectId));
    this.syncTimers.set(
      projectId,
      setTimeout(() => {
        this.syncTimers.delete(projectId);
        const work = syncManager(this.home())
          .run(projectId)
          .catch((error) => {
            this.error = `Saved on Mac; server sync: ${error.message}`;
          });
        this.syncWork.add(work);
        void work.finally(() => this.syncWork.delete(work));
      }, 700),
    );
  }
  private async invoke(
    home: string,
    projectId: string,
    action: string,
    args: Record<string, unknown>,
    requestId: string,
  ): Promise<unknown> {
    const store = new FileStore(home);
    if (action === "replica:flush") {
      const state = (await syncManager(home).run(projectId)).projects.find(
        (p) => p.projectId === projectId,
      );
      if (state?.status !== "synced")
        throw new Error(
          state?.error ?? "Mac changes have not reached the server.",
        );
      return { synced: true };
    }
    if (action === "replica:index")
      return {
        metadata: await store.readProject(projectId),
        pages: await store.listPages(projectId, { includeArchived: true }),
      };
    if (action === "replica:page") {
      const page = await store.readPage(
        projectId,
        assertId(String(args.pageId)),
      );
      if (args.hash === page.hash && args.revision === page.revision)
        return { unchanged: true };
      return {
        ...page,
        components: await resolveDocumentComponents(
          home,
          page.document,
          projectId,
        ),
      };
    }
    if (action === "replica:savePage") {
      if (Array.isArray(args.components) && args.components.length)
        await importCompiledComponents(
          home,
          args.components as any[],
          projectId,
        );
      const local = validateDocument(args.document),
        pageId = assertId(local.id);
      return mutateLibrary(
        home,
        async () => {
          const existing = (
            await store.listPages(projectId, { includeArchived: true })
          ).some((p) => p.id === pageId);
          let document: ShowDocument = local;
          if (existing) {
            const current = await store.readPage(projectId, pageId);
            if (documentHash(local) === current.hash) return current;
            if (!args.base)
              throw new CoreError(
                "CONFLICT",
                "This page already exists on the Mac. Its local draft is retained.",
              );
            const merged = mergePageContent(
              validateDocument(args.base),
              local,
              current.document,
            );
            if (!canCommitPageMerge(merged))
              throw new CoreError(
                "CONFLICT",
                "Both devices edited the same content. Keep the iPad draft and resolve it before syncing.",
              );
            document = merged.document;
            const saved = await store.savePage(
              projectId,
              pageId,
              document,
              current.hash,
              current.revision,
            );
            return {
              ...saved,
              components: await resolveDocumentComponents(
                home,
                saved.document,
                projectId,
              ),
            };
          }
          document = await lockDocumentComponents(home, document, projectId);
          const path = `projects/${projectId}/pages/${pageId}.json`;
          await writeLibraryFiles(
            home,
            new Map([[path, Buffer.from(serializeArtifact(document))]]),
            new Map([[path, null]]),
          );
          return {
            document,
            hash: documentHash(document),
            components: await resolveDocumentComponents(
              home,
              document,
              projectId,
            ),
          };
        },
        {
          ...changeContext(),
          message: "Edit from paired iPad",
          operationId: requestId,
        },
      );
    }
    if (action === "replica:metadata")
      return mutateLibrary(
        home,
        async () => {
          const current = await store.readProject(projectId);
          const local = {
            ...(args.metadata as object),
            id: projectId,
          } as Record<string, unknown>;
          const base = args.base
            ? { ...(args.base as object), id: projectId }
            : current;
          if (!args.base)
            throw new CoreError(
              "CONFLICT",
              "A project baseline is required before replacing organization.",
            );
          const withoutTime = (value: unknown) => {
            const next = { ...(value as object) } as Record<string, unknown>;
            delete next.updatedAt;
            return next;
          };
          for (const key of [
            "sourceDirectory",
            "binding",
            "bindings",
          ] as const) {
            if (current[key] === undefined) {
              delete local[key];
              delete (base as any)[key];
            } else {
              local[key] = current[key];
              (base as any)[key] = current[key];
            }
          }
          const merged = mergeValues(
            withoutTime(base),
            withoutTime(local),
            withoutTime(current),
          );
          (merged.value as any).updatedAt = new Date().toISOString();
          if (merged.conflicts.length)
            throw new CoreError(
              "CONFLICT",
              "Project organization changed on both devices. Local changes are retained.",
            );
          for (const key of [
            "sourceDirectory",
            "binding",
            "bindings",
          ] as const) {
            if (current[key] === undefined) delete (merged.value as any)[key];
            else (merged.value as any)[key] = current[key];
          }
          const value = validateProjectMetadata(merged.value, projectId),
            path = `projects/${projectId}/project.json`;
          const revision = await versionedLibrary(home)!.resourceRevision(path);
          await writeLibraryFiles(
            home,
            new Map([[path, Buffer.from(JSON.stringify(value))]]),
            new Map([[path, revision]]),
          );
          return value;
        },
        {
          ...changeContext(),
          message: "Organize from paired iPad",
          operationId: requestId,
        },
      );
    if (!remoteTaskActions.has(action))
      throw denied("This action is unavailable over the local connection.");
    if (
      ["agent:cancel", "agent:readFile", "agent:permission"].includes(action)
    ) {
      const list = await this.host.conversations.list(projectId);
      const turns = (
        await Promise.all(
          list.map((c) => this.host.conversations.get(projectId, c.id)),
        )
      ).flatMap((c) => c.turns);
      if (
        !turns.some((t) =>
          action === "agent:permission"
            ? t.approvals?.some((p) => p.id === args.id)
            : t.id === args.id,
        )
      )
        throw denied("This task belongs to another project.");
    }
    if (action === "agent:status") {
      const status = await this.host.status();
      return {
        ...status,
        workspaceRoot: "",
        credentialRoot: "",
        tasks: status.tasks.filter((t) => t.projectId === projectId),
      };
    }
    if (action === "agent:send") {
      const target = args.target as { pageId?: string } | undefined;
      if (
        args.expectedHash &&
        target?.pageId &&
        (await store.readPage(projectId, target.pageId)).hash !==
          args.expectedHash
      )
        throw new CoreError(
          "CONFLICT",
          "The page changed before Agent execution. Review the latest version.",
        );
      return this.host.send({ ...args, projectId }, { turnId: requestId });
    }
    return this.host.action(action, { ...args, projectId });
  }
  async close() {
    this.generation++;
    if (this.closing) return this.closing;
    const task = (async () => {
      await this.starting?.catch((error) => {
        this.error = error.message;
      });
      this.publisher?.kill();
      this.publisher = undefined;
      await this.watcher?.close();
      this.watcher = undefined;
      clearTimeout(this.changes);
      for (const timer of this.syncTimers.values()) clearTimeout(timer);
      this.syncTimers.clear();
      await Promise.allSettled([...this.syncWork]);
      for (const socket of this.clients.keys())
        socket.close(1001, "Local sharing stopped");
      this.clients.clear();
      const server = this.server;
      this.server = undefined;
      this.port = 0;
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    })();
    this.closing = task;
    try {
      await task;
    } finally {
      if (this.closing === task) this.closing = undefined;
    }
  }
}
async function readOptionalFile(path: string) {
  return readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

function remapProjects(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value))
    return value.map((item) => remapProjects(item, from, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "projectId" && item === from
          ? to
          : remapProjects(item, from, to),
      ]),
    );
  return value;
}
