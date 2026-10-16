import { CAPACITY, assertBytes } from "../portable/capacity.mjs";
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
  AgentConversation,
  AgentEvent,
  AgentHostStatus,
  AgentId,
  AgentSettings,
  AgentTask,
  AgentTurn,
  LocalAgent,
  ModelSource,
} from "./types";
import {
  ConversationStore,
  parseTarget,
  recap,
  summary,
  targetInstructions,
} from "./conversations";
import { diffDocuments } from "../core/diff";
import { readPageWrites, undoBaseline } from "./page-undo";
import { translator } from "../i18n";
import agentHostMessages from "../i18n/messages/agentHost";

const t = translator(agentHostMessages);

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
  runtimeRoot?: string;
  oauthRedirectUrl?: string;
  afterAuthorization?: () => Promise<void>;
  afterTurn?: (projectId: string, turn?: AgentTurn) => Promise<void>;
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
  readonly conversations: ConversationStore;
  constructor(readonly options: AgentHostOptions) {
    this.conversations = new ConversationStore(options.root);
    this.installer = new SdkInstaller(
      options.runtimeRoot ?? join(options.root, "runtime"),
    );
    this.chatgpt = new ChatGptConnection(
      options.root,
      options.broker ?? options.resources,
      options.oauthRedirectUrl,
      options.afterAuthorization,
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
      throw new Error(t("source.duplicateId"));
    if (
      settings.sourceId &&
      !settings.sources.some((source) => source.id === settings.sourceId)
    )
      throw new Error(t("source.selectExisting"));
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
        throw new Error(t("source.insecureUrl"));
      if (
        source.credential === "chatgpt" &&
        (source.provider !== "chatgpt" ||
          source.baseUrl !== "https://api.openai.com/v1" ||
          source.protocol !== "responses")
      )
        throw new Error(t("source.chatgptOfficialOnly"));
    }
    await writeProtected(join(this.options.root, "settings.json"), settings);
    return this.status();
  }
  async saveSource(input: unknown, apiKey?: unknown) {
    const source = sourceSchema.parse(input),
      settings = await this.settings();
    if (source.hosted && apiKey !== undefined)
      throw new Error(t("source.hostedCredential"));
    if (
      apiKey !== undefined &&
      (source.credential !== "api-key" ||
        typeof apiKey !== "string" ||
        apiKey.length > 8192)
    )
      throw new Error("Invalid API credential.");
    const previous = settings.sources.find((item) => item.id === source.id);
    if (previous && previous.credential !== source.credential)
      throw new Error(t("source.credentialTypeChanged"));
    if (
      this.tasks.some(
        (task) => task.state === "running" && task.sourceId === source.id,
      )
    )
      throw new Error(t("source.inUse"));
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
      throw new Error(t("source.stopTasksFirst"));
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
            detail: t("agent.notFound"),
            callable: null,
          };
        let version = "",
          auth: LocalAgent["auth"] = "unknown",
          detail = t("agent.found");
        try {
          const result = await execute(path, ["--version"], { timeout: 10000 });
          version = (result.stdout || result.stderr).trim().slice(0, 120);
          if (definition.id === "codex") {
            const result = await execute(path, ["login", "status"], {
              timeout: 10000,
            });
            auth = result.code === 0 ? "ready" : "missing";
            detail =
              auth === "ready" ? t("agent.codexReady") : t("agent.codexSignIn");
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
                ? t("agent.kimiConfigured")
                : t("agent.testToConfirm");
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
    if (!source) throw new Error(t("source.select"));
    return source;
  }
  async token(source: ModelSource, force = false) {
    if (source.hosted) {
      if (!this.options.resources) throw new Error(t("resources.notConnected"));
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
      throw new Error(t("source.saveApiKey"));
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
      throw new Error(t("source.modelsFailed", { status: response.status }));
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
    if (source.hosted) throw new Error(t("source.reauthorizeOnOrigin"));
    if (source.credential !== "chatgpt")
      throw new Error(t("source.usesApiKey"));
    const result = await this.chatgpt.start(id);
    await this.options.openUrl?.(result.url);
    return this.options.openUrl ? { pending: true } : result;
  }
  async addServerResource(id: string) {
    if (!this.options.resources) throw new Error(t("resources.notConnected"));
    const resource: ResolvedResource | undefined = (
      await this.options.resources.list()
    ).find((item) => item.id === id);
    if (!resource?.available || !resource.connected)
      throw new Error(t("resources.unavailable"));
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
    if (!this.options.resources) throw new Error(t("resources.notConnected"));
    if (
      this.chatgpt.state.state === "pending" ||
      this.tasks.some(
        (task) => task.state === "running" && task.sourceId === id,
      )
    )
      throw new Error(t("publish.finishFirst"));
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
          throw new Error(t("publish.alreadyHosted"));
        if (pending && pending.connectionId !== connectionId)
          throw new Error(t("publish.pendingElsewhere"));
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
            throw new Error(t("publish.authorizeLocally"));
          if (
            "refreshOwner" in saved &&
            (saved.refreshOwner !== "local" ||
              !saved.scopes.includes("chatgpt.tokens.use.direct"))
          )
            throw new Error(t("publish.authorizeChatgptPlan"));
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
  async prepareRuntime() {
    await this.prepareIsolation();
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
          t("isolation.pluginInstallFailed", {
            detail: result.stderr || result.stdout,
          }),
        );
      if (args[1] === "add")
        installedPath = JSON.parse(result.stdout).installedPath;
    }
    const listing = await execute(binary, ["plugin", "list", "--json"], {
      env,
      cwd: this.workspaceRoot,
      timeout: 30000,
    });
    if (listing.code !== 0) throw new Error(t("isolation.verifyPluginFailed"));
    const plugins = JSON.parse(listing.stdout);
    if (
      plugins.installed?.length !== 1 ||
      plugins.installed[0].pluginId !== "showai@showai-embedded" ||
      !plugins.installed[0].installed ||
      !plugins.installed[0].enabled
    )
      throw new Error(t("isolation.onlyShowai"));
    if (typeof installedPath !== "string")
      throw new Error(t("isolation.pluginOutside"));
    installedPath = await realpath(installedPath);
    const ownedHome = await realpath(env.CODEX_HOME);
    if (!installedPath.startsWith(ownedHome + sep))
      throw new Error(t("isolation.pluginOutside"));
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
      const expectedSkills = new Set(
        await Promise.all(
          (
            await readdir(join(installedPath, "skills"), {
              withFileTypes: true,
            })
          )
            .filter((entry) => entry.isDirectory())
            .map((entry) =>
              realpath(join(installedPath, "skills", entry.name, "SKILL.md")),
            ),
        ),
      );
      const enabledPaths = await Promise.all(
        enabled.map((skill: any) => realpath(String(skill.path))),
      );
      if (
        expectedSkills.size === 0 ||
        enabledPaths.length !== expectedSkills.size ||
        enabledPaths.some((path) => !expectedSkills.has(path))
      )
        throw new Error(t("isolation.skillsFailed"));
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
    this.touch(task);
  }
  /** Running conversation turns persist their events incrementally. */
  private touch(task: AgentTask) {
    const conversation =
      "conversationId" in task
        ? this.conversations.owner(task as AgentTurn)
        : undefined;
    if (!conversation) return;
    conversation.updatedAt = new Date().toISOString();
    this.conversations.schedule(conversation);
  }
  private persist(task: AgentTask) {
    const conversation =
      "conversationId" in task
        ? this.conversations.owner(task as AgentTurn)
        : undefined;
    return conversation
      ? this.conversations.save(conversation)
      : writeProtected(
          join(this.options.root, "tasks", task.id + ".json"),
          task,
        );
  }
  private instructions(
    projectId: string,
    focus: string,
    workspace: string,
    componentCatalog: unknown,
    revision?: string,
  ) {
    return `You are working inside ShowAI. The host has supplied these verified selections: projectId=${projectId}${focus}. Operate only that project${focus ? " and focused page" : ""}. Use project_context with knownCatalogRevision=${revision} to confirm the MCP binding without repeating the supplied index, then read the chosen page. Use the connected ShowAI MCP tools for all library reads and writes. Do not invoke authoring CLI commands or switch connections if MCP fails. Read current hash/revision before saving; preserve conflicting drafts. Do not edit raw library files. Work files belong in ${workspace}. This host displays text and file links, without inline HTML rendering. For a requested preview, use page_present with the requested stable block IDs and return its delivery file link; do not claim it is displayed in the conversation. Read the ShowAI authoring guide before editing. For status-only requests query project_sync_status; do not run project_sync unless the user requests synchronization. Component directory (complete; reuse this index until its revision changes): ${JSON.stringify(componentCatalog)}\nFor page work read selected component guides; for component work read development guidance before source.`;
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
                  error: t("task.interrupted"),
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
      label: test ? t("task.connectionTest") : prompt.slice(0, 100),
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
      : `${this.instructions(projectId, pageId ? `, pageId=${pageId}` : "", workspace, componentCatalog, componentCatalog?.revision)} The user explicitly requests:\n${prompt}`;
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
      test ? t("task.checkingModel") : t("task.connecting"),
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
        if (controller.signal.aborted) throw new Error(t("task.stopped"));
        if (
          test &&
          !task.events
            .filter((event) => event.type === "message")
            .map((event) => event.text)
            .join("")
            .includes("SHOWAI_AGENT_READY")
        )
          throw new Error(t("task.unexpectedTestResult"));
        task.state = "completed";
        if (test && settings.mode === "local") this.markTest(localAgent, true);
        this.emit(
          task,
          "status",
          test ? t("task.testPassed") : t("task.completed"),
        );
      })
      .catch((error: Error) => {
        task.state = controller.signal.aborted ? "cancelled" : "failed";
        task.error = controller.signal.aborted
          ? t("task.stopped")
          : error.message;
        if (
          settings.mode === "local" &&
          /Authentication required|login_required/i.test(task.error)
        ) {
          const agent = this.agents.find((item) => item.id === localAgent);
          if (agent) {
            agent.auth = "missing";
            agent.detail = t("agent.signInExpired");
          }
          task.error = t("task.signInRequired");
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
  /** Backends that continue their own session receive only the new request. */
  private resumable(conversation: AgentConversation) {
    return (
      !!conversation.threadId &&
      (conversation.mode === "api" ||
        conversation.localAgent === "codex" ||
        conversation.localAgent === "claude")
    );
  }
  async send(
    args: {
      projectId?: unknown;
      conversationId?: unknown;
      prompt?: unknown;
      target?: unknown;
    },
    reserved?: { turnId: string },
  ): Promise<AgentConversation> {
    const projectId = assertId(z.string().parse(args.projectId));
    const prompt = z.string().trim().min(1).max(24000).parse(args.prompt);
    const target = parseTarget(args.target);
    const library = this.options.library();
    await library.listPages(projectId);
    const now = new Date().toISOString();
    let conversation: AgentConversation;
    if (args.conversationId) {
      conversation = await this.conversations.get(
        projectId,
        z.string().uuid().parse(args.conversationId),
      );
      if (conversation.turns.some((turn) => turn.state === "running"))
        throw new Error(t("conversation.busy"));
    } else {
      const settings = await this.settings();
      const id = randomUUID();
      conversation = {
        id,
        projectId,
        title: prompt.replace(/\s+/g, " ").slice(0, 60),
        mode: settings.mode,
        sourceId: settings.mode === "api" ? settings.sourceId : undefined,
        localAgent: settings.mode === "local" ? settings.localAgent : undefined,
        workspace: join(this.workspaceRoot, projectId, id),
        createdAt: now,
        updatedAt: now,
        turns: [],
      };
    }
    const source =
      conversation.mode === "api"
        ? await this.source(conversation.sourceId ?? "").catch(() => {
            throw new Error(t("conversation.sourceMissing"));
          })
        : undefined;
    const page = target.pageId
      ? await library.readPage(projectId, target.pageId, { checkpoint: false })
      : undefined;
    const componentCatalog = await new AgentService({
      root: library.root,
    }).componentContext(projectId);
    await mkdir(conversation.workspace, { recursive: true, mode: 0o700 });
    const turn: AgentTurn = {
      id: reserved ? z.string().uuid().parse(reserved.turnId) : randomUUID(),
      conversationId: conversation.id,
      projectId,
      pageId: target.pageId,
      label: prompt.slice(0, 100),
      mode: conversation.mode,
      sourceId: conversation.sourceId,
      localAgent: conversation.localAgent,
      state: "running",
      startedAt: now,
      workspace: conversation.workspace,
      threadId: conversation.threadId,
      events: [],
      prompt,
      target,
      pageTitle: page?.document.title,
      baseHash: page?.hash,
      wrotePage: false,
    };
    if (page) await this.conversations.saveBase(turn, projectId, page.document);
    const resumable = this.resumable(conversation);
    const header =
      resumable && conversation.catalogRevision === componentCatalog.revision
        ? `Continue this ShowAI conversation in projectId=${projectId}. The MCP binding, work directory ${conversation.workspace}, component directory revision ${componentCatalog.revision} and earlier ShowAI rules are unchanged.`
        : this.instructions(
            projectId,
            "",
            conversation.workspace,
            componentCatalog,
            componentCatalog.revision,
          );
    const history =
      !resumable && conversation.turns.length
        ? recap(conversation, turn.id)
        : "";
    const instructions = `${header}\n${targetInstructions(target, page?.document.title)}\n${history}The user explicitly requests:\n${prompt}`;
    conversation.catalogRevision = componentCatalog.revision;
    conversation.turns.push(turn);
    conversation.updatedAt = now;
    this.conversations.add(conversation);
    const controller = new AbortController();
    this.controllers.set(turn.id, controller);
    this.emit(turn, "status", t("task.connecting"));
    if (history) this.emit(turn, "status", t("conversation.recapped"));
    await this.conversations.save(conversation);
    const cli = this.options.cli();
    const run =
      conversation.mode === "api"
        ? this.runSdk(
            turn,
            instructions,
            cli,
            controller.signal,
            conversation.threadId,
            false,
            source!,
          )
        : this.runLocal(
            turn,
            conversation.localAgent ?? "codex",
            instructions,
            cli,
            controller.signal,
            false,
            resumable ? conversation.threadId : undefined,
          );
    // Record the page result before the state leaves "running"; pollers stop at that point.
    void run
      .then(
        () =>
          controller.signal.aborted ? new Error(t("task.stopped")) : undefined,
        (error: Error) => error,
      )
      .then(async (failure) => {
        if (page)
          await library
            .readPage(projectId, page.document.id, { checkpoint: false })
            .then(async (current) => {
              turn.resultHash = current.hash;
              const writes = (
                await readPageWrites(this.conversations.writesPath(turn))
              ).filter(
                (write) =>
                  write.projectId === projectId &&
                  write.pageId === page.document.id,
              );
              turn.wrotePage = writes.length > 0;
              if (writes.length)
                turn.changedBlockIds = [
                  ...new Set(
                    writes
                      .flatMap((write) =>
                        diffDocuments(write.before, write.after),
                      )
                      .flatMap((change) =>
                        "blockId" in change && change.type !== "block.removed"
                          ? [change.blockId]
                          : [],
                      ),
                  ),
                ].slice(0, 200);
            })
            .catch((error: Error) => {
              failure ??= error;
            });
        if (this.options.afterTurn) {
          await this.options
            .afterTurn(projectId, turn)
            .catch((error: Error) => {
              failure ??= error;
            });
        }
        turn.finishedAt = new Date().toISOString();
        if (turn.threadId) conversation.threadId = turn.threadId;
        conversation.updatedAt = turn.finishedAt;
        if (!failure) {
          this.emit(turn, "status", t("task.completed"));
          turn.state = "completed";
        } else {
          turn.error = controller.signal.aborted
            ? t("task.stopped")
            : failure.message;
          if (
            conversation.mode === "local" &&
            /Authentication required|login_required|Failed to authenticate|OAuth session expired/i.test(
              `${turn.error}\n${turn.events.map((event) => event.text).join("\n")}`,
            )
          )
            turn.error = t("task.signInRequired");
          this.emit(turn, "error", turn.error);
          turn.state = controller.signal.aborted ? "cancelled" : "failed";
        }
        this.controllers.delete(turn.id);
        await this.conversations.save(conversation);
      })
      .catch((error: Error) =>
        console.error("ShowAI Agent conversation persistence:", error.message),
      );
    return conversation;
  }
  /** Restore the focused page to its state before this turn, if nothing changed since. */
  async undoTurn(projectId: string, conversationId: string, turnId: string) {
    const conversation = await this.conversations.get(
      projectId,
      conversationId,
    );
    const turn = conversation.turns.find((item) => item.id === turnId);
    if (turn?.state === "running") throw new Error(t("turn.undoRunning"));
    if (!turn?.pageId || !turn.baseHash || !turn.resultHash || turn.undone)
      throw new Error(t("turn.undoUnavailable"));
    const library = this.options.library();
    const current = await library.readPage(projectId, turn.pageId, {
      checkpoint: false,
    });
    if (current.hash !== turn.resultHash)
      throw new Error(t("turn.undoChanged"));
    const writes = (
      await readPageWrites(this.conversations.writesPath(turn))
    ).filter(
      (write) => write.projectId === projectId && write.pageId === turn.pageId,
    );
    if (!writes.length) throw new Error(t("turn.undoUnavailable"));
    const base = undoBaseline(writes, current.hash);
    if (!base) throw new Error(t("turn.undoChanged"));
    await new AgentService({ root: library.root }).savePage(
      projectId,
      turn.pageId,
      base,
      current.hash,
      undefined,
      undefined,
      current.revision,
    );
    turn.undone = true;
    conversation.updatedAt = new Date().toISOString();
    await this.conversations.save(conversation);
    return conversation;
  }
  private markTest(id: AgentId, callable: boolean) {
    const item = this.agents.find((item) => item.id === id);
    if (item) {
      item.callable = callable;
      item.testedAt = new Date().toISOString();
      if (callable) item.auth = "ready";
    }
  }
  private mcp(
    cli: ReturnType<AgentHostOptions["cli"]>,
    projectId: string,
    task?: AgentTask,
  ) {
    return {
      command: cli.command,
      args: [...cli.args, "mcp", "--project", projectId],
      env: {
        ...cli.env,
        ...(task && "conversationId" in task
          ? {
              SHOWAI_AGENT_PAGE_WRITES: this.conversations.writesPath(
                task as AgentTurn,
              ),
            }
          : {}),
      },
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
    if (!source) throw new Error(t("source.select"));
    if (!source.model) throw new Error(t("task.chooseModel"));
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
            : { mcp_servers: { showai: this.mcp(cli, task.projectId, task) } }),
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
          await this.persist(task);
        }
        if (event.type === "turn.completed") complete = true;
        if (event.type === "error" || event.type === "turn.failed")
          throw new Error(
            event.message ?? event.error?.message ?? t("task.agentFailed"),
          );
        if (event.type === "item.completed" || event.type === "item.updated")
          this.codexEvent(task, event.item, event.type === "item.completed");
      }
      if (!complete) throw new Error(t("task.turnIncomplete"));
    } finally {
      gateway.close();
    }
  }
  private codexEvent(task: AgentTask, item: any, completed = true) {
    const event = (type: AgentEvent["type"], text: string) => {
      if (typeof text !== "string" || !text) return;
      const existing =
        typeof item.id === "string"
          ? [...task.events].reverse().find((value) => value.itemId === item.id)
          : undefined;
      const state =
        item.status === "failed"
          ? "failed"
          : completed || item.status === "completed"
            ? "completed"
            : "running";
      if (existing) {
        existing.text = text.slice(0, 32000);
        existing.state = state;
        this.touch(task);
      } else {
        this.emit(task, type, text);
        const saved = task.events.at(-1);
        if (saved) {
          saved.itemId = item.id;
          saved.state = state;
        }
      }
    };
    if (item.type === "agent_message") event("message", item.text);
    else if (item.type === "mcp_tool_call")
      event(
        "tool",
        `${item.server} · ${item.tool} · ${item.status}${item.error?.message ? "\n" + item.error.message : ""}${item.result?.isError ? "\n" + JSON.stringify(item.result.content) : ""}`,
      );
    else if (item.type === "command_execution")
      event("tool", `${item.command}\n${item.aggregated_output ?? ""}`);
    else if (item.type === "file_change") event("tool", t("task.filesUpdated"));
    else if (item.type === "error") this.emit(task, "status", item.message);
  }
  private async runLocal(
    task: AgentTask,
    agentId: AgentId,
    prompt: string,
    cli: ReturnType<AgentHostOptions["cli"]>,
    signal: AbortSignal,
    test: boolean,
    threadId?: string,
  ) {
    let agent = this.agents.find((item) => item.id === agentId);
    if (!agent) {
      await this.scan();
      agent = this.agents.find((item) => item.id === agentId);
    }
    if (!agent?.path) throw new Error(t("task.agentMissing"));
    if (agentId === "codex") {
      // `exec resume` takes no --sandbox/--cd; the same settings go through config and cwd.
      const args = threadId
        ? [
            "exec",
            "resume",
            "--json",
            "--skip-git-repo-check",
            "-c",
            'sandbox_mode="workspace-write"',
          ]
        : [
            "exec",
            "--json",
            "--skip-git-repo-check",
            "--sandbox",
            "workspace-write",
            "--cd",
            task.workspace,
          ];
      args.push("-c", "project_root_markers=[]", "-c", 'web_search="disabled"');
      if (!test)
        args.push(
          "-c",
          `mcp_servers.showai=${tomlTable(this.mcp(cli, task.projectId, task))}`,
        );
      if (threadId) args.push(threadId);
      args.push(prompt);
      let complete = false;
      const result = await execute(agent.path, args, {
        cwd: task.workspace,
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
              event.message ?? event.error?.message ?? t("task.agentFailed"),
            );
          if (event.type === "item.completed" || event.type === "item.updated")
            this.codexEvent(task, event.item, event.type === "item.completed");
        },
      });
      if (result.code !== 0 || !complete)
        throw new Error(result.stderr || t("task.codexIncomplete"));
      return;
    }
    if (agentId === "claude") {
      const args = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
      ];
      // Claude Code stores sessions per cwd; a conversation keeps one workspace.
      if (!test) {
        if (threadId) args.push("--resume", threadId);
        else {
          task.threadId = randomUUID();
          args.push("--session-id", task.threadId);
        }
      }
      if (!test)
        args.push(
          "--mcp-config",
          JSON.stringify({
            mcpServers: { showai: this.mcp(cli, task.projectId, task) },
          }),
          "--allowedTools",
          "mcp__showai__*",
        );
      let complete = false;
      let replied = false;
      let opening = false;
      let streamed = false;
      const result = await execute(agent.path, args, {
        cwd: task.workspace,
        signal,
        timeout: test ? 120000 : 15 * 60 * 1000,
        onLine: (line) => {
          const event = JSON.parse(line);
          if (event.type === "stream_event") {
            const part = event.event;
            if (
              part?.type === "content_block_start" &&
              part.content_block?.type === "text"
            )
              opening = true;
            else if (
              part?.type === "content_block_delta" &&
              part.delta?.type === "text_delta" &&
              part.delta.text
            ) {
              streamed = replied = true;
              const last = task.events.at(-1);
              if (!opening && last?.type === "message") {
                last.text = (last.text + part.delta.text).slice(0, 32000);
                this.touch(task);
              } else this.emit(task, "message", part.delta.text);
              opening = false;
            }
          } else if (event.type === "assistant")
            for (const block of event.message?.content ?? []) {
              if (block.type === "text" && !streamed && block.text) {
                replied = true;
                this.emit(task, "message", block.text);
              } else if (block.type === "tool_use")
                this.emit(task, "tool", toolLabel(block.name));
            }
          else if (event.type === "user")
            for (const block of event.message?.content ?? [])
              if (block.type === "tool_result" && block.is_error)
                this.emit(
                  task,
                  "tool",
                  String(
                    typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content),
                  ).slice(0, 2000),
                );
          if (event.type === "result") {
            if (event.is_error) this.emit(task, "error", event.result);
            else {
              complete = true;
              if (!replied) this.emit(task, "message", event.result);
            }
          }
        },
      });
      if (result.code !== 0 || !complete)
        throw new Error(result.stderr || t("task.claudeIncomplete"));
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
              update.title ?? update.toolCallId ?? t("task.toolRunning"),
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
            title: params.toolCall?.title ?? t("task.toolPermission"),
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
      const mcp = this.mcp(cli, task.projectId, task);
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
        throw new Error(t("task.stopReason", { reason: result.stopReason }));
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
    const task =
      this.tasks.find((item) => item.id === id) ??
      this.conversations.findTurn(id);
    if (!task) throw new Error(t("task.notFound"));
    const root = await realpath(task.workspace),
      file = await realpath(resolve(root, path));
    if (!file.startsWith(root + sep))
      throw new Error(t("task.fileOutsideWorkspace"));
    const info = await stat(file);
    if (!info.isFile()) throw new Error(t("task.filesOnly"));
    assertBytes("Agent delivery file", info.size, CAPACITY.artifactBytes);
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
          throw new Error(t("resources.notConnected"));
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
              progress: t("isolation.configFailed"),
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
      case "agent:send":
        return this.send(args);
      case "agent:conversations":
        return (
          await this.conversations.list(
            assertId(z.string().parse(args.projectId)),
          )
        ).map(summary);
      case "agent:conversation":
        return this.conversations.get(
          assertId(z.string().parse(args.projectId)),
          z.string().uuid().parse(args.id),
        );
      case "agent:turn": {
        const conversation = await this.conversations.get(
          assertId(z.string().parse(args.projectId)),
          z.string().uuid().parse(args.conversationId),
        );
        const turn = conversation.turns.find((item) => item.id === args.id);
        if (!turn) throw new Error(t("conversation.notFound"));
        return { turn, threadId: conversation.threadId };
      }
      case "agent:undo":
        return this.undoTurn(
          assertId(z.string().parse(args.projectId)),
          z.string().uuid().parse(args.conversationId),
          z.string().uuid().parse(args.id),
        );
      case "agent:deleteConversation":
        await this.conversations.remove(
          assertId(z.string().parse(args.projectId)),
          z.string().uuid().parse(args.id),
        );
        return null;
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
        const approval = [
          ...this.tasks,
          ...this.conversations.running().flatMap((item) => item.turns),
        ]
          .flatMap((task) => task.approvals ?? [])
          .find((item) => item.id === id);
        if (
          !approval ||
          (option && !approval.options.some((item) => item.id === option))
        )
          throw new Error(t("task.approvalExpired"));
        this.permissions.get(id)?.(option);
        return args.conversation ? null : this.status();
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
  "agent:send",
  "agent:conversations",
  "agent:conversation",
  "agent:turn",
  "agent:undo",
  "agent:deleteConversation",
  "agent:cancel",
  "agent:readFile",
  "agent:permission",
]);
/** `mcp__showai__page_apply` reads as `showai · page_apply`. */
function toolLabel(name: string) {
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  return match ? `${match[1]} · ${match[2]}` : name;
}
function tomlTable(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(tomlTable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .map(([key, child]) => `${JSON.stringify(key)}=${tomlTable(child)}`)
      .join(",")}}`;
  return String(value);
}
