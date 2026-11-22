import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { syncManager } from "../../sync/manager";
import {
  flag,
  hiddenText,
  hiddenFlag,
  option,
  requireCount,
  text,
  type Arguments,
  type CommandDeclaration,
} from "./command";
import { readJson } from "./inputs";

async function credential(
  args: Arguments,
  fileOption: string,
  environment: string,
) {
  const path = option(args, fileOption);
  return path
    ? (await readFile(resolve(path), "utf8")).trim()
    : process.env[environment];
}

const loadBrowser = () => import("../../browser/launch");

const sync = (
  actions: string[],
  options: CommandDeclaration["options"],
  run: CommandDeclaration["run"],
): CommandDeclaration => ({
  command: "sync",
  actions,
  options,
  access: actions[0] === "status" ? "read" : "write",
  ownTransaction: true,
  run,
});

export const connectionCommands: CommandDeclaration[] = [
  {
    command: "serve",
    options: { port: text, "no-open": flag, "dsh-origin": hiddenText, "linked-workbench": hiddenText, "detach-workbench": hiddenFlag },
    help: ["serve [--home PATH] [--port PORT] [--no-open]"],
    async run(args) {
      requireCount(args, 1);
      const { runBrowser } = await loadBrowser();
      await runBrowser({
        home: option(args, "home"),
        port: option(args, "port"),
        dshOrigin: option(args, "dsh-origin"),
        linkedWorkbench: option(args, "linked-workbench"),
        detachWorkbench: !!args.options["detach-workbench"],
        open: !args.options["no-open"],
        json: !!args.options.json,
      });
      return undefined;
    },
  },
  {
    command: "mcp",
    options: { templates: text, "presentation-directory": text, public: flag },
    help: [
      "mcp [--project PROJECT] [--templates ID[@VERSION],ID] [--presentation-directory PATH]",
      "mcp --public",
    ],
    async run(args, { service, project }) {
      if (args.options.public) {
        requireCount(args, 1);
        if (option(args, "project") || option(args, "templates"))
          throw new Error(
            "Public MCP does not accept project/session template bindings. Use public catalogs and the installed show-document Skill.",
          );
        const { startPublicMcp } = await import("../mcp");
        await startPublicMcp(service.store.root);
        return undefined;
      }
      requireCount(args, 1);
      let sessionTemplates:
        import("../template-workflow").TemplateSelection[] | undefined;
      if (option(args, "templates")) {
        if (!option(args, "project"))
          throw new Error(
            "MCP startup --templates requires --project. Library/HTTP clients select templates explicitly with template_context.",
          );
        const selections = option(args, "templates")!
          .split(",")
          .filter(Boolean)
          .map((value) => {
            const [id, version, ...extra] = value.split("@");
            if (extra.length || !id || (value.includes("@") && !version))
              throw new Error("Invalid --templates selection.");
            return { id, ...(version ? { version } : {}) };
          });
        sessionTemplates = (
          await service.templateContext(await project(), selections)
        ).context.templates;
      }
      const presentationDirectory = option(args, "presentation-directory")
        ? resolve(option(args, "presentation-directory")!)
        : undefined;
      if (!option(args, "project")) {
        const { startLibraryMcp } = await import("../mcp-library");
        const home = service.store.root;
        const cursor = process.env.SHOWAI_CURSOR_IDE_WORKBENCH === "1";
        const profile = cursor ? join(home, "local", "cursor-workbench")
          : process.env.SHOWAI_CODEX_WORKBENCH_PROFILE;
        const qoderProfile = process.env.SHOWAI_QODER_WORKBENCH === "1"
          ? join(home, "local", "qoder-workbench")
          : undefined;
        const workbench = profile || qoderProfile
          ? (await import("../codex-workbench")).codexWorkbenchConnection(
              async (key) => (await loadBrowser()).startCodexWorkbenchBrowser({
                home, profile: profile ?? qoderProfile!, key,
                host: profile ? "codex" : "qoder",
              }),
              service,
              presentationDirectory,
              cursor ? "cursor" : profile ? "codex" : "qoder",
            )
          : process.env.SHOWAI_ANTIGRAVITY_WORKBENCH === "1"
            ? (await import("../antigravity-workbench")).antigravityWorkbenchConnection(
                service,
                async (key) =>
                  (await loadBrowser()).startAntigravityWorkbenchBrowser({
                    home,
                    profile: join(home, "local", "antigravity-workbench"),
                    key,
                  }),
              )
            : process.env.SHOWAI_LINKED_WORKBENCH === "1"
              ? (await import("../linked-workbench")).linkedWorkbenchConnection(
                  service,
                  async () => (await loadBrowser()).startLinkedWorkbenchBrowser(home),
                  presentationDirectory,
                )
              : undefined;
        await startLibraryMcp({ root: home, presentationDirectory, ...workbench });
      } else {
        const { startMcp } = await import("../mcp");
        await startMcp({
          root: service.store.root,
          projectId: await project(),
          presentationDirectory,
          sessionTemplates,
        });
      }
      return undefined;
    },
  },
  {
    command: "mcp",
    actions: ["serve"],
    options: {
      state: text,
      "public-url": text,
      "sync-server": text,
      port: text,
      "widget-domain": hiddenText,
      host: hiddenText,
      templates: hiddenText,
    },
    help: [
      "mcp serve --state DIRECTORY --public-url HTTPS_ORIGIN [--sync-server SERVER_ORIGIN] [--port 8789]",
    ],
    async run(args, { service }) {
      requireCount(args, 2);
      if (option(args, "templates"))
        throw new Error(
          "HTTP clients bind task templates explicitly with template_context, not server-wide --templates.",
        );
      const { startMcpHttpServer } = await import("../mcp-http");
      const running = await startMcpHttpServer({
        stateDirectory: resolve(
          option(args, "state") ??
            join(service.store.root, "local", "agent-server"),
        ),
        publicUrl: option(args, "public-url"),
        syncServers: option(args, "sync-server")?.split(",").filter(Boolean),
        widgetDomain: option(args, "widget-domain"),
        host: option(args, "host"),
        port: option(args, "port") ? Number(option(args, "port")) : undefined,
      });
      process.stdout.write(
        JSON.stringify({
          ok: true,
          data: {
            protocol: "showai-agent-http-v1",
            url: running.url + "/mcp",
            publicPresentation: true,
            privateProjects: !!option(args, "sync-server"),
          },
        }) + "\n",
      );
      const stop = () => {
        void running.close().then(
          () => process.exit(0),
          (error) => {
            console.error(error);
            process.exit(1);
          },
        );
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
      return undefined;
    },
  },
  sync(["status"], {}, async (_args, { service }) =>
    syncManager(service.store.root).status(),
  ),
  sync(["retained"], {}, async (_args, { service, project, id }) =>
    syncManager(service.store.root).retainedConflicts(id ?? (await project())),
  ),
  sync(
    ["connect"],
    {
      url: text,
      account: text,
      "password-file": text,
      "token-file": text,
      "registration-key-file": text,
      view: text,
      invite: text,
    },
    async (args, { service }) =>
      syncManager(service.store.root).connect({
        url: option(args, "url", true)!,
        account: option(args, "account"),
        password: await credential(args, "password-file", "SHOWAI_SERVER_PASSWORD"),
        token: await credential(args, "token-file", "SHOWAI_SERVER_TOKEN"),
        registrationKey: await credential(
          args,
          "registration-key-file",
          "SHOWAI_REGISTRATION_KEY",
        ),
        register: option(args, "view") === "register",
        invite: option(args, "invite"),
      }),
  ),
  sync(["default"], { connection: text }, async (args, { service }) =>
    syncManager(service.store.root).setDefault(option(args, "connection") ?? null),
  ),
  sync(["projects"], { connection: text }, async (args, { service }) =>
    syncManager(service.store.root).remoteProjects(
      option(args, "connection", true)!,
    ),
  ),
  sync(["attach"], { connection: text }, async (args, { service, project, id }) =>
    syncManager(service.store.root).attach(
      option(args, "connection", true)!,
      id ?? (await project()),
    ),
  ),
  sync(["join"], { connection: text, url: text }, async (args, { service }) =>
    syncManager(service.store.root).join(
      option(args, "connection", true)!,
      option(args, "url", true)!,
    ),
  ),
  sync(["subscribe"], { connection: text }, async (args, { service, id }) =>
    syncManager(service.store.root).subscribe(
      option(args, "connection", true)!,
      id,
    ),
  ),
  sync(["detach"], {}, async (_args, { service, project, id }) =>
    syncManager(service.store.root).detach(id ?? (await project())),
  ),
  sync(["account"], { connection: text }, async (args, { service, project, id }) =>
    syncManager(service.store.root).changeAccount(
      id ?? (await project()),
      option(args, "connection", true)!,
    ),
  ),
  sync(["run"], {}, async (args, { service }) =>
    syncManager(service.store.root).run(option(args, "project")),
  ),
  sync(["conflict"], {}, async (_args, { service, project, id }) =>
    syncManager(service.store.root).conflict(id ?? (await project())),
  ),
  sync(["resolve"], { input: text }, async (args, { service, project, id }) =>
    syncManager(service.store.root).resolveConflict(
      id ?? (await project()),
      (await readJson(option(args, "input", true)!)) as Record<
        string,
        "local" | "remote"
      >,
    ),
  ),
  sync(["dashboard"], { connection: text }, async (args, { service }) =>
    syncManager(service.store.root).dashboard(
      option(args, "connection", true)!,
      option(args, "project"),
    ),
  ),
  sync(["disconnect"], { connection: text }, async (args, { service }) =>
    syncManager(service.store.root).disconnect(option(args, "connection", true)!),
  ),
  {
    command: "sync",
    actions: ["*"],
    async run() {
      throw new Error(
        "Use sync status/connect/default/projects/attach/join/subscribe/detach/account/run/conflict/resolve/dashboard/disconnect.",
      );
    },
  },
];
