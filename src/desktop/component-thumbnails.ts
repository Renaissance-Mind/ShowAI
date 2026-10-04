import { app, BrowserWindow, ipcMain } from "electron";
import type { WebContents } from "electron";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
} from "../components/custom/types";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CoreError } from "../core/store";
import { errorResult } from "../agent/service";
import type { DesktopResponse } from "./bridge";

const directory = dirname(fileURLToPath(import.meta.url));
const pending = new Map<string, Promise<string>>();
const previewData = new Map<
  number,
  BuiltinComponentMetadata | CompiledComponent
>();
let queue: Promise<unknown> = Promise.resolve();

async function cachedPreview(path: string): Promise<string | undefined> {
  if (process.env.SHOWAI_DEV_URL) return undefined;
  try {
    return `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
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
  const preview = new BrowserWindow({
    width: 720,
    height: 420,
    useContentSize: true,
    show: false,
    backgroundColor: "#f3f4f7",
    webPreferences: {
      preload: join(directory, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  previewData.set(preview.webContents.id, component);
  preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  preview.webContents.on("will-navigate", (event) => event.preventDefault());
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
    if (!process.env.SHOWAI_DEV_URL) await writeFile(cache, png);
    return `data:image/png;base64,${png.toString("base64")}`;
  } finally {
    previewData.delete(preview.webContents.id);
    preview.destroy();
  }
}

ipcMain.handle(
  "showai:thumbnail",
  async (event, args: unknown): Promise<DesktopResponse<string>> => {
    try {
      const sender = event.senderFrame;
      const location = new URL(sender?.url ?? "about:blank");
      const trusted = process.env.SHOWAI_DEV_URL
        ? location.origin === new URL(process.env.SHOWAI_DEV_URL).origin
        : location.protocol === "file:" &&
          fileURLToPath(location) === join(directory, "index.html");
      if (!sender || sender.parent || !trusted)
        throw new CoreError("INVALID_PATH", "Untrusted preview request.");
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
      const renderer = await readFile(join(directory, "index.html"));
      const key = createHash("sha256")
        .update(renderer)
        .update(JSON.stringify(reference))
        .digest("hex");
      const cacheDirectory = join(
        app.getPath("userData"),
        "component-previews",
      );
      await mkdir(cacheDirectory, { recursive: true });
      const cache = join(cacheDirectory, `${key}.png`);
      let image = await cachedPreview(cache);
      if (!image) {
        let task = pending.get(key);
        if (!task) {
          task = queue.then(() => capture(reference, cache, event.sender));
          pending.set(key, task);
          queue = task.then(
            () => undefined,
            () => undefined,
          );
        }
        try {
          image = await task;
        } finally {
          pending.delete(key);
        }
      }
      return { ok: true, data: image };
    } catch (reason) {
      return { ok: false, error: errorResult(reason) };
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
