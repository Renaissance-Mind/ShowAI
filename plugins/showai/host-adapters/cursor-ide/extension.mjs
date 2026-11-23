import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as vscode from "vscode";

const editorType = "showai.pageReference";
const viewType = "showai.workbench";
const globalUri = "ui://showai/workbench-v3.html";
const threadUri = "ui://showai/workbench-thread-v5.html";
const bridgeTools = new Set([
  "workbench_refresh", "workbench_request", "workbench_changes",
  "workbench_asset", "workbench_media", "workbench_open_destination",
]);
const identity = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const zh = () => vscode.env.language.toLowerCase().startsWith("zh");

function pageTarget({ projectId, pageId, blockId }) {
  if (
    typeof projectId !== "string" || !identity.test(projectId) ||
    typeof pageId !== "string" || !identity.test(pageId) ||
    (blockId != null && (typeof blockId !== "string" || blockId.length > 512))
  )
    throw new Error(zh() ? "ShowAI 的页面引用无效。" : "Invalid ShowAI page reference.");
  return { projectId, pageId, blockId: blockId || undefined };
}

async function connect(context) {
  const binding = JSON.parse(await readFile(context.asAbsolutePath("binding.json"), "utf8"));
  const runtime = JSON.parse(await readFile(binding.runtimeConfig ||
    join(homedir(), ".showai", "agent-runtime.json"), "utf8"));
  if (
    runtime.format !== "showai-agent-runtime" || runtime.protocol !== 1 ||
    typeof runtime.home !== "string" || !isAbsolute(runtime.home) ||
    (binding.library && resolve(binding.library) !== resolve(runtime.home)) ||
    typeof runtime.launch?.command !== "string" || !isAbsolute(runtime.launch.command) ||
    !Array.isArray(runtime.launch?.args) || !runtime.launch.args.every(value => typeof value === "string")
  )
    throw new Error(zh() ? "ShowAI 运行时登记无效。请在 ShowAI 中修复登记。" :
      "Invalid ShowAI runtime registration. Repair it in ShowAI.");
  const client = new Client({ name: `ShowAI Workbench for ${vscode.env.appName}`, version: "1" });
  await client.connect(new StdioClientTransport({
    command: runtime.launch.command,
    args: [...runtime.launch.args, "mcp", "--home", runtime.home],
    env: { ...runtime.launch.env, SHOWAI_CURSOR_IDE_WORKBENCH: "1" },
    stderr: "pipe",
  }));
  return client;
}

function contextFor(target) {
  const theme = vscode.window.activeColorTheme.kind;
  const dark = theme === vscode.ColorThemeKind.Dark || theme === vscode.ColorThemeKind.HighContrast;
  const query = target && new URLSearchParams({ project: target.projectId, page: target.pageId });
  if (target?.blockId) query.set("blocks", target.blockId);
  return {
    locale: vscode.env.language,
    theme: dark ? "dark" : "light",
    platform: "desktop",
    displayMode: "fullscreen",
    ...(query && { "openai/deepLink": { url: "/?" + query } }),
  };
}

function secureHtml(html) {
  const nonce = randomBytes(18).toString("base64");
  const policy = [
    "default-src 'none'", `script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'", "img-src data: blob: https:", "media-src data: blob: https:",
    "font-src data: blob:", "worker-src blob:", "frame-src about: data: blob:",
    "base-uri 'none'", "form-action 'none'",
  ].join("; ");
  return html
    .replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replace("<script>", `<script nonce="${nonce}">`);
}

async function attachPanel(context, panel, target, openTarget, global = false) {
  const scope = [];
  let disposed = false;
  let client;
  panel.onDidDispose(() => {
    disposed = true;
    scope.forEach(disposable => disposable.dispose());
    void client?.close().catch(error => console.error("ShowAI workbench:", error));
  });
  try {
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    client = await connect(context);
    if (disposed) { await client.close(); return null; }
    const uri = global || !target ? globalUri : threadUri;
    const resource = await client.readResource({ uri });
    const html = resource.contents[0]?.text;
    if (typeof html !== "string" || !html.includes("acquireVsCodeApi"))
      throw new Error(zh() ? "请更新 ShowAI 运行时。" : "Update the ShowAI runtime.");
    if (disposed) return null;
    const update = (next = target) => {
      target = next;
      void panel.webview.postMessage({
        jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: contextFor(target),
      });
    };
    scope.push(vscode.window.onDidChangeActiveColorTheme(() => update()));
    scope.push(panel.webview.onDidReceiveMessage(async message => {
      const { id, method, params } = message ?? {};
      if (message?.jsonrpc !== "2.0" || !Number.isSafeInteger(id)) return;
      const reply = value => panel.webview.postMessage({ jsonrpc: "2.0", id, ...value });
      try {
        let result;
        if (method === "ui/initialize") {
          result = {
              protocolVersion: "2026-01-26",
              hostInfo: { name: vscode.env.appName, version: vscode.version },
            hostCapabilities: {
              serverTools: {}, serverResources: {}, openLinks: {}, experimental: { "showai/cursor": {} },
            },
            hostContext: contextFor(target),
          };
        } else if (method === "tools/call" && bridgeTools.has(params?.name)) {
          result = await client.callTool({ name: params.name, arguments: params.arguments });
        } else if (method === "ui/open-link") {
          const url = new URL(params.url);
          if (!["http:", "https:", "showai:"].includes(url.protocol))
            throw new Error("Unsupported ShowAI link.");
          result = { isError: !await vscode.env.openExternal(vscode.Uri.parse(url.href)) };
        } else if (method === "showai/open-page") {
          await openTarget(pageTarget(params));
          result = {};
        } else if (method === "showai/open-workbench") {
          await openTarget(pageTarget(params), true);
          result = {};
        } else {
          await reply({ error: { code: -32601, message: "Unsupported workbench request." } });
          return;
        }
        await reply({ result });
      } catch (error) {
        await reply({ error: { code: -32000, message: error.message } });
      }
    }));
    panel.webview.html = secureHtml(html);
    return update;
  } catch (error) {
    if (!disposed) panel.dispose();
    await vscode.window.showErrorMessage(zh()
      ? `无法打开 ShowAI 工作台。请确认已启动 ShowAI 并登记运行时。 ${error.message}`
      : `Could not open ShowAI Workbench. Start ShowAI and verify its runtime registration. ${error.message}`);
    return null;
  }
}

export function activate(context) {
  const agentPlugins = context.asAbsolutePath("agent-plugins");
  if (vscode.cursor?.plugins?.registerPath) {
    vscode.cursor.plugins.registerPath(agentPlugins);
    context.subscriptions.push({ dispose: () => vscode.cursor.plugins.unregisterPath(agentPlugins) });
  }

  let globalPanel;
  const pagePanels = new Map();
  async function openTarget(target, global = false) {
    const key = !global && target && JSON.stringify([target.projectId, target.pageId]);
    const known = key ? pagePanels.get(key) : globalPanel;
    if (known) {
      known.panel.reveal();
      (await known.ready)?.(target);
      return;
    }
    const panel = vscode.window.createWebviewPanel(viewType, "ShowAI",
      key ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    panel.iconPath = vscode.Uri.file(context.asAbsolutePath("assets/logo.svg"));
    const state = { panel, ready: attachPanel(context, panel, target, openTarget, global) };
    if (key) pagePanels.set(key, state);
    else globalPanel = state;
    panel.onDidDispose(() => {
      if (key && pagePanels.get(key) === state) pagePanels.delete(key);
      if (globalPanel === state) globalPanel = undefined;
    });
    await state.ready;
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("showai.library", {
      getChildren: () => [],
      getTreeItem: item => item,
    }),
    vscode.commands.registerCommand("showai.openWorkbench", () => openTarget(undefined)),
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        try {
          if (uri.path === "/workbench") return await openTarget(undefined);
          if (uri.path !== "/page") return;
          const query = new URLSearchParams(uri.query);
          await openTarget(pageTarget(Object.fromEntries(query)));
        } catch (error) {
          await vscode.window.showErrorMessage(error.message);
        }
      },
    }),
    vscode.window.registerCustomEditorProvider(editorType, {
      async resolveCustomTextEditor(document, panel) {
        try {
          const source = document.getText();
          if (source.length > 4096) throw new Error("Invalid ShowAI page reference.");
          const reference = JSON.parse(source);
          if (reference.format !== "showai-page-reference" || ![1, 2].includes(reference.version))
            throw new Error("Invalid ShowAI page reference.");
          await attachPanel(context, panel, pageTarget(reference), openTarget);
        } catch (error) {
          panel.dispose();
          await vscode.window.showErrorMessage(error.message);
        }
      },
    }, { webviewOptions: { retainContextWhenHidden: true } }),
  );
}
