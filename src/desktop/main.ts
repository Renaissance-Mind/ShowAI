import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
} from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { watch, type FSWatcher } from "chokidar";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  realpath,
  stat,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { AgentService, errorResult } from "../agent/service";
import { assertExportDestination, exportPage } from "../agent/exporter";
import { assertId, CoreError, FileStore } from "../core/store";
import type { PageRecord, ProjectBinding } from "../core/model";
import {
  getComponent,
  blankDocument,
  getTemplate,
  importComponent,
  instantiateTemplate,
  instantiateTemplateRecord,
  promotePackage,
  forkPackage,
  previewPackageMerge,
  savePackageMerge,
  listBuiltinComponents,
  describeBuiltinComponent,
  listComponents,
  listTemplates,
  readComponentSource,
  resolveDocumentComponents,
  saveComponent,
  saveTemplate,
} from "../core/catalog";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import {
  preparePublication,
  verifyPublication,
  loadRemoteComponents,
} from "../core/publication";
import type {
  CatalogReadOptions,
  PackageRevisionRef,
  PackageMergeInput,
  EditablePackage,
  SaveTemplateInput,
} from "../components/custom/types";
import type { ComponentManifest, JsonSchema } from "../components/custom/types";
import type { DesktopChange, DesktopInfo, DesktopResponse } from "./bridge";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "..");
const windows = new Set<BrowserWindow>();
const actions = new Set([
  "app:info",
  "projects:list",
  "projects:create",
  "projects:rename",
  "projects:pin",
  "projects:remove",
  "folders:list",
  "folders:create",
  "folders:rename",
  "folders:pin",
  "folders:remove",
  "pages:list",
  "pages:get",
  "pages:create",
  "pages:save",
  "pages:duplicate",
  "pages:remove",
  "pages:rename",
  "pages:pin",
  "pages:move",
  "pages:import",
  "templates:list",
  "templates:get",
  "templates:save",
  "components:list",
  "components:get",
  "components:import",
  "components:source",
  "components:save",
  "components:createExample",
  "catalog:promote",
  "catalog:fork",
  "catalog:mergePreview",
  "catalog:mergeSave",
  "catalog:preparePublish",
  "catalog:verifyPublish",
  "dialog:openPage",
  "export:page",
  "export:site",
  "fs:reveal",
  "settings:chooseHome",
  "clipboard:write",
  "app:openPageWindow",
]);
let store: FileStore;
let service: AgentService;
let watcher: FSWatcher | undefined;
let notification: ReturnType<typeof setTimeout> | undefined;
let pendingDeepLink = process.argv.find((argument) =>
  argument.startsWith("showai://"),
);
const closeRequests = new Map<
  number,
  {
    requestId: string;
    resolve: (allow: boolean | null) => void;
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<boolean>;
  }
>();
let checkingQuit = false;
let allowedQuit = false;

app.setName("ShowAI");
if (process.env.SHOWAI_USER_DATA)
  app.setPath("userData", resolve(process.env.SHOWAI_USER_DATA));

function text(
  args: Record<string, unknown>,
  key: string,
  optional = false,
): string | undefined {
  const value = args[key];
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 10000)
    throw new CoreError("INVALID_DATA", `${key} must be non-empty text.`);
  return value;
}
const required = (args: Record<string, unknown>, key: string) =>
  text(args, key)!;
const projectId = (args: Record<string, unknown>) =>
  assertId(required(args, "projectId"));
const pageId = (args: Record<string, unknown>) =>
  assertId(required(args, "pageId"));

function boolean(args: Record<string, unknown>, key: string): boolean {
  if (typeof args[key] !== "boolean")
    throw new CoreError("INVALID_DATA", `${key} must be boolean.`);
  return args[key];
}

function parentFolder(args: Record<string, unknown>): string | null {
  return args.parentId === null || args.parentId === undefined
    ? null
    : assertId(required(args, "parentId"));
}

function catalogOptions(args: Record<string, unknown>): CatalogReadOptions {
  const scope = text(args, "scope", true);
  if (
    scope &&
    !["all", "project", "global", "published", "builtin"].includes(scope)
  )
    throw new CoreError("INVALID_DATA", "Unknown catalog scope.");
  return {
    scope: scope as CatalogReadOptions["scope"],
    version: text(args, "version", true),
    integrity: text(args, "integrity", true),
  };
}
function revisionArg(
  args: Record<string, unknown>,
  key = "ref",
): PackageRevisionRef {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CoreError(
      "INVALID_DATA",
      "An exact package revision is required.",
    );
  const ref = value as Record<string, unknown>;
  if (
    !["template", "component"].includes(String(ref.kind)) ||
    ["id", "version", "integrity"].some(
      (key) => typeof ref[key] !== "string" || !ref[key],
    )
  )
    throw new CoreError(
      "INVALID_DATA",
      "A revision needs kind, id, version and integrity.",
    );
  return value as PackageRevisionRef;
}
function componentDelivery(
  args: Record<string, unknown>,
): "bundled" | "remote" {
  if (args.components === undefined) return "bundled";
  if (args.components !== "bundled" && args.components !== "remote")
    throw new CoreError("INVALID_DATA", "Choose bundled or remote components.");
  return args.components;
}

async function validateDestination(
  projectId: string,
  parentId: string | null,
): Promise<void> {
  if (
    parentId !== null &&
    !(await store.listFolders(projectId)).some(
      (folder) => folder.id === parentId,
    )
  )
    throw new CoreError(
      "NOT_FOUND",
      "The destination folder is missing or archived.",
    );
}

async function optionalProject(
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const id = text(args, "projectId", true);
  if (id) await store.listPages(assertId(id));
  return id;
}

function pluginPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "plugin")
    : join(repository, "plugins", "showai");
}

function info(): DesktopInfo {
  return {
    home: store.root,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    cli: {
      command: process.execPath,
      args: [join(pluginPath(), "scripts", "cli.mjs")],
      env: { ELECTRON_RUN_AS_NODE: "1", SHOWAI_HOME: store.root },
    },
  };
}

function broadcast(type: DesktopChange["type"]): void {
  for (const window of windows)
    if (!window.isDestroyed())
      window.webContents.send("showai:changed", {
        type,
        home: store.root,
      } satisfies DesktopChange);
}

async function useHome(home?: string): Promise<void> {
  await watcher?.close();
  store = new FileStore(home);
  service = new AgentService({ root: store.root });
  await store.listProjects();
  watcher = watch(store.root, {
    ignoreInitial: true,
    depth: 9,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    ignored: (path) =>
      relative(store.root, path)
        .split(sep)
        .some(
          (part) =>
            ["snapshots", "exports", ".locks", "tmp", "node_modules"].includes(
              part,
            ) || part.endsWith(".tmp"),
        ),
  });
  watcher.on("all", () => {
    clearTimeout(notification);
    notification = setTimeout(() => broadcast("files"), 180);
  });
  watcher.on("error", (error) => console.error("ShowAI file watcher:", error));
}

async function readSettings(): Promise<{ home?: string }> {
  const path = join(app.getPath("userData"), "showai-settings.json");
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const settings = JSON.parse(contents) as { home?: unknown };
  if (settings.home !== undefined && typeof settings.home !== "string")
    throw new Error("ShowAI settings contain an invalid home directory.");
  return settings as { home?: string };
}

async function saveSettings(home: string): Promise<void> {
  const path = join(app.getPath("userData"), "showai-settings.json");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ home }, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function activePages(id: string) {
  return store.listPages(id, { includeArchived: false });
}

async function pageRecord(id: string, page: string) {
  const record = await store.readPage(id, page);
  return enrichPage(id, record);
}

async function enrichPage(id: string, record: PageRecord) {
  return {
    ...record,
    components: await resolveDocumentComponents(
      store.root,
      record.document,
      id,
    ),
  };
}

function artifactInput(value: unknown) {
  if (typeof value === "string" && /^\s*</.test(value)) {
    const match = value.match(
      /<script\b(?=[^>]*\bid=["']showai-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!match)
      throw new CoreError(
        "INVALID_DATA",
        "This HTML does not contain an editable ShowAI page.",
      );
    return parseArtifact(match[1]);
  }
  return parseArtifact(value);
}

function filename(title: string): string {
  return (title.trim() || "ShowAI")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 100);
}

async function handle(
  action: string,
  args: Record<string, unknown>,
  window: BrowserWindow,
): Promise<unknown> {
  switch (action) {
    case "app:info":
      return info();
    case "projects:list":
      return store.listProjects();
    case "projects:create":
      return service.createProject(
        required(args, "name"),
        args.binding as ProjectBinding | undefined,
      );
    case "projects:rename":
      return store.updateProject(projectId(args), {
        name: required(args, "name"),
      });
    case "projects:pin":
      return store.updateProject(projectId(args), {
        pinned: boolean(args, "pinned"),
      });
    case "projects:remove":
      return store.updateProject(projectId(args), { archived: true });
    case "folders:list":
      return store.listFolders(projectId(args));
    case "folders:create":
      return store.createFolder(projectId(args), {
        name: required(args, "name"),
        parentId: parentFolder(args),
      });
    case "folders:rename":
      return store.updateFolder(
        projectId(args),
        assertId(required(args, "folderId")),
        { name: required(args, "name") },
      );
    case "folders:pin":
      return store.updateFolder(
        projectId(args),
        assertId(required(args, "folderId")),
        { pinned: boolean(args, "pinned") },
      );
    case "folders:remove":
      return store.updateFolder(
        projectId(args),
        assertId(required(args, "folderId")),
        { archived: true },
      );
    case "pages:list":
      return activePages(projectId(args));
    case "pages:get":
      return pageRecord(projectId(args), pageId(args));
    case "pages:create": {
      const id = projectId(args);
      const templateId = text(args, "templateId", true);
      const document = templateId
        ? await instantiateTemplateRecord(
            store.root,
            await getTemplate(store.root, templateId, id, {
              version: text(args, "templateVersion", true),
              scope: text(
                args,
                "templateScope",
                true,
              ) as CatalogReadOptions["scope"],
              integrity: text(args, "templateIntegrity", true),
            }),
            id,
          )
        : args.document !== undefined
          ? validateDocument(args.document)
          : blankDocument();
      const parentId =
        args.parentId !== undefined
          ? parentFolder(args)
          : args.document !== undefined &&
              document.parentId &&
              (await store.listFolders(id)).some(
                (folder) => folder.id === document.parentId,
              )
            ? document.parentId
            : null;
      await validateDestination(id, parentId);
      return enrichPage(
        id,
        await service.createPage(id, {
          ...(args.title !== undefined
            ? { title: required(args, "title") }
            : {}),
          document: { ...document, parentId },
        }),
      );
    }
    case "pages:rename":
    case "pages:pin":
    case "pages:move": {
      const id = projectId(args);
      const fields =
        action === "pages:rename"
          ? { title: required(args, "title") }
          : action === "pages:pin"
            ? { favorite: boolean(args, "pinned") }
            : { parentId: parentFolder(args) };
      return enrichPage(
        id,
        await store.updatePageMetadata(
          id,
          pageId(args),
          fields,
          required(args, "baseHash"),
        ),
      );
    }
    case "pages:save": {
      const id = projectId(args);
      return enrichPage(
        id,
        await service.savePage(
          id,
          pageId(args),
          validateDocument(args.document),
          required(args, "baseHash"),
        ),
      );
    }
    case "pages:duplicate": {
      const id = projectId(args),
        original = await store.readPage(id, pageId(args));
      const parentId = (await store.listFolders(id)).some(
        (folder) => folder.id === original.document.parentId,
      )
        ? original.document.parentId
        : null;
      return enrichPage(
        id,
        await service.createPage(id, {
          document: {
            ...instantiateTemplate({
              ...original.document,
              title: `${original.document.title || "未命名页面"} 副本`,
              archived: false,
            }),
            parentId,
          },
        }),
      );
    }
    case "pages:remove": {
      const id = projectId(args),
        original = await store.readPage(id, pageId(args));
      return enrichPage(
        id,
        await store.savePage(
          id,
          original.document.id,
          { ...original.document, archived: true },
          text(args, "baseHash", true) ?? original.hash,
        ),
      );
    }
    case "pages:import": {
      const artifact = artifactInput(args.artifact);
      const id = projectId(args);
      const parentId =
        args.parentId !== undefined
          ? parentFolder(args)
          : (await store.listFolders(id)).some(
                (folder) => folder.id === artifact.document.parentId,
              )
            ? artifact.document.parentId
            : null;
      await validateDestination(id, parentId);
      return enrichPage(
        id,
        await service.createPage(id, {
          document: { ...artifact.document, parentId },
          components: [
            ...(artifact.components ?? []),
            ...(artifact.remoteComponents?.length
              ? await loadRemoteComponents(artifact.remoteComponents)
              : []),
          ],
        }),
      );
    }
    case "templates:list":
      return listTemplates(
        store.root,
        await optionalProject(args),
        catalogOptions(args),
      );
    case "templates:get": {
      const project = await optionalProject(args);
      const template = await getTemplate(
        store.root,
        required(args, "id"),
        project,
        catalogOptions(args),
      );
      const previewDocument = await instantiateTemplateRecord(
        store.root,
        template,
        project,
      );
      return {
        ...template,
        previewDocument,
        components: await resolveDocumentComponents(
          store.root,
          previewDocument,
          project,
        ),
      };
    }
    case "templates:save": {
      const project = projectId(args);
      await store.listPages(project);
      const document =
        args.document !== undefined
          ? validateDocument(args.document)
          : args.pageId
            ? (await store.readPage(project, pageId(args))).document
            : undefined;
      return saveTemplate(
        store.root,
        {
          id: text(args, "id", true),
          version: text(args, "version", true),
          name: required(args, "name"),
          description:
            typeof args.description === "string" ? args.description : "",
          document,
          scenarios: args.scenarios as SaveTemplateInput["scenarios"],
          contentGuide: args.contentGuide as SaveTemplateInput["contentGuide"],
          related: args.related as SaveTemplateInput["related"],
          examples: args.examples as SaveTemplateInput["examples"],
          composition: args.composition as SaveTemplateInput["composition"],
          parents: args.parents as SaveTemplateInput["parents"],
          mergeBase: args.mergeBase as SaveTemplateInput["mergeBase"],
        },
        project,
      );
    }
    case "components:list":
      return [
        ...(!args.scope || args.scope === "all" || args.scope === "builtin"
          ? listBuiltinComponents()
          : []
        ).map((item) => ({
          ...item,
          id: item.kind,
          scope: "builtin",
        })),
        ...(await listComponents(
          store.root,
          await optionalProject(args),
          catalogOptions(args),
        )),
      ];
    case "components:get": {
      const id = required(args, "id");
      if (
        (!args.scope || args.scope === "builtin") &&
        listBuiltinComponents().some((item) => item.kind === id)
      )
        return { ...describeBuiltinComponent(id), id, scope: "builtin" };
      return getComponent(
        store.root,
        id,
        text(args, "version", true),
        await optionalProject(args),
        catalogOptions(args),
      );
    }
    case "components:source":
      return readComponentSource(
        store.root,
        required(args, "id"),
        text(args, "version", true),
        await optionalProject(args),
        catalogOptions(args),
      );
    case "components:import": {
      const project = projectId(args);
      await store.listPages(project);
      const result = await dialog.showOpenDialog(window, {
        title: "选择组件源码目录",
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return importComponent(store.root, result.filePaths[0], project);
    }
    case "components:save": {
      const project = projectId(args);
      await store.listPages(project);
      if (
        !args.manifest ||
        typeof args.manifest !== "object" ||
        (typeof args.schema !== "boolean" &&
          (!args.schema || typeof args.schema !== "object")) ||
        typeof args.source !== "string"
      )
        throw new CoreError(
          "INVALID_DATA",
          "A component needs its manifest, schema, and source.",
        );
      return saveComponent(
        store.root,
        {
          manifest: args.manifest as ComponentManifest,
          schema: args.schema as JsonSchema,
          source: args.source,
          ...(args.files
            ? { files: args.files as Record<string, string> }
            : {}),
          ...(args.assets
            ? { assets: args.assets as Record<string, string> }
            : {}),
        },
        project,
      );
    }
    case "components:createExample": {
      const project = projectId(args);
      await store.listPages(project);
      const id = `counter-${randomUUID().slice(0, 8)}`;
      return saveComponent(
        store.root,
        {
          manifest: {
            id,
            name: "计数器",
            version: "1.0.0",
            description: "可编辑的 React 控件示例，点击按钮调整计数。",
            scenarios: [
              "理解组件输入、交互和页面数据保存，例如用按钮记录一个本地计数。",
            ],
            effects: [
              "点击按钮即可观察数值变化。",
              "编辑状态下将计数保存到页面，阅读时可临时操作。",
            ],
            entry: "Component.tsx",
            defaultData: { label: "计数", value: 0 },
            examples: [
              {
                name: "从零开始",
                request: "从0开始，用增加和减少按钮探索整数变化。",
                data: { label: "计数", value: 0 },
              },
            ],
          },
          schema: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
            required: ["label", "value"],
            additionalProperties: false,
          },
          source: `import React, {useEffect, useState} from "react";\nexport default function Counter({data,onChange,readOnly}) {\n const [value,setValue]=useState(data.value);\n useEffect(()=>setValue(data.value),[data.value]);\n function change(next) {setValue(next); if(!readOnly) onChange?.({...data,value:next});}\n return <section style={{fontFamily:"system-ui",padding:28,textAlign:"center",background:"#f4f6f3",borderRadius:12}}><p>{data.label}</p><output style={{fontSize:48}}>{value}</output><div style={{display:"flex",justifyContent:"center",gap:12,marginTop:16}}><button onClick={()=>change(value-1)} aria-label="减少">−</button><button onClick={()=>change(value+1)} aria-label="增加">+</button></div></section>;\n}\n`,
        },
        project,
      );
    }
    case "catalog:promote": {
      const project = projectId(args);
      await store.listPages(project);
      const bundle = await promotePackage(store.root, revisionArg(args), {
        projectId: project,
        target: "global",
      });
      const ref = bundle.root;
      return ref.kind === "component"
        ? getComponent(store.root, ref.id, ref.version, project, {
            scope: "global",
            integrity: ref.integrity,
          })
        : getTemplate(store.root, ref.id, project, {
            scope: "global",
            version: ref.version,
            integrity: ref.integrity,
          });
    }
    case "catalog:fork": {
      const project = projectId(args);
      await store.listPages(project);
      return forkPackage(store.root, revisionArg(args), {
        projectId: project,
        id: text(args, "id", true),
        version: required(args, "version"),
        name: text(args, "name", true),
      });
    }
    case "catalog:mergePreview":
    case "catalog:mergeSave": {
      const project = projectId(args);
      await store.listPages(project);
      const input: PackageMergeInput = {
        projectId: project,
        base: revisionArg(args, "base"),
        ours: revisionArg(args, "ours"),
        theirs: revisionArg(args, "theirs"),
      };
      return action === "catalog:mergePreview"
        ? previewPackageMerge(store.root, input)
        : savePackageMerge(store.root, {
            ...input,
            id: text(args, "id", true),
            version: required(args, "version"),
            resolved: args.resolved as EditablePackage,
          });
    }
    case "catalog:preparePublish": {
      const project = await optionalProject(args),
        ref = revisionArg(args);
      const selection = await dialog.showOpenDialog(window, {
        title: "选择发布包保存位置",
        properties: ["openDirectory", "createDirectory"],
      });
      if (selection.canceled || !selection.filePaths[0]) return null;
      const out = join(
        selection.filePaths[0],
        `${filename(ref.id)}-${filename(ref.version)}-${Date.now()}`,
      );
      return preparePublication(store.root, {
        refs: [ref],
        projectId: project,
        out,
      });
    }
    case "catalog:verifyPublish": {
      const project = await optionalProject(args);
      return verifyPublication(store.root, {
        manifestUrl: required(args, "manifestUrl"),
        projectId: project,
      });
    }
    case "dialog:openPage": {
      const result = await dialog.showOpenDialog(window, {
        title: "导入 ShowAI 页面",
        properties: ["openFile"],
        filters: [{ name: "ShowAI 页面", extensions: ["json", "html"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const path = result.filePaths[0];
      if ((await stat(path)).size > 20 * 1024 * 1024)
        throw new CoreError("INVALID_DATA", "The imported page exceeds 20 MB.");
      return {
        name: path.split(sep).at(-1),
        content: await readFile(path, "utf8"),
      };
    }
    case "export:page": {
      const id = projectId(args),
        page = pageId(args);
      if (!["html", "json", "inline"].includes(required(args, "format")))
        throw new CoreError("INVALID_DATA", "Unsupported page export format.");
      const format = args.format as "html" | "json" | "inline";
      const record = await pageRecord(id, page);
      const selection = await dialog.showSaveDialog(window, {
        title: "导出页面",
        defaultPath: `${filename(record.document.title)}${format === "json" ? ".showai.json" : ".html"}`,
        filters: [
          {
            name: format === "json" ? "ShowAI 页面源" : "HTML 页面",
            extensions: [format === "json" ? "json" : "html"],
          },
        ],
      });
      if (selection.canceled || !selection.filePath) return null;
      await assertExportDestination(store.root, id, selection.filePath);
      if (format === "json") {
        const source = serializeArtifact(record.document, record.components);
        await writeFile(selection.filePath, source, "utf8");
        return {
          format,
          path: selection.filePath,
          bytes: Buffer.byteLength(source),
        };
      }
      return exportPage({
        root: store.root,
        projectId: id,
        pageId: page,
        format,
        components: componentDelivery(args),
        out: selection.filePath,
        overwrite: true,
      });
    }
    case "export:site": {
      const id = projectId(args);
      await store.listPages(id);
      const selection = await dialog.showOpenDialog(window, {
        title: "选择网站输出目录",
        properties: ["openDirectory", "createDirectory"],
      });
      if (selection.canceled || !selection.filePaths[0]) return null;
      return exportPage({
        root: store.root,
        projectId: id,
        format: "site",
        components: componentDelivery(args),
        out: selection.filePaths[0],
        overwrite: true,
      });
    }
    case "fs:reveal": {
      const id = projectId(args),
        page = text(args, "pageId", true);
      await store.listPages(id);
      if (page) {
        const record = await store.readPage(id, assertId(page), {
          checkpoint: false,
        });
        shell.showItemInFolder(record.path);
      } else {
        const error = await shell.openPath(store.projectPath(id));
        if (error) throw new Error(error);
      }
      return null;
    }
    case "settings:chooseHome": {
      if (process.env.SHOWAI_HOME)
        throw new CoreError(
          "INVALID_DATA",
          "SHOWAI_HOME fixes this launch's storage directory. Change it before the next launch.",
        );
      const selection = await dialog.showOpenDialog(window, {
        title: "选择 ShowAI 数据目录",
        defaultPath: store.root,
        properties: ["openDirectory", "createDirectory"],
      });
      if (selection.canceled || !selection.filePaths[0]) return null;
      const home = await realpath(selection.filePaths[0]);
      await new FileStore(home).listProjects();
      await saveSettings(home);
      await useHome(home);
      broadcast("home");
      return info();
    }
    case "clipboard:write": {
      if (typeof args.text !== "string" || args.text.length > 2 * 1024 * 1024)
        throw new CoreError(
          "INVALID_DATA",
          "Clipboard text must be at most 2 MB.",
        );
      clipboard.writeText(args.text);
      return null;
    }
    case "app:openPageWindow": {
      const id = projectId(args),
        page = pageId(args);
      await store.readPage(id, page);
      await createWindow({ projectId: id, pageId: page });
      return null;
    }
    default:
      throw new CoreError("INVALID_DATA", `Unknown desktop action: ${action}`);
  }
}

function trustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    !windows.has(window) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new CoreError(
      "INVALID_PATH",
      "Desktop actions are only available to the ShowAI application frame.",
    );
  const url = event.senderFrame.url;
  const location = new URL(url);
  const trusted = process.env.SHOWAI_DEV_URL
    ? location.origin === new URL(process.env.SHOWAI_DEV_URL).origin
    : location.protocol === "file:" &&
      fileURLToPath(location) === join(directory, "index.html");
  if (!trusted)
    throw new CoreError("INVALID_PATH", "Untrusted application location.");
  return window;
}

function requestClose(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(true);
  const pending = closeRequests.get(window.id);
  if (pending) return pending.promise;
  const requestId = randomUUID();
  let resolveResult!: (allow: boolean | null) => void;
  const received = new Promise<boolean | null>((resolve) => {
    resolveResult = resolve;
  });
  const timer = setTimeout(() => resolveResult(null), 20000);
  const promise = received
    .then(async (allow) => {
      if (allow !== null || window.isDestroyed()) return allow ?? true;
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        message: "页面还没有确认保存完成",
        detail: "可以继续编辑，或放弃尚未保存的修改并关闭窗口。",
        buttons: ["继续编辑", "放弃修改并关闭"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return choice.response === 1;
    })
    .finally(() => {
      clearTimeout(timer);
      if (closeRequests.get(window.id)?.requestId === requestId)
        closeRequests.delete(window.id);
    });
  closeRequests.set(window.id, {
    requestId,
    resolve: resolveResult,
    timer,
    promise,
  });
  window.webContents.send("showai:before-close", requestId);
  return promise;
}

async function createWindow(page?: {
  projectId: string;
  pageId: string;
}): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: page ? 1120 : 1320,
    height: 880,
    minWidth: 760,
    minHeight: 560,
    title: "ShowAI",
    backgroundColor: "#f8f8f6",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      preload: join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  windows.add(window);
  window.on("close", (event) => {
    if (allowedQuit) return;
    event.preventDefault();
    void requestClose(window).then((allow) => {
      if (allow && !window.isDestroyed()) {
        window.destroy();
      }
    });
  });
  window.on("closed", () => {
    closeRequests.get(window.id)?.resolve(true);
    windows.delete(window);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
    if (/^https?:\/\//i.test(event.url)) void shell.openExternal(event.url);
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && !event.url.startsWith("about:"))
      event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  const query: Record<string, string> = page
    ? { project: page.projectId, page: page.pageId, focus: "1" }
    : {};
  if (process.env.SHOWAI_DEV_URL) {
    const url = new URL(process.env.SHOWAI_DEV_URL);
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, value);
    await window.loadURL(url.href);
  } else await window.loadFile(join(directory, "index.html"), { query });
  return window;
}

async function openDeepLink(source: string): Promise<void> {
  const url = new URL(source);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "showai:" ||
    url.hostname !== "project" ||
    parts.length !== 3 ||
    parts[1] !== "page"
  )
    throw new CoreError(
      "INVALID_PATH",
      "Expected showai://project/PROJECT/page/PAGE.",
    );
  const project = assertId(parts[0]),
    page = assertId(parts[2]);
  await store.readPage(project, page);
  await createWindow({ projectId: project, pageId: page });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!app.isReady()) pendingDeepLink = url;
    else
      void openDeepLink(url).catch((error) =>
        dialog.showErrorBox("无法打开页面", errorResult(error).message),
      );
  });
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((argument) => argument.startsWith("showai://"));
    if (link)
      void openDeepLink(link).catch((error) =>
        dialog.showErrorBox("无法打开页面", errorResult(error).message),
      );
    else {
      const window = [...windows][0];
      window?.show();
      window?.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const settings = await readSettings();
      await useHome(process.env.SHOWAI_HOME ?? settings.home);
      process.env.SHOWAI_VIEWER ??= join(pluginPath(), "assets", "viewer.html");
      if (app.isPackaged) {
        process.env.SHOWAI_RUNTIME_ENTRY = join(
          pluginPath(),
          "scripts",
          "cli.mjs",
        );
        process.env.ESBUILD_BINARY_PATH ??= join(
          pluginPath(),
          "node_modules",
          "@esbuild",
          `${process.platform}-${process.arch}`,
          process.platform === "win32" ? "esbuild.exe" : "bin/esbuild",
        );
      }
      if (app.isPackaged) app.setAsDefaultProtocolClient("showai");
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === "darwin"
            ? [{ role: "appMenu" as const }]
            : []),
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ]),
      );
      ipcMain.on("showai:close-result", (event, payload: unknown) => {
        let window: BrowserWindow;
        try {
          window = trustedSender(event);
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        const result = payload as { requestId?: unknown; allow?: unknown };
        const pending = closeRequests.get(window.id);
        if (
          pending &&
          pending.requestId === result.requestId &&
          typeof result.allow === "boolean"
        )
          pending.resolve(result.allow);
      });
      ipcMain.handle(
        "showai:invoke",
        async (
          event,
          action: unknown,
          args: unknown,
        ): Promise<DesktopResponse> => {
          try {
            const window = trustedSender(event);
            if (typeof action !== "string" || !actions.has(action))
              throw new CoreError("INVALID_DATA", "Unknown desktop action.");
            if (!args || typeof args !== "object" || Array.isArray(args))
              throw new CoreError(
                "INVALID_DATA",
                "Desktop arguments must be an object.",
              );
            return {
              ok: true,
              data: await handle(
                action,
                args as Record<string, unknown>,
                window,
              ),
            };
          } catch (error) {
            return { ok: false, error: errorResult(error) };
          }
        },
      );
      if (pendingDeepLink) await openDeepLink(pendingDeepLink);
      else await createWindow();
      app.on("activate", () => {
        if (!windows.size) void createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox("ShowAI 无法启动", errorResult(error).message);
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (allowedQuit) return;
    event.preventDefault();
    if (checkingQuit) return;
    checkingQuit = true;
    void Promise.all([...windows].map(requestClose)).then(async (results) => {
      checkingQuit = false;
      if (!results.every(Boolean)) return;
      allowedQuit = true;
      clearTimeout(notification);
      await watcher?.close();
      for (const window of windows) if (!window.isDestroyed()) window.destroy();
      app.quit();
    });
  });
}
