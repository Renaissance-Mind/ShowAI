import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { readHostSetup } from "./host-package.mjs";
import { archive, universalPluginFiles } from "./universal-package.mjs";

export async function compileCursorExtension(source) {
  const compiled = await build({
    entryPoints: [join(source, "host-adapters/cursor-ide/extension.mjs")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["vscode"],
    write: false,
  });
  return compiled.outputFiles[0].contents;
}

export async function cursorWorkbenchArchive(source, { runtimeConfig, host = "cursor" } = {}) {
  const packaged = join(source, "host-adapters/cursor-ide/extension.cjs");
  const extension = existsSync(packaged) ? await readFile(packaged) : undefined;
  const agent = host === "cursor" ? await universalPluginFiles(source, {
    host: "cursor",
    cursorWorkbench: true,
    name: "showai-cursor-ide",
    displayName: "ShowAI for Cursor IDE",
    mcp: "local",
    runtimeConfig,
  }) : undefined;
  const profile = host === "cursor" ? "cursor-ide" : "trae";
  const setup = await readHostSetup(source, profile);
  const { version } = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
  const packageJson = {
    name: "showai-workbench",
    publisher: "renaissancemind",
    version,
    displayName: "ShowAI Workbench",
    description: "Edit original ShowAI pages and boards in your IDE.",
    license: "MIT",
    engines: { vscode: "^1.90.0" },
    categories: ["Other"],
    extensionKind: ["ui"],
    activationEvents: ["onStartupFinished", "onUri", "onView:showai.library"],
    main: "extension.cjs",
    capabilities: { untrustedWorkspaces: { supported: true } },
    contributes: {
      configurationDefaults: { "workbench.editorAssociations": { "*.showai-ref": "showai.pageReference" } },
      commands: [{ command: "showai.openWorkbench", title: "%showai.openWorkbench%" }],
      viewsContainers: { activitybar: [{ id: "showai", title: "ShowAI", icon: "assets/logo.svg" }] },
      views: { showai: [{ id: "showai.library", name: "%showai.library%" }] },
      viewsWelcome: [{
        view: "showai.library",
        contents: "%showai.libraryWelcome%",
      }],
      customEditors: [{
        viewType: "showai.pageReference",
        displayName: "%showai.pageReference%",
        selector: [{ filenamePattern: "*.showai-ref" }],
        priority: "default",
      }],
    },
  };

  const entries = [];
  const add = (name, data) => entries.push({ name, data: Buffer.from(data) });
  const addJson = (name, data) => add("extension/" + name, JSON.stringify(data, null, 2) + "\n");

  addJson("package.json", packageJson);
  addJson("package.nls.json", {
    "showai.openWorkbench": "ShowAI: Open Workbench",
    "showai.library": "Projects",
    "showai.libraryWelcome": "[Open ShowAI Workbench](command:showai.openWorkbench)",
    "showai.pageReference": "ShowAI Page",
  });
  addJson("package.nls.zh-cn.json", {
    "showai.openWorkbench": "ShowAI：打开工作台",
    "showai.library": "项目",
    "showai.libraryWelcome": "[打开 ShowAI 工作台](command:showai.openWorkbench)",
    "showai.pageReference": "ShowAI 页面",
  });
  const record = runtimeConfig && JSON.parse(await readFile(runtimeConfig, "utf8"));
  addJson("binding.json", record ? { runtimeConfig, library: record.home } : {});
  add("extension/extension.cjs", extension ?? await compileCursorExtension(source));
  add("extension/assets/logo.svg", await readFile(join(source, "assets/logo.svg")));
  for (const [name, language] of [["README.md", "en"], ["README.zh-CN.md", "zh"]]) {
    const { install, features } = setup[language];
    const switcher = language === "en" ? "[简体中文](README.zh-CN.md)" : "[English](README.md)";
    add("extension/" + name, [`# ShowAI for ${setup.name}`, switcher, features, install].join("\n\n") + "\n");
  }
  if (agent) for (const [name, data] of agent.files)
    if (name === "mcp.json") {
      const config = JSON.parse(data);
      for (const server of Object.values(config.mcpServers))
        server.env.SHOWAI_CURSOR_WORKBENCH_LINK = "1";
      add("extension/agent-plugins/showai-cursor-ide/" + name, JSON.stringify(config, null, 2) + "\n");
    } else {
      add("extension/agent-plugins/showai-cursor-ide/" + name, data);
    }

  add("extension.vsixmanifest", `<?xml version="1.0" encoding="utf-8"?>
  <PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
    <Metadata>
      <Identity Language="en-US" Id="showai-workbench" Version="${version}" Publisher="renaissancemind"/>
      <DisplayName>ShowAI Workbench</DisplayName>
      <Description xml:space="preserve">Edit original ShowAI pages and boards in your IDE.</Description>
      <Categories>Other</Categories>
      <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.90.0"/></Properties>
    </Metadata>
    <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
    <Dependencies/>
    <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets>
  </PackageManifest>`);
  const mimeTypes = {
    cjs: "application/javascript", mjs: "application/javascript", json: "application/json",
    md: "text/markdown", svg: "image/svg+xml", txt: "text/plain", vsixmanifest: "text/xml",
  };
  const extensions = [...new Set(entries.map(({ name }) => name.split(".").at(-1)))].sort();
  add("[Content_Types].xml", `<?xml version="1.0" encoding="utf-8"?>
  <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  ${extensions.map(ext => `  <Default Extension="${ext}" ContentType="${mimeTypes[ext] ?? "application/octet-stream"}"/>`).join("\n")}
  </Types>`);
  return archive(entries);
}
