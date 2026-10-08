import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { Buffer } from "node:buffer";
import { atomicLibraryFile } from "../core/library-files";
import { withLibraryLock } from "../core/library-lock";
import { GitLibrary } from "../core/git-library";
import { FileStore, CoreError, assertId } from "../core/store";
import { LibraryOperations } from "../core/library-operations";
import { WorkspaceProtection } from "../core/workspace-conflicts";
import { serverBaseUrl, serverEndpoint, invitationBaseUrl } from "./server-url";
import { cacheDownload } from "./object-cache";
import {
  retainSyncConflicts,
  type RetainedConflict,
} from "./conflict-retention";
import {
  captureProject,
  decodeSnapshot,
  importProjectHistory,
  mergeProjectFiles,
  projectHistory,
  remapProjectFiles,
  validSnapshotRecord,
  sameFiles,
  type FileConflict,
  type CapturedSnapshot,
} from "./transfer";
import {
  SyncError,
  syncProtocol,
  identifier,
  validateSnapshot,
  portablePathKey,
  type ProjectConnection,
  type ServerConnection,
  type SnapshotRecord,
  type SyncConfiguration,
  type SyncProject,
  type ProjectRole,
} from "./protocol";

export interface SyncConflict {
  projectId: string;
  remoteHead: string;
  localHead: string | null;
  files: FileConflict[];
  baseRevision: string | null;
  createdAt: string;
  recovery?: boolean;
}
interface PendingImport {
  serverId: string;
  remoteHead: string;
  originalHead: string | null;
  appliedHead?: string | null;
  localBranch: string | null;
  localHistoryRevision?: string | null;
  files: Record<string, string>;
  needsPublish: boolean;
}
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const instances = new Map<string, SyncManager>();
export function syncManager(home: string) {
  const root = resolve(home);
  let manager = instances.get(root);
  if (!manager) {
    manager = new SyncManager(root);
    instances.set(root, manager);
  }
  return manager;
}
async function readJson<T>(path: string): Promise<T | undefined> {
  return readFile(path, "utf8").then(
    (value) => JSON.parse(value) as T,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
}
export class SyncManager {
  private running: Promise<unknown> | undefined;
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly home: string) {}
  private get root() {
    return join(this.home, "local", "sync");
  }
  private get configPath() {
    return join(this.root, "config.json");
  }
  async configuration(): Promise<SyncConfiguration> {
    const saved = await readJson<SyncConfiguration>(this.configPath);
    if (saved) {
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.connections) ||
        !Array.isArray(saved.projects)
      )
        throw new CoreError("INVALID_DATA", "同步配置格式无效。");
      return saved;
    }
    return {
      version: 1,
      deviceId: crypto.randomUUID(),
      connections: [],
      projects: [],
      defaultConnectionId: null,
    };
  }
  private async update(action: (config: SyncConfiguration) => void) {
    return withLibraryLock(
      this.home,
      async () => {
        const config = await this.configuration();
        action(config);
        await atomicLibraryFile(
          this.home,
          this.configPath,
          Buffer.from(JSON.stringify(config, null, 2)),
        );
        return config;
      },
      "sync-settings",
    );
  }
  private cacheKey(connection: ServerConnection, project: ProjectConnection) {
    return hash(
      JSON.stringify([
        identifier(connection.serverId),
        identifier(project.remoteProjectId),
      ]),
    );
  }
  private snapshotPath(
    connection: ServerConnection,
    project: ProjectConnection,
    revision: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(revision))
      throw new CoreError("INVALID_DATA", "Invalid project snapshot revision.");
    return join(
      this.root,
      "snapshots",
      this.cacheKey(connection, project),
      `${revision}.json`,
    );
  }
  private objectPath(digest: string, namespace?: string) {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new CoreError("INVALID_DATA", "Invalid object digest.");
    // Legacy unscoped bytes remain readable only by local recovery plans.
    // Network snapshots cannot reuse objects learned from another project/server.
    return namespace
      ? join(this.root, "objects", namespace, digest)
      : join(this.root, "objects", digest);
  }
  private async request<T>(
    connection: Pick<ServerConnection, "url" | "token">,
    path: string,
    method = "GET",
    data?: unknown,
  ): Promise<T> {
    const response = await fetch(serverEndpoint(connection.url, path), {
      method,
      headers: {
        ...(connection.token
          ? { authorization: `Bearer ${connection.token}` }
          : {}),
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json();
    if (!response.ok)
      throw new SyncError(
        response.status,
        value.error?.code ?? "SERVER_ERROR",
        value.error?.message ?? `服务器返回 ${response.status}`,
        value.error?.details,
      );
    return value as T;
  }
  async status() {
    const config = await this.configuration();
    return {
      ...config,
      connections: config.connections.map(
        ({ token: _token, ...connection }) => connection,
      ),
      running: !!this.running,
    };
  }
  async connect(input: {
    url: string;
    name?: string;
    account?: string;
    password?: string;
    registrationKey?: string;
    token?: string;
    register?: boolean;
    invite?: string;
  }) {
    const url = serverBaseUrl(input.url),
      config = await this.configuration();
    const info = await this.request<{
      protocol: string;
      serverId: string;
      name: string;
      capabilities?: string[];
    }>({ url, token: "" }, "/api/info");
    if (info.protocol !== syncProtocol)
      throw new CoreError("INVALID_DATA", "该地址不是兼容的 ShowAI Server。");
    identifier(info.serverId);
    if (
      info.capabilities !== undefined &&
      (!Array.isArray(info.capabilities) ||
        info.capabilities.length > 50 ||
        info.capabilities.some((item) => typeof item !== "string"))
    )
      throw new CoreError("INVALID_DATA", "服务器能力说明无效。");
    const result = input.token
      ? {
          ...(await this.request<{
            user: ServerConnection["user"];
            serverId: string;
          }>({ url, token: input.token }, "/api/me")),
          token: input.token,
        }
      : await this.request<{
          user: ServerConnection["user"];
          serverId: string;
          token: string;
        }>(
          { url, token: "" },
          input.register ? "/api/auth/register" : "/api/auth/login",
          "POST",
          {
            name: input.account,
            password: input.password,
            registrationKey: input.registrationKey,
            invite: input.invite,
            device: `ShowAI · ${hostname().slice(0, 180)}`,
          },
        );
    if (result.serverId !== info.serverId)
      throw new CoreError("CONFLICT", "服务器身份发生变化，请重新连接。");
    const existing = config.connections.find(
      (connection) =>
        connection.serverId === info.serverId &&
        connection.user.id === result.user.id,
    );
    const connection: ServerConnection = {
      id: existing?.id ?? crypto.randomUUID(),
      serverId: info.serverId,
      name: input.name?.trim() || info.name,
      url,
      user: result.user,
      token: result.token,
      capabilities: info.capabilities,
    };
    await this.update((next) => {
      next.deviceId = config.deviceId;
      next.connections = next.connections.filter(
        (item) => item.id !== connection.id,
      );
      next.connections.push(connection);
    });
    this.start();
    return { ...connection, token: undefined };
  }
  async setDefault(connectionId: string | null) {
    await this.update((config) => {
      if (
        connectionId &&
        !config.connections.some((connection) => connection.id === connectionId)
      )
        throw new CoreError("NOT_FOUND", "服务器连接不存在。");
      config.defaultConnectionId = connectionId;
      config.defaultSince = new Date().toISOString();
    });
    return this.status();
  }
  async disconnect(connectionId: string) {
    await this.update((config) => {
      if (
        config.projects.some((project) => project.connectionId === connectionId)
      )
        throw new CoreError(
          "CONFLICT",
          "请先解除该连接下的项目同步；本地项目内容会保留。",
        );
      config.connections = config.connections.filter(
        (connection) => connection.id !== connectionId,
      );
      if (config.defaultConnectionId === connectionId)
        config.defaultConnectionId = null;
    });
    return this.status();
  }
  private async connection(id: string) {
    const connection = (await this.configuration()).connections.find(
      (item) => item.id === id,
    );
    if (!connection) throw new CoreError("NOT_FOUND", "服务器账号连接不存在。");
    return connection;
  }
  async remoteProjects(connectionId: string) {
    await this.refreshCapabilities(connectionId);
    return this.request<SyncProject[]>(
      await this.connection(connectionId),
      "/api/projects",
    );
  }
  async dashboard(connectionId: string, projectId?: string) {
    const connection = await this.connection(connectionId),
      projects = await this.remoteProjects(connectionId);
    if (!projectId)
      return {
        projects,
        managed: projects.filter((project) => project.role === "admin"),
      };
    const selected = projects.find((project) => project.id === projectId);
    if (!selected)
      throw new CoreError("NOT_FOUND", "项目不存在或当前账号没有访问权限。");
    const members = await this.request(
      connection,
      `/api/projects/${identifier(projectId)}/members`,
    );
    const invites =
      selected.role === "admin"
        ? await this.request(
            connection,
            `/api/projects/${identifier(projectId)}/invites`,
          )
        : [];
    return { project: selected, members, invites };
  }
  async manage(
    connectionId: string,
    projectId: string,
    action: "invite" | "member" | "revokeInvite" | "project",
    input: Record<string, unknown>,
  ) {
    const endpoints = {
      invite: ["invites", "POST"],
      member: ["members", "PATCH"],
      revokeInvite: ["invites/revoke", "POST"],
      project: ["", "PATCH"],
    } as const;
    const [path, method] = endpoints[action];
    if (!path && action !== "project")
      throw new CoreError(
        "INVALID_DATA",
        "Unknown project management operation.",
      );
    return this.request(
      await this.connection(connectionId),
      `/api/projects/${identifier(projectId)}${path ? `/${path}` : ""}`,
      method,
      input,
    );
  }
  async sessions(connectionId: string) {
    await this.refreshCapabilities(connectionId);
    return this.request(await this.connection(connectionId), "/api/sessions");
  }
  private async refreshCapabilities(connectionId: string) {
    const connection = await this.connection(connectionId);
    const info = await this.request<{
      serverId: string;
      capabilities?: string[];
    }>(connection, "/api/info");
    if (
      info.serverId !== connection.serverId ||
      (info.capabilities !== undefined &&
        (!Array.isArray(info.capabilities) ||
          info.capabilities.length > 50 ||
          info.capabilities.some((item) => typeof item !== "string")))
    )
      throw new CoreError("INVALID_DATA", "服务器身份或能力说明无效。");
    if (
      JSON.stringify(connection.capabilities) !==
      JSON.stringify(info.capabilities)
    )
      await this.update((config) => {
        const saved = config.connections.find(
          (item) => item.id === connectionId,
        );
        if (saved) saved.capabilities = info.capabilities;
      });
  }
  async revokeToken(connectionId: string, digest: string) {
    return this.request(
      await this.connection(connectionId),
      "/api/sessions/revoke",
      "POST",
      { digest },
    );
  }
  async revokeAllTokens(connectionId: string) {
    return this.request(
      await this.connection(connectionId),
      "/api/sessions/revoke-all",
      "POST",
    );
  }
  async changePassword(
    connectionId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const connection = await this.connection(connectionId);
    const result = await this.request<{
      token: string;
      serverId: string;
      user: ServerConnection["user"];
    }>(connection, "/api/auth/password", "POST", {
      currentPassword,
      newPassword,
    });
    if (
      result.serverId !== connection.serverId ||
      result.user.id !== connection.user.id
    )
      throw new CoreError(
        "INVALID_DATA",
        "修改密码后的服务器或账号身份不匹配。",
      );
    await this.update((config) => {
      const saved = config.connections.find((item) => item.id === connectionId);
      if (!saved) throw new CoreError("NOT_FOUND", "服务器账号连接不存在。");
      saved.token = result.token;
    });
    return { ok: true };
  }
  async previewInvite(link: string, connectionId?: string) {
    const url = new URL(link),
      parameters = new URLSearchParams(url.hash.slice(1)),
      invite = parameters.get("invite");
    if (!invite || !/^[a-f0-9]{64}$/.test(invite))
      throw new CoreError("INVALID_DATA", "邀请链接无效。");
    const connection = connectionId
      ? await this.connection(connectionId)
      : (await this.configuration()).connections.find(
          (item) => item.serverId === parameters.get("server"),
        );
    const base = connection?.url ?? invitationBaseUrl(link);
    const result = {
      url: base,
      invite,
      ...(await this.request<{
        project_id: string;
        role: ProjectRole;
        name: string;
        serverId: string;
        serverName: string;
      }>(
        { url: base, token: connection?.token ?? "" },
        "/api/invites/preview",
        "POST",
        { invite },
      )),
    };
    if (
      (connection && result.serverId !== connection.serverId) ||
      (parameters.has("server") && parameters.get("server") !== result.serverId)
    )
      throw new CoreError("INVALID_DATA", "请选择邀请所属服务器上的账号。");
    return result;
  }
  async join(connectionId: string, link: string) {
    const invitation = await this.previewInvite(link, connectionId),
      connection = await this.connection(connectionId);
    if (invitation.serverId !== connection.serverId)
      throw new CoreError("INVALID_DATA", "请选择邀请所属服务器上的账号。");
    const project = await this.request<SyncProject>(
      connection,
      "/api/invites/accept",
      "POST",
      { invite: invitation.invite },
    );
    await this.subscribe(connectionId, project.id);
    return this.status();
  }
  async attach(connectionId: string, projectId: string) {
    assertId(projectId);
    const metadata = await new FileStore(this.home).readProject(projectId);
    const config = await this.configuration();
    if (config.projects.some((item) => item.projectId === projectId))
      throw new CoreError(
        "CONFLICT",
        "该项目已经连接到服务器，请先解除原连接。",
      );
    const connection = await this.connection(connectionId);
    const remote = await this.request<SyncProject>(
      connection,
      "/api/projects",
      "POST",
      { id: projectId, name: metadata.name },
    );
    if (remote.head)
      throw new CoreError(
        "CONFLICT",
        "服务器已有同 ID 的内容，请通过加入远程项目连接，避免覆盖。",
      );
    await this.update((next) => {
      next.projects.push({
        projectId,
        remoteProjectId: remote.id,
        connectionId,
        role: remote.role,
        remoteHead: null,
        localRevision: null,
        status: "pending",
      });
    });
    this.start();
    await this.run(projectId);
    return this.status();
  }
  async subscribe(connectionId: string, remoteProjectId: string) {
    identifier(remoteProjectId);
    const connection = await this.connection(connectionId),
      config = await this.configuration();
    const existing = config.projects.find(
      (project) =>
        project.connectionId === connectionId &&
        project.remoteProjectId === remoteProjectId,
    );
    if (existing) {
      await this.run(existing.projectId);
      return this.status();
    }
    const remote = await this.request<SyncProject>(
      connection,
      `/api/projects/${remoteProjectId}`,
    );
    const current = await new FileStore(this.home).listProjects({
      includeArchived: true,
    });
    const sameServer = config.projects.find(
      (project) =>
        project.remoteProjectId === remoteProjectId &&
        config.connections.find((item) => item.id === project.connectionId)
          ?.serverId === connection.serverId,
    );
    if (sameServer) {
      await this.changeAccount(sameServer.projectId, connectionId);
      return this.status();
    }
    const projectId =
      config.projects.some(
        (project) => project.projectId === remoteProjectId,
      ) ||
      current.some(
        (project) =>
          portablePathKey(project.id) === portablePathKey(remoteProjectId),
      )
        ? crypto.randomUUID()
        : remoteProjectId;
    await this.update((next) => {
      next.projects.push({
        projectId,
        remoteProjectId,
        connectionId,
        role: remote.role,
        remoteHead: null,
        localRevision: null,
        status: "pending",
      });
    });
    this.start();
    await this.run(projectId);
    return this.status();
  }
  async detach(projectId: string) {
    if (this.running) await this.running;
    if (await readJson(this.pendingPath(projectId)))
      throw new CoreError(
        "CONFLICT",
        "项目有待恢复或上传的合并草稿，请先完成同步或处理冲突，再解除连接。",
      );
    await this.update((config) => {
      config.projects = config.projects.filter(
        (project) => project.projectId !== projectId,
      );
    });
    return this.status();
  }
  async changeAccount(projectId: string, connectionId: string) {
    if (this.running) await this.running;
    const config = await this.configuration(),
      project = config.projects.find((item) => item.projectId === projectId);
    if (!project) throw new CoreError("NOT_FOUND", "项目同步连接不存在。");
    const previous = await this.connection(project.connectionId),
      connection = await this.connection(connectionId);
    if (previous.serverId !== connection.serverId)
      throw new CoreError(
        "INVALID_DATA",
        "切换账号需要选择同一服务器；更换存储服务器请先解除同步。",
      );
    const remote = await this.request<SyncProject>(
      connection,
      `/api/projects/${project.remoteProjectId}`,
    );
    await this.state(projectId, {
      connectionId,
      role: remote.role,
      status: "pending",
      error: undefined,
    });
    await this.run(projectId);
    return this.status();
  }
  private async state(projectId: string, patch: Partial<ProjectConnection>) {
    await this.update((config) => {
      const project = config.projects.find(
        (item) => item.projectId === projectId,
      );
      if (project) Object.assign(project, patch);
    });
  }
  private async cacheRecord(
    connection: ServerConnection,
    project: ProjectConnection,
    record: SnapshotRecord,
  ) {
    validateSnapshot(record.snapshot, project.remoteProjectId);
    if (!(await validSnapshotRecord(record)))
      throw new CoreError("INVALID_DATA", "服务器快照身份或摘要不匹配。");
    await atomicLibraryFile(
      this.home,
      this.snapshotPath(connection, project, record.revision),
      Buffer.from(JSON.stringify(record)),
    );
  }
  private async record(
    connection: ServerConnection,
    project: ProjectConnection,
    revision: string,
  ) {
    const path = this.snapshotPath(connection, project, revision),
      cached = await readJson<SnapshotRecord>(path);
    if (cached) validateSnapshot(cached.snapshot, project.remoteProjectId);
    if (
      cached &&
      cached.revision === revision &&
      (await validSnapshotRecord(cached))
    )
      return cached;
    const record = await this.request<SnapshotRecord>(
      connection,
      `/api/projects/${project.remoteProjectId}/revisions/${revision}`,
    );
    if (record.revision !== revision)
      throw new CoreError("INVALID_DATA", "服务器返回了错误的快照版本。");
    await this.cacheRecord(connection, project, record);
    return record;
  }
  private async files(
    connection: ServerConnection,
    project: ProjectConnection,
    record: SnapshotRecord,
  ) {
    const files = await decodeSnapshot(
      record,
      async (digest) => {
        const path = this.objectPath(
          digest,
          this.cacheKey(connection, project),
        );
        const cached = await readFile(path).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        );
        if (cached) {
          if (hash(cached) !== digest)
            throw new CoreError(
              "INVALID_DATA",
              "本地同步缓存损坏，原始内容仍保留。",
            );
          return cached;
        }
        const response = await fetch(
          `${connection.url}/api/projects/${project.remoteProjectId}/objects/${digest}`,
          {
            headers: { authorization: `Bearer ${connection.token}` },
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) {
          const error = await response.json();
          throw new SyncError(
            response.status,
            error.error?.code ?? "MISSING_OBJECT",
            error.error?.message ?? "下载资源失败。",
          );
        }
        await cacheDownload(this.home, path, response, digest);
        return readFile(path);
      },
      project.remoteProjectId,
    );
    return remapProjectFiles(files, project.remoteProjectId, project.projectId);
  }
  private async upload(
    connection: ServerConnection,
    project: ProjectConnection,
    captured: CapturedSnapshot,
    expected: string | null,
    publish = true,
  ) {
    if (publish)
      await withLibraryLock(this.home, async () => {
        const paths = new Set(
          Object.keys(captured.snapshot.files).map((path) =>
            path.replace(
              `projects/${project.remoteProjectId}/`,
              `projects/${project.projectId}/`,
            ),
          ),
        );
        const unresolved = (
          await new WorkspaceProtection(new GitLibrary(this.home)).list()
        ).find(
          (item) =>
            item.state === "unresolved" &&
            (paths.has(item.path) ||
              item.path.startsWith(`projects/${project.projectId}/`)),
        );
        if (unresolved)
          throw new CoreError(
            "CONFLICT",
            "本机保存失败，未解决的文件修改不会发布到服务器。请先处理冲突。",
            { conflictId: unresolved.id },
          );
      });
    const ids = [...captured.objects.keys()];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const { missing } = await this.request<{ missing: string[] }>(
        connection,
        `/api/projects/${project.remoteProjectId}/objects/check`,
        "POST",
        { digests: ids.slice(offset, offset + 500) },
      );
      for (const digest of missing) {
        const bytes = captured.objects.get(digest)!;
        const response = await fetch(
          `${connection.url}/api/projects/${project.remoteProjectId}/objects/${digest}`,
          {
            method: "PUT",
            body: (() => {
              let offset = 0;
              return new ReadableStream<Uint8Array>({
                pull(controller) {
                  if (offset === bytes.length) {
                    controller.close();
                    return;
                  }
                  const count = Math.min(64 * 1024, bytes.length - offset);
                  controller.enqueue(
                    new Uint8Array(
                      bytes.buffer,
                      bytes.byteOffset + offset,
                      count,
                    ),
                  );
                  offset += count;
                },
              });
            })(),
            duplex: "half",
            headers: { authorization: `Bearer ${connection.token}` },
            signal: AbortSignal.timeout(60_000),
          } as RequestInit,
        );
        if (!response.ok) {
          const value = await response.json();
          throw new SyncError(
            response.status,
            value.error?.code ?? "UPLOAD_FAILED",
            value.error?.message ?? "上传资源失败。",
          );
        }
        await atomicLibraryFile(
          this.home,
          this.objectPath(digest, this.cacheKey(connection, project)),
          bytes,
        );
      }
    }
    await this.cacheRecord(connection, project, captured);
    return this.request<{ revision: string; head: string; published: boolean }>(
      connection,
      `/api/projects/${project.remoteProjectId}/revisions`,
      "POST",
      { snapshot: captured.snapshot, expected, publish },
    );
  }
  private conflictPath(projectId: string) {
    return join(this.root, "conflicts", `${assertId(projectId)}.json`);
  }
  private pendingPath(projectId: string) {
    return join(this.root, "pending-imports", `${assertId(projectId)}.json`);
  }
  private async savePendingImport(
    projectId: string,
    pending: Omit<PendingImport, "files">,
    files: Map<string, Buffer>,
  ) {
    const references: Record<string, string> = {};
    for (const [path, bytes] of files) {
      const digest = hash(bytes);
      references[path] = digest;
      await atomicLibraryFile(this.home, this.objectPath(digest), bytes);
    }
    const saved = { ...pending, files: references };
    await atomicLibraryFile(
      this.home,
      this.pendingPath(projectId),
      Buffer.from(JSON.stringify(saved)),
    );
    return saved;
  }
  private async pendingFiles(pending: PendingImport) {
    const files = new Map<string, Buffer>();
    for (const [path, digest] of Object.entries(pending.files)) {
      const bytes = await readFile(this.objectPath(digest));
      if (hash(bytes) !== digest)
        throw new CoreError(
          "INVALID_DATA",
          "保留的同步合并草稿未通过完整性检查，原始 Git 历史仍然保留。",
        );
      files.set(path, bytes);
    }
    return files;
  }
  async conflict(projectId: string) {
    return (await readJson<SyncConflict>(this.conflictPath(projectId))) ?? null;
  }
  async retainedConflicts(projectId: string): Promise<RetainedConflict[]> {
    assertId(projectId);
    const library = new GitLibrary(this.home),
      head = await library.head();
    if (!head) return [];
    const paths = (await library.tree(head))
      .map((entry) => entry.path)
      .filter(
        (path) =>
          path.startsWith(`projects/${projectId}/conflicts/`) &&
          path.endsWith("/record.json"),
      );
    return [...(await library.readFiles(paths, head))].map(
      ([, bytes]) => JSON.parse(bytes.toString()) as RetainedConflict,
    );
  }
  async resolveConflict(
    projectId: string,
    choices: Record<string, "local" | "remote">,
  ) {
    const conflict = await this.conflict(projectId);
    if (!conflict) throw new CoreError("NOT_FOUND", "没有待处理的同步冲突。");
    if (
      conflict.files.some(
        (file) =>
          choices[file.path] !== "local" && choices[file.path] !== "remote",
      )
    )
      throw new CoreError("INVALID_DATA", "请为每个冲突选择保留的内容。");
    await atomicLibraryFile(
      this.home,
      join(this.root, "conflicts", `${projectId}.choices.json`),
      Buffer.from(
        JSON.stringify({
          remoteHead: conflict.remoteHead,
          localHead: conflict.localHead,
          choices,
        }),
      ),
    );
    await this.state(projectId, { status: "pending" });
    await this.run(projectId);
    return this.status();
  }
  private async synchronize(
    project: ProjectConnection,
    connection: ServerConnection,
  ) {
    const deviceId = (await this.configuration()).deviceId;
    if (project.pendingCreation) {
      const metadata = await new FileStore(this.home).readProject(
        project.projectId,
      );
      const created = await this.request<SyncProject>(
        connection,
        "/api/projects",
        "POST",
        { id: project.remoteProjectId, name: metadata.name },
      );
      if (created.head && !project.remoteHead)
        throw new CoreError(
          "CONFLICT",
          "默认服务器已存在同 ID 项目，本地内容已保留。",
        );
      await this.state(project.projectId, {
        pendingCreation: false,
        role: created.role,
      });
    }
    const remote = await this.request<SyncProject>(
      connection,
      `/api/projects/${project.remoteProjectId}`,
    );
    await this.state(project.projectId, { role: remote.role });
    project.role = remote.role;
    const library = new GitLibrary(this.home);
    await library.recover();
    const localHead = await library.head();
    const localExists = (await library.tree(localHead ?? undefined)).some(
      (entry) => entry.path === `projects/${project.projectId}/project.json`,
    );
    let localFiles =
      localExists && localHead
        ? await new LibraryOperations(
            this.home,
            project.projectId,
          ).projectFiles(project.projectId, localHead)
        : new Map<string, Buffer>();
    const unfinishedSave = (await new WorkspaceProtection(library).list()).find(
      (item) =>
        item.state === "unresolved" &&
        (localFiles.has(item.path) ||
          item.path.startsWith(`projects/${project.projectId}/`)),
    );
    if (unfinishedSave)
      throw new CoreError(
        "CONFLICT",
        "本机保存失败，未解决的文件修改不会发布到服务器。请通过顶部的外部修改入口处理后重新保存。",
        { conflictId: unfinishedSave.id },
      );
    let pending = await readJson<PendingImport>(
      this.pendingPath(project.projectId),
    );
    if (pending && pending.serverId !== connection.serverId)
      throw new CoreError(
        "CONFLICT",
        "项目仍有来自原服务器的恢复草稿，请先处理后再更换服务器。",
      );
    if (pending) {
      if (!remote.head)
        throw new CoreError(
          "CONFLICT",
          "服务器当前版本缺失，已保留本地恢复草稿，请先恢复服务器内容。",
        );
      const saved = await this.pendingFiles(pending);
      let anchor: Map<string, Buffer>;
      if (pending.appliedHead)
        anchor = await new LibraryOperations(
          this.home,
          project.projectId,
        ).projectFiles(project.projectId, pending.appliedHead);
      else {
        const imported = (
          await library.history({ projectId: project.projectId, limit: 1000 })
        ).find((entry) => entry.syncOrigin?.serverId === connection.serverId);
        anchor = imported?.syncOrigin
          ? await this.files(
              connection,
              project,
              await this.record(
                connection,
                project,
                imported.syncOrigin.revision,
              ),
            )
          : pending.originalHead
            ? await new LibraryOperations(
                this.home,
                project.projectId,
              ).projectFiles(project.projectId, pending.originalHead)
            : new Map<string, Buffer>();
      }
      const blend = mergeProjectFiles(anchor, localFiles, saved);
      if (blend.conflicts.length) {
        const retained = retainSyncConflicts({
          projectId: project.projectId,
          files: blend.files,
          conflicts: blend.conflicts,
          localFiles,
          remoteFiles: saved,
          local: {
            account: connection.user.name,
            deviceId,
            revision: localHead,
          },
          remote: {
            account: "未知账号",
            deviceId: "unknown",
            revision: pending.appliedHead ?? null,
            baseRevision: pending.remoteHead,
            label: "保留的合并草稿",
          },
        });
        blend.files = retained.files;
      }
      localFiles = blend.files;
      if (
        pending.appliedHead &&
        project.remoteHead === pending.remoteHead &&
        remote.head === pending.remoteHead
      ) {
        const actual = await new LibraryOperations(
          this.home,
          project.projectId,
        ).projectFiles(project.projectId, localHead!);
        if (!sameFiles(actual, localFiles)) {
          let branch = pending.localBranch ?? project.remoteHead;
          let cursor = pending.localHistoryRevision ?? project.localRevision;
          if (remote.role !== "viewer") {
            for (const entry of await projectHistory(
              this.home,
              project.projectId,
              cursor,
            )) {
              const captured = await captureProject(
                this.home,
                project.projectId,
                entry,
                branch ? [branch] : [],
                project.remoteProjectId,
                deviceId,
              );
              await this.upload(
                connection,
                project,
                captured,
                project.remoteHead,
                false,
              );
              branch = captured.revision;
              cursor = entry.revision;
            }
          }
          pending = await this.savePendingImport(
            project.projectId,
            {
              ...pending,
              localBranch: branch,
              localHistoryRevision: cursor,
              needsPublish: true,
            },
            localFiles,
          );
          const changes = new Map<string, Buffer | null>(
            [...localFiles].filter(
              ([path, bytes]) => !actual.get(path)?.equals(bytes),
            ),
          );
          for (const path of actual.keys())
            if (!localFiles.has(path)) changes.set(path, null);
          const expected = new Map<string, string | null>();
          for (const path of changes.keys())
            expected.set(
              path,
              await library.resourceRevision(path, localHead!),
            );
          const recovered = await library.writeFiles(
            changes,
            {
              actor: { kind: "system" },
              channel: "system",
              message: "恢复同步并保留双方修改",
              syncOrigin: {
                serverId: connection.serverId,
                projectId: project.projectId,
                revision: pending.remoteHead,
                parents: [],
                at: new Date().toISOString(),
                deviceId,
              },
            },
            expected,
          );
          if (recovered?.workspaceConflicts?.length)
            throw new CoreError(
              "CONFLICT",
              "同步恢复期间文件又有修改，双方草稿已保留，请处理本机保存冲突。",
              { conflictId: recovered.workspaceConflicts[0].id },
            );
          pending.appliedHead = await library.head();
          await atomicLibraryFile(
            this.home,
            this.pendingPath(project.projectId),
            Buffer.from(JSON.stringify(pending)),
          );
          await rm(this.conflictPath(project.projectId), { force: true });
        }
      }
    }
    const baselineRevision = pending?.remoteHead ?? project.remoteHead;
    const baseline = baselineRevision
      ? await this.files(
          connection,
          project,
          await this.record(connection, project, baselineRevision),
        )
      : new Map<string, Buffer>();
    if (remote.head !== project.remoteHead && remote.head) {
      // Retain every offline edit as a branch before advancing the local baseline.
      let localBranch = project.remoteHead;
      if (remote.role !== "viewer")
        for (const entry of await projectHistory(
          this.home,
          project.projectId,
          project.localRevision,
        )) {
          const captured = await captureProject(
            this.home,
            project.projectId,
            entry,
            localBranch ? [localBranch] : [],
            project.remoteProjectId,
            deviceId,
          );
          await this.upload(
            connection,
            project,
            captured,
            project.remoteHead,
            false,
          );
          localBranch = captured.revision;
        }
      const incoming: string[] = [];
      let after = project.remoteHead;
      while (true) {
        const page = await this.request<{
          entries: (
            (SnapshotRecord & { published: boolean }) | { revision: string }
          )[];
          next: string | null;
        }>(
          connection,
          `/api/projects/${project.remoteProjectId}/revisions?${new URLSearchParams({ ...(after ? { after } : {}), ...(connection.capabilities?.includes("history-summary-v1") ? { summary: "1" } : {}) })}`,
        );
        for (const item of page.entries) {
          const record =
            "snapshot" in item
              ? item
              : await this.record(connection, project, item.revision);
          await this.cacheRecord(connection, project, record);
          await this.files(connection, project, record);
          incoming.push(record.revision);
        }
        if (!page.next) break;
        after = page.next;
      }
      const remoteRecord = await this.record(connection, project, remote.head),
        remoteFiles = await this.files(connection, project, remoteRecord);
      const merge =
        (remote.role === "viewer" && sameFiles(localFiles, baseline)) ||
        !localExists
          ? { files: remoteFiles, conflicts: [] as FileConflict[] }
          : mergeProjectFiles(baseline, localFiles, remoteFiles);
      if (merge.conflicts.length) {
        const retained = retainSyncConflicts({
          projectId: project.projectId,
          files: merge.files,
          conflicts: merge.conflicts,
          localFiles,
          remoteFiles,
          local: {
            account: connection.user.name,
            deviceId,
            revision: localHead,
          },
          remote: {
            account: remoteRecord.source?.user.name ?? "未知账号",
            deviceId: remoteRecord.snapshot.change.deviceId ?? "unknown",
            revision: remoteRecord.revision,
          },
        });
        merge.files = retained.files;
      }
      // Pin the imported sequence to the advertised head; later server changes are fetched next time.
      const end = incoming.indexOf(remote.head);
      const pinned = end >= 0 ? incoming.slice(0, end + 1) : incoming;
      if (!pinned.length)
        throw new CoreError(
          "INVALID_DATA",
          "服务器当前版本没有可恢复的历史记录。",
        );
      const manager = this;
      async function* history() {
        for (const revision of pinned) {
          const record = await manager.record(connection, project, revision);
          yield {
            record,
            files: await manager.files(connection, project, record),
          };
        }
      }
      pending = await this.savePendingImport(
        project.projectId,
        {
          serverId: connection.serverId,
          remoteHead: remote.head,
          originalHead: localHead,
          localBranch,
          needsPublish: !sameFiles(merge.files, remoteFiles),
        },
        merge.files,
      );
      await importProjectHistory(
        this.home,
        project.projectId,
        connection.serverId,
        history(),
        merge.files,
        localHead,
        project.remoteProjectId,
      );
      const mergedHead = await library.head();
      pending.appliedHead = mergedHead;
      await atomicLibraryFile(
        this.home,
        this.pendingPath(project.projectId),
        Buffer.from(JSON.stringify(pending)),
      );
      await this.state(project.projectId, {
        remoteHead: remote.head,
        localRevision: mergedHead,
        status: "pending",
        error: undefined,
      });
      project.remoteHead = remote.head;
      project.localRevision = mergedHead;
      await rm(this.conflictPath(project.projectId), { force: true });
      await rm(
        join(this.root, "conflicts", `${project.projectId}.choices.json`),
        { force: true },
      );
    }
    if (pending && project.remoteHead === pending.remoteHead) {
      if (pending.needsPublish && remote.role === "viewer") {
        await this.state(project.projectId, {
          status: "revoked",
          error:
            "账号已改为查看者，未上传的合并内容仍保留在本地。请切换有编辑权限的账号。",
        });
        return;
      }
      if (pending.needsPublish && remote.role !== "viewer") {
        const mergedHead = await library.head();
        if (!mergedHead)
          throw new CoreError("NOT_FOUND", "待发布的本地合并版本不存在。");
        const entry = await library.entryAt(mergedHead);
        const captured = await captureProject(
          this.home,
          project.projectId,
          entry,
          [
            ...new Set([
              pending.remoteHead,
              ...(pending.localBranch &&
              pending.localBranch !== project.remoteHead
                ? [pending.localBranch]
                : []),
            ]),
          ],
          project.remoteProjectId,
          deviceId,
        );
        captured.snapshot.change.message = "合并跨设备项目修改";
        // Snapshot digest is recomputed by the server; keep cache identity consistent.
        const { snapshotRevision } = await import("./protocol");
        captured.revision = await snapshotRevision(captured.snapshot);
        const result = await this.upload(
          connection,
          project,
          captured,
          pending.remoteHead,
        );
        project.remoteHead = result.head;
        await this.state(project.projectId, {
          remoteHead: result.head,
          localRevision: mergedHead,
        });
      }
      await rm(this.pendingPath(project.projectId), { force: true });
    }
    if (remote.role !== "viewer") {
      const history = await projectHistory(
        this.home,
        project.projectId,
        project.localRevision,
        project.remoteHead === null,
      );
      for (const entry of history) {
        const captured = await captureProject(
          this.home,
          project.projectId,
          entry,
          project.remoteHead ? [project.remoteHead] : [],
          project.remoteProjectId,
          deviceId,
        );
        const result = await this.upload(
          connection,
          project,
          captured,
          project.remoteHead,
        );
        project.remoteHead = result.head;
        project.localRevision = entry.revision;
        await this.state(project.projectId, {
          remoteHead: result.head,
          localRevision: entry.revision,
          status: "pending",
        });
      }
    }
    await this.state(project.projectId, {
      status: "synced",
      error: undefined,
      syncedAt: new Date().toISOString(),
    });
  }
  async enrollNewProjects(projectId?: string) {
    const config = await this.configuration();
    if (!config.defaultConnectionId || !config.defaultSince) return;
    const local = await new FileStore(this.home).listProjects({
      includeArchived: true,
    });
    for (const project of local)
      if (
        (!projectId || project.id === projectId) &&
        project.createdAt >= config.defaultSince &&
        !config.projects.some(
          (connection) => connection.projectId === project.id,
        )
      ) {
        const connection = config.connections.find(
          (item) => item.id === config.defaultConnectionId,
        )!;
        await this.update((next) => {
          if (!next.projects.some((item) => item.projectId === project.id))
            next.projects.push({
              projectId: project.id,
              remoteProjectId: project.id,
              connectionId: connection.id,
              role: "admin",
              remoteHead: null,
              localRevision: null,
              status: "pending",
              pendingCreation: true,
            });
        });
      }
  }
  async run(
    projectId?: string,
  ): Promise<Awaited<ReturnType<SyncManager["status"]>>> {
    if (this.running) {
      await this.running;
      return this.run(projectId);
    }
    this.running = (async () => {
      await this.enrollNewProjects(projectId);
      const config = await this.configuration();
      for (const project of config.projects.filter(
        (item) => !projectId || item.projectId === projectId,
      )) {
        const connection = config.connections.find(
          (item) => item.id === project.connectionId,
        );
        if (!connection) continue;
        try {
          await this.synchronize(project, connection);
        } catch (error) {
          const status =
            error instanceof CoreError && error.conflictId
              ? "save-failed"
              : error instanceof SyncError && error.status === 403
                ? "revoked"
                : error instanceof SyncError && error.code === "CONFLICT"
                  ? "pending"
                  : "offline";
          await this.state(project.projectId, {
            status,
            error:
              error instanceof SyncError && error.status === 401
                ? "服务器登录已到期或撤销，请重新登录。本地修改会保留。"
                : error instanceof Error
                  ? error.message
                  : String(error),
          });
        }
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
    return this.status();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.run().catch((error) =>
        console.error("Project sync failed", error),
      );
    }, 5000);
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
  async assertEditable(projectId: string) {
    const project = (await this.configuration()).projects.find(
      (item) => item.projectId === projectId,
    );
    if (project?.role === "viewer" || project?.status === "revoked")
      throw new CoreError(
        "CONFLICT",
        "当前项目账号只有查看权限或访问权限已撤销。本地内容仍保留。",
      );
  }
}
