import {
  mkdir,
  cp,
  rm,
  readdir,
  realpath,
  readFile,
  stat,
} from "node:fs/promises";
import { join, delimiter, resolve, sep, basename, extname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { FileStore, assertId } from "../core/store";
import { AgentService } from "../agent/service";
import {
  writeProtected,
  readOptional,
  type HostedCredentialBroker,
} from "./storage";
import {
  execute,
  executablePaths,
  findExecutable,
  RpcProcess,
} from "./process";
import { SdkInstaller } from "./installer";
import { ChatGptConnection } from "./chatgpt";
import { startModelGateway } from "./gateway";
import type { ModelResources } from "../sync/model-resources";
import type { ResolvedResource } from "../sync/accounts";
import { withLibraryLock } from "../core/library-lock";
import type {
  AgentHostStatus,
  AgentId,
  AgentSettings,
  AgentTask,
  LocalAgent,
  ModelSource,
} from "./types";

const sourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  provider: z.enum([
    "chatgpt",
    "openrouter",
    "deepseek",
    "openai",
    "moonshot",
    "custom",
  ]),
  baseUrl: z.string().url(),
  model: z.string().trim().max(200),
  protocol: z.enum(["responses", "chat"]),
  credential: z.enum(["api-key", "chatgpt"]),
  hosted: z
    .object({
      connectionId: z.string().uuid(),
      resourceId: z
        .string()
        .regex(/^[\w-]+$/)
        .max(200),
      serverName: z.string().max(100),
      url: z.string().url(),
    })
    .optional(),
});
const settingsSchema = z.object({
  mode: z.enum(["local", "api"]),
  localAgent: z.enum(["codex", "kimi", "claude", "gemini", "opencode"]),
  sourceId: z.string(),
  sources: z.array(sourceSchema).max(30),
});
const definitions: {
  id: AgentId;
  name: string;
  command: string;
  acp?: string[];
}[] = [
  { id: "codex", name: "Codex", command: "codex" },
  { id: "kimi", name: "Kimi", command: "kimi", acp: ["acp"] },
  { id: "claude", name: "Claude Code", command: "claude" },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    acp: ["--experimental-acp"],
  },
  { id: "opencode", name: "OpenCode", command: "opencode", acp: ["acp"] },
];
export interface AgentHostOptions {
  root: string;
  workspaceRoot?: string;
  library: () => FileStore;
  cli: () => { command: string; args: string[]; env: Record<string, string> };
  pluginRoot: () => string;
  broker?: HostedCredentialBroker;
  resources?: ModelResources;
  openUrl?: (url: string) => Promise<void>;
}
export function isolatedEnvironment(
  root: string,
  workspace: string,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: executablePaths().join(delimiter),
    HOME: join(root, "private-home"),
    USERPROFILE: join(root, "private-home"),
    CODEX_HOME: join(root, "codex"),
    CODEX_SQLITE_HOME: join(root, "codex"),
    PWD: workspace,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TMPDIR: join(root, "tmp"),
    TMP: join(root, "tmp"),
    TEMP: join(root, "tmp"),
  };
  for (const name of [
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "SSL_CERT_FILE",
    "CODEX_CA_CERTIFICATE",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
  ])
    if (process.env[name]) env[name] = process.env[name]!;
  return env;
}
/** Embedded tasks receive a separately configured project-bound MCP. */
export async function copyEmbeddedPlugin(source: string, destination: string) {
  await cp(source, destination, { recursive: true, force: true });
  await rm(join(destination, "mcp.json"), { force: true });
}

export class AgentHost {
  readonly installer: SdkInstaller;
  readonly chatgpt: ChatGptConnection;
  readonly workspaceRoot: string;
  private agents: LocalAgent[] = [];
  private controllers = new Map<string, AbortController>();
  private tasks: AgentTask[] = [];
  private pluginSetup?: Promise<void>;
  private installationVersion?: string;
  private permissions = new Map<string, (option: string | null) => void>();
  private loaded?: Promise<void>;
  constructor(readonly options: AgentHostOptions) {
    this.installer = new SdkInstaller(join(options.root, "runtime"));
    this.chatgpt = new ChatGptConnection(
      options.root,
      options.broker ?? options.resources,
    );
    this.workspaceRoot =
      options.workspaceRoot ??
      join(homedir(), "Documents", "ShowAI", "Agent Workspaces");
  }
  async settings(): Promise<AgentSettings> {
    const saved = await readOptional<AgentSettings>(
      join(this.options.root, "settings.json"),
    );
    return saved
      ? settingsSchema.parse(saved)
      : { mode: "local", localAgent: "codex", sourceId: "", sources: [] };
  }
  async status(taskId?: string): Promise<AgentHostStatus> {
    await this.loadTasks();
    const settings = await this.settings();
    for (const source of settings.sources) {
      if (source.hosted) {
        source.connected = true;
        source.apiKeyPresent = source.credential === "api-key";
        source.planEnabled = source.credential === "chatgpt";
        source.refreshOwner = "server";
        source.account = (await this.chatgpt.credentials(source.id))?.email;
        continue;
      }
      if (source.credential === "chatgpt") {
        const auth = await this.chatgpt.credentials(source.id);
        source.connected = !!auth;
        source.account = auth?.email;
        source.refreshOwner = auth?.refreshOwner;
        source.planEnabled =
          auth?.refreshOwner === "server" ||
          auth?.scopes.includes("chatgpt.tokens.use.direct") ||
          false;
      } else
        source.apiKeyPresent = !!(
          await readOptional<{ apiKey: string }>(
            join(this.options.root, "credentials", source.id + ".json"),
          )
        )?.apiKey;
    }
    return {
      settings,
      agents: this.agents,
      runtime: await this.installer.status(),
      workspaceRoot: this.workspaceRoot,
      credentialRoot: this.options.root,
      tasks: this.tasks.map((task, index) => ({
        ...task,
        events:
          task.id === taskId || (!taskId && index === 0) ? task.events : [],
      })),
      authorization: this.chatgpt.state,
    };
  }
  async save(input: unknown) {
    const settings = settingsSchema.parse(input);
    if (
      new Set(settings.sources.map((source) => source.id)).size !==
      settings.sources.length
    )
      throw new Error("来源 ID 重复。");
    if (
      settings.sourceId &&
      !settings.sources.some((source) => source.id === settings.sourceId)
    )
      throw new Error("请选择已有的模型来源。");
    for (const source of settings.sources) {
      const url = new URL(source.baseUrl);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
          ))
      )
        throw new Error(
          "模型地址需使用 HTTPS；本机服务可以使用 HTTP。地址中不能包含凭据。",
        );
      if (
        source.credential === "chatgpt" &&
        (source.provider !== "chatgpt" ||
          source.baseUrl !== "https://api.openai.com/v1" ||
          source.protocol !== "responses")
      )
        throw new Error("ChatGPT 授权只能用于官方 Responses API。");
    }
    await writeProtected(join(this.options.root, "settings.json"), settings);
    return this.status();
  }
  async saveSource(input: unknown, apiKey?: unknown) {
    const source = sourceSchema.parse(input),
      settings = await this.settings();
    if (source.hosted && apiKey !== undefined)
      throw new Error("这份凭据由来源服务器管理，请在来源服务器更新。");
    if (
      apiKey !== undefined &&
      (source.credential !== "api-key" ||
        typeof apiKey !== "string" ||
        apiKey.length > 8192)
    )
      throw new Error("Invalid API credential.");
    const previous = settings.sources.find((item) => item.id === source.id);
    if (previous && previous.credential !== source.credential)
      throw new Error("请先移除原来源，再添加不同类型的连接。");
    if (
      this.tasks.some(
        (task) => task.state === "running" && task.sourceId === source.id,
      )
    )
      throw new Error("请先停止使用此来源的任务，再修改连接。");
    const index = settings.sources.findIndex((item) => item.id === source.id);
    if (index < 0) settings.sources.push(source);
    else settings.sources[index] = source;
    settings.sourceId = source.id;
    await this.save(settings);
    if (apiKey !== undefined) {
      if (
        source.credential !== "api-key" ||
        typeof apiKey !== "string" ||
        apiKey.length > 8192
      )
        throw new Error("Invalid API credential.");
      await writeProtected(
        join(this.options.root, "credentials", source.id + ".json"),
        { apiKey: apiKey.trim() },
      );
    }
    return this.status();
  }
  async removeSource(id: string) {
    assertId(id);
    if (
      this.tasks.some((task) => task.state === "running" && task.mode === "api")
    )
      throw new Error("请先停止正在使用模型来源的任务。");
    const settings = await this.settings(),
      source = settings.sources.find((item) => item.id === id);
    if (source?.credential === "chatgpt" && !source.hosted)
      await this.chatgpt.disconnect(id);
    else
      await rm(join(this.options.root, "credentials", id + ".json"), {
        force: true,
      });
    settings.sources = settings.sources.filter((item) => item.id !== id);
    if (settings.sourceId === id)
      settings.sourceId = settings.sources[0]?.id ?? "";
    return this.save(settings);
  }
  async scan() {
    this.agents = await Promise.all(
      definitions.map(async (definition): Promise<LocalAgent> => {
        const path = await findExecutable(definition.command);
        const previous = this.agents.find((item) => item.id === definition.id);
        if (!path)
          return {
            id: definition.id,
            name: definition.name,
            path: null,
            version: "",
            auth: "missing",
            detail: "未找到程序",
            callable: null,
          };
        let version = "",
          auth: LocalAgent["auth"] = "unknown",
          detail = "已找到程序，运行连接测试可确认调用能力";
        try {
          const result = await execute(path, ["--version"], { timeout: 10000 });
          version = (result.stdout || result.stderr).trim().slice(0, 120);
          if (definition.id === "codex") {
            const result = await execute(path, ["login", "status"], {
              timeout: 10000,
            });
            auth = result.code === 0 ? "ready" : "missing";
            detail =
              auth === "ready" ? "已有 Codex 登录" : "请先在本机 Codex 中登录";
          } else if (definition.id === "kimi") {
            const result = await execute(path, ["provider", "list"], {
              timeout: 10000,
            });
            auth =
              result.code === 0 &&
              /source=oauth|source=.*key|Default model:/i.test(result.stdout)
                ? "unknown"
                : "unknown";
            detail =
              result.code === 0
                ? "已配置 Kimi 模型来源，调用测试会确认登录是否有效"
                : "需要运行连接测试确认登录";
          }
        } catch (error) {
          detail = error instanceof Error ? error.message : String(error);
        }
        return {
          id: definition.id,
          name: definition.name,
          path,
          version,
          auth,
          detail,
          callable: previous?.path === path ? previous.callable : null,
          testedAt: previous?.testedAt,
        };
      }),
    );
    return this.status();
  }
  async source(id: string) {
    const source = (await this.settings()).sources.find(
      (item) => item.id === id,
    );
    if (!source) throw new Error("请选择模型来源。");
    return source;
  }
  async token(source: ModelSource, force = false) {
    if (source.hosted) {
      if (!this.options.resources) throw new Error("服务器资源管理尚未连接。");
      return (await this.options.resources.token(source.hosted, source, force))
        .token;
    }
    if (source.credential === "chatgpt")
      return this.chatgpt.accessToken(source.id, force);
    const saved = await readOptional<{ apiKey: string }>(
      join(this.options.root, "credentials", source.id + ".json"),
    );
    if (
      !saved?.apiKey &&
      !["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(source.baseUrl).hostname,
      )
    )
      throw new Error("请保存此来源的 API Key。");
    return saved?.apiKey ?? "local";
  }
  async models(id: string) {
    const source = await this.source(id);
    const response = await fetch(
      source.baseUrl.replace(/\/$/, "") + "/models",
      {
        headers: { authorization: "Bearer " + (await this.token(source)) },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error(
        `无法获取模型列表：HTTP ${response.status}。可在来源中填写模型名称。`,
      );
    const result = (await response.json()) as { data?: any[]; models?: any[] };
    return (result.models ?? result.data ?? [])
      .filter(
        (item) => item.visibility === undefined || item.visibility === "list",
      )
      .map((item) => ({
        id: String(item.slug ?? item.id),
        name: String(item.display_name ?? item.name ?? item.slug ?? item.id),
      }));
  }
  async authorize(id: string) {
    const source = await this.source(id);
    if (source.hosted)
      throw new Error("请在资源来源设备重新授权，再保存到来源服务器。");
    if (source.credential !== "chatgpt")
      throw new Error("此来源使用 API Key。");
    const result = await this.chatgpt.start(id);
    await this.options.openUrl?.(result.url);
    return this.options.openUrl ? { pending: true } : result;
  }
  async addServerResource(id: string) {
    if (!this.options.resources) throw new Error("服务器资源管理尚未连接。");
    const resource: ResolvedResource | undefined = (
      await this.options.resources.list()
    ).find((item) => item.id === id);
    if (!resource?.available || !resource.connected)
      throw new Error("这份服务器资源尚不可用，请刷新来源列表。");
    const existing = (await this.settings()).sources.find(
      (item) =>
        item.hosted?.connectionId === resource.connectionId &&
        item.hosted.resourceId === resource.resourceId,
    );
    const source: ModelSource = {
      id: existing?.id ?? randomUUID(),
      name: resource.name,
      provider: resource.provider,
      baseUrl: resource.baseUrl,
      model: resource.model,
      protocol: resource.protocol,
      credential: resource.credential,
      hosted: {
        connectionId: resource.connectionId,
        resourceId: resource.resourceId,
        serverName: resource.source.serverName,
        url: resource.source.url,
      },
    };
    if (source.credential === "chatgpt")
      await writeProtected(
        join(this.options.root, "credentials", source.id + ".json"),
        {
          refreshOwner: "server",
          connectionId: `${resource.connectionId}/${resource.resourceId}`,
          email: resource.account ?? "ChatGPT",
        },
      );
    return this.saveSource(source);
  }
  async publishSource(id: string, connectionId: string) {
    if (!this.options.resources) throw new Error("服务器资源管理尚未连接。");
    if (
      this.chatgpt.state.state === "pending" ||
      this.tasks.some(
        (task) => task.state === "running" && task.sourceId === id,
      )
    )
      throw new Error("请先完成账号授权或停止使用这份来源的任务。");
    const transferPath = join(
      this.options.root,
      "credentials",
      `transfer-${id}.json`,
    );
    return withLibraryLock(
      this.options.root,
      async () => {
        const current = await this.source(id);
        let pending = await readOptional<{
          source: ModelSource;
          connectionId: string;
          publicationId: string;
          secret: Record<string, unknown>;
        }>(transferPath);
        if (current.hosted && !pending)
          throw new Error("这份来源已经由服务器管理。");
        if (pending && pending.connectionId !== connectionId)
          throw new Error(
            "这份授权仍在保存到另一台服务器，请先完成原来的保存。",
          );
        if (!pending) {
          const saved =
            current.credential === "chatgpt"
              ? await this.chatgpt.credentials(id)
              : await readOptional<{ apiKey: string }>(
                  join(this.options.root, "credentials", id + ".json"),
                );
          if (
            !saved ||
            ("refreshOwner" in saved && saved.refreshOwner !== "local")
          )
            throw new Error("请先在本设备完成来源授权。");
          if (
            "refreshOwner" in saved &&
            (saved.refreshOwner !== "local" ||
              !saved.scopes.includes("chatgpt.tokens.use.direct"))
          )
            throw new Error("请先授权使用 ChatGPT 套餐，再保存到服务器。");
          pending = {
            source: current,
            connectionId,
            publicationId: randomUUID(),
            secret: { ...saved, kind: current.credential },
          };
          await writeProtected(transferPath, pending);
        }
        if (pending.source.credential === "chatgpt") {
          const latest = await this.chatgpt.credentials(id);
          if (latest?.refreshOwner === "local") {
            pending.secret = { ...latest, kind: "chatgpt" };
            await writeProtected(transferPath, pending);
          }
          // Suspend the local refresh owner before contacting the hosted vault.
          // An unknown HTTP outcome keeps this durable transfer for a retry.
          await writeProtected(
            join(this.options.root, "credentials", id + ".json"),
            {
              refreshOwner: "server",
              connectionId: `${connectionId}/${id}`,
              email: pending.secret.email,
            },
          );
        }
        const resource = await this.options.resources!.publish(connectionId, {
          ...pending.source,
          id,
          secret: pending.secret,
          publicationId: pending.publicationId,
        });
        await this.saveSource({
          ...pending.source,
          hosted: {
            connectionId,
            resourceId: resource.id,
            serverName: resource.source.serverName,
            url: resource.source.url,
          },
        });
        if (pending.source.credential === "api-key")
          await rm(join(this.options.root, "credentials", id + ".json"));
        await rm(transferPath);
        return this.status();
      },
      "publish-model-resource",
    );
  }
  private async prepareIsolation() {
    const paths = await this.installer.paths();
    if (this.installationVersion === paths.version) return;
    if (this.pluginSetup) return this.pluginSetup;
    this.pluginSetup = this.installPlugin(paths.binary)
      .then(() => {
        this.installationVersion = paths.version;
      })
      .finally(() => {
        this.pluginSetup = undefined;
      });
    return this.pluginSetup;
  }
  private async installPlugin(binary: string) {
    const root = join(this.options.root, "embedded"),
      env = isolatedEnvironment(root, this.workspaceRoot);
    for (const directory of [
      env.HOME,
      env.CODEX_HOME,
      env.TMPDIR,
      this.workspaceRoot,
    ])
      await mkdir(directory, { recursive: true, mode: 0o700 });
    const marketplace = join(root, "showai-marketplace");
    await mkdir(join(marketplace, ".agents/plugins"), { recursive: true });
    await copyEmbeddedPlugin(
      this.options.pluginRoot(),
      join(marketplace, "plugins/showai"),
    );
    await writeProtected(
      join(marketplace, ".agents/plugins/marketplace.json"),
      {
        name: "showai-embedded",
        plugins: [
          {
            name: "showai",
            source: { source: "local", path: "./plugins/showai" },
          },
        ],
      },
    );
    let installedPath: string | undefined;
    for (const args of [
      ["plugin", "marketplace", "add", marketplace, "--json"],
      ["plugin", "add", "showai@showai-embedded", "--json"],
    ]) {
      const result = await execute(binary, args, {
        env,
        cwd: this.workspaceRoot,
        timeout: 120000,
      });
      if (result.code !== 0)
        throw new Error(
          `ShowAI 插件安装失败：${result.stderr || result.stdout}`,
        );
      if (args[1] === "add")
        installedPath = JSON.parse(result.stdout).installedPath;
    }
    const listing = await execute(binary, ["plugin", "list", "--json"], {
      env,
      cwd: this.workspaceRoot,
      timeout: 30000,
    });
    if (listing.code !== 0) throw new Error("无法验证独立插件安装。");
    const plugins = JSON.parse(listing.stdout);
    if (
      plugins.installed?.length !== 1 ||
      plugins.installed[0].pluginId !== "showai@showai-embedded" ||
      !plugins.installed[0].installed ||
      !plugins.installed[0].enabled
    )
      throw new Error("独立运行时必须仅启用 ShowAI 插件。");
    if (typeof installedPath !== "string")
      throw new Error("ShowAI 插件不在独立运行目录内。");
    installedPath = await realpath(installedPath);
    const ownedHome = await realpath(env.CODEX_HOME);
    if (!installedPath.startsWith(ownedHome + sep))
      throw new Error("ShowAI 插件不在独立运行目录内。");
    const controller = new AbortController();
    const rpc = new RpcProcess(
      binary,
      [
        "app-server",
        "-c",
        "project_root_markers=[]",
        "-c",
        "project_doc_max_bytes=0",
      ],
      this.workspaceRoot,
      () => {},
      controller.signal,
      { env },
    );
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "showai", version: "0.9.0" },
        capabilities: { experimentalApi: true },
      });
      rpc.send({ jsonrpc: "2.0", method: "initialized" });
      const catalog = await rpc.request("skills/list", {
        cwds: [this.workspaceRoot],
        forceReload: true,
      });
      const skills = catalog.data.flatMap((item: any) => item.skills);
      for (const skill of skills.filter(
        (skill: any) =>
          skill.enabled && !String(skill.path).startsWith(installedPath),
      )) {
        await rpc.request("skills/config/write", {
          path: skill.path,
          enabled: false,
        });
      }
      const verified = await rpc.request("skills/list", {
        cwds: [this.workspaceRoot],
        forceReload: true,
      });
      const enabled = verified.data
        .flatMap((item: any) => item.skills)
        .filter((skill: any) => skill.enabled);
      if (
        enabled.length !== 4 ||
        enabled.some(
          (skill: any) => !String(skill.path).startsWith(installedPath),
        )
      )
        throw new Error("独立运行时 Skill 隔离验证失败。");
      await writeProtected(join(root, "isolation.json"), {
        pluginId: "showai@showai-embedded",
        installedPath,
        skills: enabled.map((skill: any) => skill.name),
        verifiedAt: new Date().toISOString(),
      });
    } finally {
      clearTimeout(timeout);
      rpc.close();
    }
  }
  private emit(
    task: AgentTask,
    type: AgentTask["events"][number]["type"],
    text: string,
  ) {
    if (!text) return;
    task.events.push({
      sequence: (task.events.at(-1)?.sequence ?? 0) + 1,
      type,
      text: text.slice(0, 32000),
    });
    if (task.events.length > 400)
      task.events.splice(0, task.events.length - 400);
  }
  private async loadTasks() {
    if (!this.loaded)
      this.loaded = (async () => {
        const root = join(this.options.root, "tasks");
        const files = await readdir(root).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        );
        const tasks = await Promise.all(
          files
            .filter((file) => /^[a-f0-9-]+\.json$/.test(file))
            .map((file) => readOptional<AgentTask>(join(root, file))),
        );
        this.tasks = tasks
          .filter((task): task is AgentTask => !!task)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, 50)
          .map((task) =>
            task.state === "running"
              ? {
                  ...task,
                  state: "failed",
                  error: "上次运行已中断，可以继续会话或重新执行。",
                  approvals: [],
                }
              : task,
          );
      })();
    return this.loaded;
  }
  async start(args: {
    prompt?: unknown;
    projectId?: unknown;
    pageId?: unknown;
    test?: unknown;
    localAgent?: unknown;
    taskId?: unknown;
  }) {
    await this.loadTasks();
    const settings = await this.settings();
    const source =
      settings.mode === "api"
        ? await this.source(settings.sourceId)
        : undefined;
    const localAgent = args.localAgent
      ? z
          .enum(["codex", "kimi", "claude", "gemini", "opencode"])
          .parse(args.localAgent)
      : settings.localAgent;
    const test = args.test === true;
    const id = randomUUID();
    const prompt = test
      ? "Reply with exactly SHOWAI_AGENT_READY. Do not call tools or modify any files."
      : z.string().trim().min(1).max(24000).parse(args.prompt);
    const projectId = test ? "" : assertId(z.string().parse(args.projectId));
    const pageId = args.pageId
      ? assertId(z.string().parse(args.pageId))
      : undefined;
    if (projectId) {
      await this.options.library().listPages(projectId);
      if (pageId)
        await this.options
          .library()
          .readPage(projectId, pageId, { checkpoint: false });
    }
    const componentCatalog = test
      ? undefined
      : await new AgentService({
          root: this.options.library().root,
        }).componentContext(projectId);
    const workspace = join(
      this.workspaceRoot,
      projectId || "Connection Tests",
      id,
    );
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const task: AgentTask = {
      id,
      projectId,
      pageId,
      label: test ? "连接测试" : prompt.slice(0, 100),
      mode: settings.mode,
      sourceId: source?.id,
      localAgent: settings.mode === "local" ? localAgent : undefined,
      state: "running",
      startedAt: new Date().toISOString(),
      workspace,
      events: [],
    };
    const controller = new AbortController();
    await writeProtected(join(this.options.root, "tasks", id + ".json"), task);
    this.controllers.set(id, controller);
    this.tasks.unshift(task);
    if (this.tasks.length > 50)
      this.tasks = this.tasks.filter(
        (item, index) => index < 50 || item.state === "running",
      );
    const cli = this.options.cli();
    const instructions = test
      ? prompt
      : `You are working inside ShowAI. The host has supplied these verified selections: projectId=${projectId}${pageId ? `, pageId=${pageId}` : ""}. Operate only that project and focused page. Use project_context with knownCatalogRevision=${componentCatalog?.revision} to confirm the MCP binding without repeating the supplied index, then read the chosen page. Use the connected ShowAI MCP tools for all library reads and writes. Do not invoke authoring CLI commands or switch connections if MCP fails. Read current hash/revision before saving; preserve conflicting drafts. Do not edit raw library files. Work files belong in ${workspace}. This host displays text and file links, without inline HTML rendering. For a requested preview, use page_present with the requested stable block IDs and return its delivery file link; do not claim it is displayed in the conversation. Read the ShowAI authoring guide before editing. For status-only requests query project_sync_status; do not run project_sync unless the user requests synchronization. Component directory (complete; reuse this index until its revision changes): ${JSON.stringify(componentCatalog)}\nFor page work read selected component guides; for component work read development guidance before source. The user explicitly requests:\n${prompt}`;
    const resume = args.taskId
      ? this.tasks.find(
          (item) =>
            item.id === args.taskId &&
            item.projectId === projectId &&
            item.mode === settings.mode &&
            item.sourceId === source?.id &&
            item.state !== "running",
        )
      : undefined;
    this.emit(
      task,
      "status",
      test ? "正在检验真实模型调用…" : "正在连接 Agent…",
    );
    const run =
      settings.mode === "api"
        ? this.runSdk(
            task,
            instructions,
            cli,
            controller.signal,
            resume?.threadId,
            test,
            source!,
          )
        : this.runLocal(
            task,
            localAgent,
            instructions,
            cli,
            controller.signal,
            test,
          );
    void run
      .then(async () => {
        if (controller.signal.aborted) throw new Error("任务已停止");
        if (
          test &&
          !task.events
            .filter((event) => event.type === "message")
            .map((event) => event.text)
            .join("")
            .includes("SHOWAI_AGENT_READY")
        )
          throw new Error("模型未返回预期的测试结果。");
        task.state = "completed";
        if (test && settings.mode === "local") this.markTest(localAgent, true);
        this.emit(task, "status", test ? "真实调用已通过" : "任务已完成");
      })
      .catch((error: Error) => {
        task.state = controller.signal.aborted ? "cancelled" : "failed";
        task.error = controller.signal.aborted ? "任务已停止" : error.message;
        if (
          settings.mode === "local" &&
          /Authentication required|login_required/i.test(task.error)
        ) {
          const agent = this.agents.find((item) => item.id === localAgent);
          if (agent) {
            agent.auth = "missing";
            agent.detail = "本机登录已失效，请先在此 Agent 中登录";
          }
          task.error = "本机 Agent 需要登录。请在原来的 Agent 中登录后重试。";
        }
        this.emit(task, "error", task.error);
        if (test && settings.mode === "local") this.markTest(localAgent, false);
      })
      .finally(() => {
        task.finishedAt = new Date().toISOString();
        this.controllers.delete(id);
        void writeProtected(
          join(this.options.root, "tasks", id + ".json"),
          task,
        ).catch((error) =>
          console.error("ShowAI Agent task persistence:", error.message),
        );
      });
    return task;
  }
  private markTest(id: AgentId, callable: boolean) {
    const item = this.agents.find((item) => item.id === id);
    if (item) {
      item.callable = callable;
      item.testedAt = new Date().toISOString();
      if (callable) item.auth = "ready";
    }
  }
  private mcp(cli: ReturnType<AgentHostOptions["cli"]>, projectId: string) {
    return {
      command: cli.command,
      args: [...cli.args, "mcp", "--project", projectId],
      env: cli.env,
      required: true,
      tools: Object.fromEntries(
        [
          "page_create",
          "page_save",
          "page_apply",
          "component_import",
          "component_save",
          "template_save",
          "template_apply",
          "whiteboard_create",
          "catalog_fork",
          "catalog_merge_resolve",
          "history_restore",
          "page_merge_save",
        ].map((name) => [name, { approval_mode: "approve" }]),
      ),
    };
  }
  private async runSdk(
    task: AgentTask,
    prompt: string,
    cli: ReturnType<AgentHostOptions["cli"]>,
    signal: AbortSignal,
    threadId?: string,
    test = false,
    source?: ModelSource,
  ) {
    await this.prepareIsolation();
    if (!source) throw new Error("请选择模型来源。");
    if (!source.model) throw new Error("请先选择或填写模型。");
    const gateway = await startModelGateway(source, (force) =>
      this.token(source, force),
    );
    try {
      const paths = await this.installer.paths(),
        env = isolatedEnvironment(
          join(this.options.root, "embedded"),
          task.workspace,
        );
      env.SHOWAI_MODEL_TOKEN = gateway.secret;
      const url = pathToFileURL(paths.sdk).href;
      const sdk = await import(/* @vite-ignore */ url);
      const codex = new sdk.Codex({
        codexPathOverride: paths.binary,
        env,
        config: {
          model_provider: "showai",
          model_providers: {
            showai: {
              name: source.name,
              base_url: gateway.url,
              env_key: "SHOWAI_MODEL_TOKEN",
              wire_api: "responses",
              requires_openai_auth: false,
              supports_websockets: false,
            },
          },
          cli_auth_credentials_store: "file",
          project_root_markers: [],
          project_doc_max_bytes: 0,
          web_search: "disabled",
          features: { apps: false, tool_search: false, hooks: false },
          memories: { generate_memories: false },
          ...(test
            ? {}
            : { mcp_servers: { showai: this.mcp(cli, task.projectId) } }),
        },
      });
      const options = {
        model: source.model,
        sandboxMode: "workspace-write",
        workingDirectory: task.workspace,
        skipGitRepoCheck: true,
        approvalPolicy: "never",
        networkAccessEnabled: true,
        webSearchMode: "disabled",
      };
      const thread = threadId
        ? codex.resumeThread(threadId, options)
        : codex.startThread(options);
      let complete = false;
      const turn = await thread.runStreamed(prompt, { signal });
      for await (const event of turn.events) {
        if (event.type === "thread.started") {
          task.threadId = event.thread_id;
          await writeProtected(
            join(this.options.root, "tasks", task.id + ".json"),
            task,
          );
        }
        if (event.type === "turn.completed") complete = true;
        if (event.type === "error" || event.type === "turn.failed")
          throw new Error(
            event.message ?? event.error?.message ?? "Agent 执行失败",
          );
        if (event.type === "item.completed" || event.type === "item.updated")
          this.codexEvent(task, event.item);
      }
      if (!complete) throw new Error("Agent 未完成本轮任务。");
    } finally {
      gateway.close();
    }
  }
  private codexEvent(task: AgentTask, item: any) {
    if (item.type === "agent_message") this.emit(task, "message", item.text);
    else if (item.type === "mcp_tool_call")
      this.emit(
        task,
        "tool",
        `${item.server} · ${item.tool} · ${item.status}${item.error?.message ? "\n" + item.error.message : ""}${item.result?.isError ? "\n" + JSON.stringify(item.result.content) : ""}`,
      );
    else if (item.type === "command_execution")
      this.emit(
        task,
        "tool",
        `${item.command}\n${item.aggregated_output ?? ""}`,
      );
    else if (item.type === "file_change")
      this.emit(task, "tool", "工作文件已更新");
    else if (item.type === "error") this.emit(task, "status", item.message);
  }
  private async runLocal(
    task: AgentTask,
    agentId: AgentId,
    prompt: string,
    cli: ReturnType<AgentHostOptions["cli"]>,
    signal: AbortSignal,
    test: boolean,
  ) {
    let agent = this.agents.find((item) => item.id === agentId);
    if (!agent) {
      await this.scan();
      agent = this.agents.find((item) => item.id === agentId);
    }
    if (!agent?.path) throw new Error("未找到所选本机 Agent，请先安装并登录。");
    if (agentId === "codex") {
      const args = [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--cd",
        task.workspace,
        "-c",
        "project_root_markers=[]",
        "-c",
        'web_search="disabled"',
      ];
      if (!test)
        args.push(
          "-c",
          `mcp_servers.showai=${tomlTable(this.mcp(cli, task.projectId))}`,
        );
      args.push(prompt);
      let complete = false;
      const result = await execute(agent.path, args, {
        signal,
        timeout: test ? 120000 : 15 * 60 * 1000,
        onLine: (line) => {
          const event = JSON.parse(line);
          if (event.type === "thread.started") task.threadId = event.thread_id;
          if (event.type === "turn.completed") complete = true;
          if (event.type === "error" || event.type === "turn.failed")
            this.emit(
              task,
              "error",
              event.message ?? event.error?.message ?? "Agent 执行失败",
            );
          if (event.type === "item.completed")
            this.codexEvent(task, event.item);
        },
      });
      if (result.code !== 0 || !complete)
        throw new Error(result.stderr || "本机 Codex 未完成调用。");
      return;
    }
    if (agentId === "claude") {
      const args = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
      ];
      if (!test)
        args.push(
          "--mcp-config",
          JSON.stringify({
            mcpServers: { showai: this.mcp(cli, task.projectId) },
          }),
          "--allowedTools",
          "mcp__showai__*",
        );
      let complete = false;
      const result = await execute(agent.path, args, {
        cwd: task.workspace,
        signal,
        timeout: test ? 120000 : 15 * 60 * 1000,
        onLine: (line) => {
          const event = JSON.parse(line);
          if (event.type === "result") {
            if (event.is_error) this.emit(task, "error", event.result);
            else {
              complete = true;
              this.emit(task, "message", event.result);
            }
          }
        },
      });
      if (result.code !== 0 || !complete)
        throw new Error(result.stderr || "Claude Code 未完成调用。");
      return;
    }
    const definition = definitions.find((item) => item.id === agentId)!;
    const args =
      agentId === "kimi"
        ? [
            "--skills-dir",
            join(this.options.pluginRoot(), "skills"),
            ...definition.acp!,
          ]
        : definition.acp!;
    const rpc = new RpcProcess(
      agent.path,
      args,
      task.workspace,
      (method, params) => {
        if (method === "session/update") {
          const update = params.update;
          if (
            update.sessionUpdate === "agent_message_chunk" &&
            update.content?.type === "text"
          ) {
            const last = task.events.at(-1);
            if (last?.type === "message") last.text += update.content.text;
            else this.emit(task, "message", update.content.text);
          } else if (
            ["tool_call", "tool_call_update"].includes(update.sessionUpdate)
          )
            this.emit(
              task,
              "tool",
              update.title ?? update.toolCallId ?? "工具执行中",
            );
        }
      },
      signal,
      {
        onRequest: async (method, params) => {
          if (method !== "session/request_permission")
            throw new Error("Unsupported client request.");
          const id = randomUUID();
          const options = (params.options ?? [])
            .filter((item: any) =>
              ["allow_once", "reject_once"].includes(item.kind),
            )
            .map((item: any) => ({
              id: item.optionId,
              name: item.name,
              kind: item.kind,
            }));
          task.approvals ??= [];
          task.approvals.push({
            id,
            title: params.toolCall?.title ?? "Agent 请求执行工具",
            options,
          });
          const selected = await new Promise<string | null>((resolve) => {
            this.permissions.set(id, resolve);
            signal.addEventListener("abort", () => resolve(null), {
              once: true,
            });
          });
          this.permissions.delete(id);
          task.approvals = task.approvals.filter((item) => item.id !== id);
          return {
            outcome: selected
              ? { outcome: "selected", optionId: selected }
              : { outcome: "cancelled" },
          };
        },
      },
    );
    const timer = setTimeout(() => rpc.close(), test ? 120000 : 15 * 60 * 1000);
    try {
      await rpc.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "showai", version: "0.9.0" },
      });
      const mcp = this.mcp(cli, task.projectId);
      const session = await rpc.request("session/new", {
        cwd: task.workspace,
        mcpServers: test
          ? []
          : [
              {
                name: "showai",
                command: mcp.command,
                args: mcp.args,
                env: Object.entries(mcp.env).map(([name, value]) => ({
                  name,
                  value,
                })),
              },
            ],
      });
      task.threadId = session.sessionId;
      const result = await rpc.request("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      if (result.stopReason !== "end_turn")
        throw new Error(`Agent 未完成任务：${result.stopReason}`);
    } finally {
      clearTimeout(timer);
      rpc.close();
      for (const approval of task.approvals ?? [])
        this.permissions.get(approval.id)?.(null);
    }
  }
  cancel(id: string) {
    this.controllers.get(id)?.abort();
  }
  async readTaskFile(id: string, path: string) {
    await this.loadTasks();
    const task = this.tasks.find((item) => item.id === id);
    if (!task) throw new Error("任务记录不存在。");
    const root = await realpath(task.workspace),
      file = await realpath(resolve(root, path));
    if (!file.startsWith(root + sep))
      throw new Error("只能下载此任务工作区内的文件。");
    const info = await stat(file);
    if (!info.isFile() || info.size > 24 * 1024 * 1024)
      throw new Error("文件下载上限为 24 MB。");
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".pdf": "application/pdf",
      ".json": "application/json",
      ".md": "text/markdown",
      ".txt": "text/plain",
      ".csv": "text/csv",
    };
    return {
      name: basename(file),
      mime: mime[extname(file).toLowerCase()] ?? "application/octet-stream",
      base64: (await readFile(file)).toString("base64"),
    };
  }
  close() {
    this.chatgpt.cancel();
    for (const controller of this.controllers.values()) controller.abort();
  }
  async action(action: string, args: Record<string, unknown>) {
    switch (action) {
      case "agent:status":
        return this.status(
          args.taskId ? z.string().uuid().parse(args.taskId) : undefined,
        );
      case "agent:scan":
        return this.scan();
      case "agent:settings":
        return this.save(args.settings);
      case "agent:source":
        return this.saveSource(args.source, args.apiKey);
      case "agent:serverResources":
        if (!this.options.resources)
          throw new Error("服务器资源管理尚未连接。");
        return this.options.resources.list();
      case "agent:addServerResource":
        return this.addServerResource(z.string().parse(args.id));
      case "agent:publishSource":
        return this.publishSource(
          z.string().uuid().parse(args.id),
          z.string().uuid().parse(args.connectionId),
        );
      case "agent:removeSource":
        return this.removeSource(z.string().uuid().parse(args.id));
      case "agent:install":
        this.installer.start();
        void this.installer
          .wait()
          .then(() => this.prepareIsolation())
          .catch((error: Error) => {
            this.installer.state = {
              ...this.installer.state,
              state: "failed",
              error: error.message,
              progress: "独立运行时配置失败",
            };
          });
        return this.status();
      case "agent:models":
        return this.models(z.string().uuid().parse(args.id));
      case "agent:authorize":
        return this.authorize(z.string().uuid().parse(args.id));
      case "agent:cancelAuth":
        this.chatgpt.cancel();
        return this.status();
      case "agent:disconnect":
        await this.chatgpt.disconnect(z.string().uuid().parse(args.id));
        return this.status();
      case "agent:start":
        return this.start(args);
      case "agent:cancel":
        this.cancel(z.string().uuid().parse(args.id));
        return this.status();
      case "agent:readFile":
        return this.readTaskFile(
          z.string().uuid().parse(args.id),
          z.string().max(8192).parse(args.path),
        );
      case "agent:permission": {
        const id = z.string().uuid().parse(args.id),
          option = args.option === null ? null : z.string().parse(args.option);
        const approval = this.tasks
          .flatMap((task) => task.approvals ?? [])
          .find((item) => item.id === id);
        if (
          !approval ||
          (option && !approval.options.some((item) => item.id === option))
        )
          throw new Error("此操作确认已失效。");
        this.permissions.get(id)?.(option);
        return this.status();
      }
      default:
        throw new Error(`Unknown Agent action: ${action}`);
    }
  }
}
export const agentActions = new Set([
  "agent:serverResources",
  "agent:addServerResource",
  "agent:publishSource",
  "agent:status",
  "agent:scan",
  "agent:settings",
  "agent:source",
  "agent:removeSource",
  "agent:install",
  "agent:models",
  "agent:authorize",
  "agent:cancelAuth",
  "agent:disconnect",
  "agent:start",
  "agent:cancel",
  "agent:readFile",
  "agent:permission",
]);
function tomlTable(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(tomlTable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .map(([key, child]) => `${JSON.stringify(key)}=${tomlTable(child)}`)
      .join(",")}}`;
  return String(value);
}
