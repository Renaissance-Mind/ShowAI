import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import type { WebContents } from "electron";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
} from "../components/custom/types";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CoreError } from "../core/store";
import { errorResult } from "../agent/service";
import type { DesktopResponse } from "./bridge";

const directory = dirname(fileURLToPath(import.meta.url));
interface PreviewLease {
  owner: WebContents;
  cancelled: boolean;
}
const pending = new Map<
  string,
  { task: Promise<string>; leases: Set<PreviewLease> }
>();
const requests = new Map<string, PreviewLease>();
let previewWindow: BrowserWindow | undefined;
let previewIdle: ReturnType<typeof setTimeout> | undefined;
const observedOwners = new WeakSet<WebContents>();
let developmentRenderer: Promise<Buffer> | undefined;
function closePreview() {
  clearTimeout(previewIdle);
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.destroy();
  previewWindow = undefined;
}
app.on("before-quit", closePreview);
function trustedOwner(event: Electron.IpcMainInvokeEvent) {
  const sender = event.senderFrame;
  const location = new URL(sender?.url ?? "about:blank");
  const trusted = process.env.SHOWAI_DEV_URL
    ? location.origin === new URL(process.env.SHOWAI_DEV_URL).origin
    : location.protocol === "file:" &&
      fileURLToPath(location) === join(directory, "index.html");
  if (!sender || sender.parent || !trusted)
    throw new CoreError("INVALID_PATH", "Untrusted preview request.");
}

const previewData = new Map<
  number,
  BuiltinComponentMetadata | CompiledComponent
>();
let queue: Promise<unknown> = Promise.resolve();
let lastPruned = 0;
async function prunePreviews(directory: string) {
  if (Date.now() - lastPruned < 60000) return;
  lastPruned = Date.now();
  const names = (await readdir(directory)).filter((name) =>
    /^[a-f0-9]{64}\.png$/.test(name),
  );
  if (names.length <= 128) return;
  const entries = await Promise.all(
    names.map(async (name) => ({
      path: join(directory, name),
      modified: (await stat(join(directory, name))).mtimeMs,
    })),
  );
  entries.sort((a, b) => b.modified - a.modified);
  for (const entry of entries.slice(128)) await rm(entry.path, { force: true });
}

async function cachedPreview(path: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(path);
    const image = nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    if (
      image.isEmpty() ||
      size.width <= 0 ||
      size.height <= 0 ||
      Math.abs(size.width / size.height - 720 / 420) > 0.01
    )
      return;
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
    return undefined;
  }
}

async function capture(
  reference: Record<string, string>,
  cache: string,
  owner: WebContents,
): Promise<string> {
  const component = (await owner.executeJavaScript(
    `window.showai.invoke("components:get", ${JSON.stringify(reference)})`,
  )) as BuiltinComponentMetadata | CompiledComponent;
  clearTimeout(previewIdle);
  const preview =
    previewWindow && !previewWindow.isDestroyed()
      ? previewWindow
      : new BrowserWindow({
          width: 720,
          height: 420,
          useContentSize: true,
          show: false,
          backgroundColor: reference.theme === "dark" ? "#222222" : "#f7f7f7",
          webPreferences: {
            preload: join(directory, "preload.cjs"),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        });
  if (previewWindow !== preview) {
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    preview.webContents.on("will-navigate", (event) => event.preventDefault());
    previewWindow = preview;
  }
  if (!observedOwners.has(owner)) {
    observedOwners.add(owner);
    owner.once("destroyed", () => {
      for (const lease of requests.values())
        if (lease.owner === owner) lease.cancelled = true;
      if (
        BrowserWindow.getAllWindows().every(
          (window) => window === previewWindow || !window.isVisible(),
        )
      )
        closePreview();
    });
  }
  preview.setBackgroundColor(
    reference.theme === "dark" ? "#222222" : "#f7f7f7",
  );
  previewData.set(preview.webContents.id, component);
  try {
    const query = {
      componentPreview: JSON.stringify(reference),
      thumbnailCapture: "1",
    };
    if (process.env.SHOWAI_DEV_URL) {
      const url = new URL(process.env.SHOWAI_DEV_URL);
      url.searchParams.set("componentPreview", query.componentPreview);
      url.searchParams.set("thumbnailCapture", "1");
      await preview.loadURL(url.href);
    } else await preview.loadFile(join(directory, "index.html"), { query });
    await preview.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 12000;
      const poll = () => {
        const stage = document.querySelector('[data-preview-ready]');
        if (stage?.dataset.previewError) return reject(new Error(stage.dataset.previewError));
        if (stage?.dataset.previewReady === 'true') return requestAnimationFrame(() => resolve(true));
        if (Date.now() > deadline) return reject(new Error('组件预览加载超时。'));
        setTimeout(poll, 30);
      }; poll();
    })`);
    const png = (
      await preview.webContents.capturePage({
        x: 0,
        y: 0,
        width: 720,
        height: 420,
      })
    ).toPNG();
    await writeFile(cache, png);
    await prunePreviews(dirname(cache));
    return `data:image/png;base64,${png.toString("base64")}`;
  } finally {
    previewData.delete(preview.webContents.id);
    if (!preview.isDestroyed()) {
      previewIdle = setTimeout(closePreview, 10000);
      previewIdle.unref();
    }
  }
}

ipcMain.handle(
  "showai:thumbnail",
  async (event, args: unknown): Promise<DesktopResponse<string>> => {
    try {
      trustedOwner(event);
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new CoreError("INVALID_DATA", "Invalid preview reference.");
      const reference: Record<string, string> = {};
      for (const key of ["id", "version", "scope", "integrity", "projectId"]) {
        const value = (args as Record<string, unknown>)[key];
        if (value !== undefined) {
          if (typeof value !== "string" || value.length > 200)
            throw new CoreError("INVALID_DATA", "Invalid preview reference.");
          reference[key] = value;
        }
      }
      if (!reference.id)
        throw new CoreError("INVALID_DATA", "Preview needs a component id.");
      const theme = (args as Record<string, unknown>).theme ?? "light";
      if (theme !== "light" && theme !== "dark")
        throw new CoreError("INVALID_DATA", "Invalid preview theme.");
      reference.theme = theme;
      const requestId =
        typeof (args as { requestId?: unknown }).requestId === "string"
          ? String((args as { requestId: string }).requestId)
          : "";
      if (requestId.length > 128)
        throw new CoreError("INVALID_DATA", "Invalid preview request id.");
      const lease: PreviewLease = { owner: event.sender, cancelled: false };
      const requestKey = `${event.sender.id}:${requestId}`;
      if (requestId) requests.set(requestKey, lease);
      let renderer: Buffer;
      if (process.env.SHOWAI_DEV_URL) {
        developmentRenderer ??= readFile(
          join(process.env.SHOWAI_DEV_RUNTIME!, "assets/reader-source.json"),
        );
        renderer = await developmentRenderer;
      } else renderer = await readFile(join(directory, "index.html"));
      const keySource = createHash("sha256")
        .update(renderer)
        .update(JSON.stringify(reference));
      if (process.env.SHOWAI_DEV_URL) {
        for (const path of [
          "src/studio/ComponentPreviewPage.tsx",
          "src/studio/component-catalog.css",
          "src/design/desktop.css",
        ])
          keySource.update(await readFile(join(process.cwd(), path)));
      }
      const key = keySource.digest("hex");
      const cacheDirectory = join(
        app.getPath("userData"),
        "component-previews",
      );
      await mkdir(cacheDirectory, { recursive: true });
      const cache = join(cacheDirectory, `${key}.png`);
      let image = await cachedPreview(cache);
      try {
        if (!image) {
          let entry = pending.get(key);
          if (!entry) {
            const leases = new Set<PreviewLease>();
            const task = queue.then(() => {
              const active = [...leases].find(
                (lease) => !lease.cancelled && !lease.owner.isDestroyed(),
              );
              if (!active)
                throw new CoreError(
                  "NOT_FOUND",
                  "Preview request was cancelled.",
                );
              return capture(reference, cache, active.owner);
            });
            entry = { task, leases };
            pending.set(key, entry);
            queue = task.then(
              () => undefined,
              () => undefined,
            );
            const cleanup = () => {
              if (pending.get(key) === entry) pending.delete(key);
            };
            task.then(cleanup, cleanup);
          }
          entry.leases.add(lease);
          image = await entry.task;
        }
      } finally {
        if (requests.get(requestKey) === lease) requests.delete(requestKey);
      }
      return { ok: true, data: image };
    } catch (reason) {
      if (args && typeof args === "object" && "requestId" in args)
        requests.delete(`${event.sender.id}:${String(args.requestId)}`);
      return { ok: false, error: errorResult(reason) };
    }
  },
);

ipcMain.handle(
  "showai:thumbnail-cancel",
  (event, args): DesktopResponse<boolean> => {
    try {
      trustedOwner(event);
      if (
        !args ||
        typeof args.requestId !== "string" ||
        args.requestId.length > 128
      )
        throw new CoreError("INVALID_DATA", "Invalid preview request id.");
      const lease = requests.get(`${event.sender.id}:${args.requestId}`);
      if (lease) lease.cancelled = true;
      return { ok: true, data: true };
    } catch (error) {
      return { ok: false, error: errorResult(error) };
    }
  },
);

ipcMain.handle(
  "showai:previewData",
  (event): DesktopResponse<BuiltinComponentMetadata | CompiledComponent> => {
    const component = previewData.get(event.sender.id);
    if (event.senderFrame !== event.sender.mainFrame || !component)
      return {
        ok: false,
        error: {
          code: "INVALID_PATH",
          message: "Preview data is only available to the capture frame.",
        },
      };
    return { ok: true, data: component };
  },
);
