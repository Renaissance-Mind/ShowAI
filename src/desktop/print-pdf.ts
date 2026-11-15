import { app, BrowserWindow, shell } from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SETTLE_SCRIPT } from "../agent/print-page";

export async function printHtmlToPdf(html: string, path: string) {
  const directory = await mkdtemp(join(app.getPath("temp"), "showai-print-"));
  const page = join(directory, "page.html");
  await writeFile(page, html, { mode: 0o600 });
  const window = new BrowserWindow({
    show: false,
    width: 820,
    height: 1100,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: "showai-print",
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  try {
    await window.loadFile(page);
    await window.webContents.executeJavaScript(SETTLE_SCRIPT, true);
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    await writeFile(path, pdf);
    return { format: "pdf" as const, path, bytes: pdf.byteLength };
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}
