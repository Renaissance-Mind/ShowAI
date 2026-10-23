#!/usr/bin/env node
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve only the host-selected library. Never scan other libraries or fall back after a failure.
const home = resolve(process.env.SHOWAI_HOME || join(homedir(), ".showai"));
const configPath =
  process.env.SHOWAI_RUNTIME_CONFIG || join(home, "agent-runtime.json");
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** A launch failure the person can fix; served through one diagnostic MCP tool. */
class LaunchProblem extends Error {
  constructor(code, detail) {
    super(detail);
    this.code = code;
  }
}

// Each code answers: what happened, whether content is safe, and what to do.
const PROBLEMS = {
  RUNTIME_MISSING: {
    en: "This content library has no registered ShowAI runtime (agent-runtime.json is missing).",
    zh: "这个内容库还没有登记 ShowAI 运行时（缺少 agent-runtime.json）。",
    steps: {
      en: [
        "Open the ShowAI app once; it registers its runtime for the current library.",
        "In ShowAI, open Settings → Plugins and check 'Registered runtime'; click 'Repair registration' if needed.",
        "Restart the agent session and try again.",
      ],
      zh: [
        "打开一次 ShowAI App，它会为当前内容库登记运行时。",
        "在 ShowAI「设置 → 插件」查看「当前登记的运行时」，必要时点「修复登记」。",
        "重启 Agent 会话后重试。",
      ],
    },
  },
  RUNTIME_INVALID: {
    en: "The runtime registration (agent-runtime.json) cannot be read or has an unexpected format.",
    zh: "运行时登记文件 agent-runtime.json 无法读取或格式不正确。",
    steps: {
      en: [
        "In ShowAI, open Settings → Plugins and click 'Repair registration'.",
        "Restart the agent session and try again.",
      ],
      zh: [
        "在 ShowAI「设置 → 插件」点「修复登记」。",
        "重启 Agent 会话后重试。",
      ],
    },
  },
  LIBRARY_MISMATCH: {
    en: "The plugin is bound to a different content library than the registered runtime.",
    zh: "插件连接的内容库与登记的运行时所属内容库不一致。",
    steps: {
      en: [
        "In ShowAI, select the content library this agent should use.",
        "Open Settings → Plugins and click 'Update and enable' for this agent.",
        "Restart the agent session and try again.",
      ],
      zh: [
        "在 ShowAI 中选定这个 Agent 应使用的内容库。",
        "打开「设置 → 插件」，为这个 Agent 点「更新并启用」。",
        "重启 Agent 会话后重试。",
      ],
    },
  },
  RUNTIME_UNAVAILABLE: {
    en: "The registered ShowAI runtime cannot be started; the app may have been moved or deleted.",
    zh: "登记的 ShowAI 运行时无法启动，App 可能已被移动或删除。",
    steps: {
      en: [
        "Open ShowAI from its current location, then open Settings → Plugins and click 'Repair registration'.",
        "Click 'Update and enable' for this agent, then restart the agent session.",
      ],
      zh: [
        "从 ShowAI 当前所在位置打开 App，在「设置 → 插件」点「修复登记」。",
        "为这个 Agent 点「更新并启用」，然后重启 Agent 会话。",
      ],
    },
  },
  RUNTIME_PROBE_FAILED: {
    en: "The registered ShowAI runtime failed its startup check.",
    zh: "登记的 ShowAI 运行时未通过启动检查。",
    steps: {
      en: [
        "Open ShowAI, then open Settings → Plugins and click 'Repair registration'.",
        "Restart the agent session. If it still fails, copy the diagnostics from Settings → About & feedback.",
      ],
      zh: [
        "打开 ShowAI，在「设置 → 插件」点「修复登记」。",
        "重启 Agent 会话。仍然失败时，在「设置 → 关于与反馈」复制诊断信息。",
      ],
    },
  },
  RUNTIME_OUTDATED: {
    en: "The registered ShowAI runtime is older than this plugin and lacks the tools the plugin needs.",
    zh: "登记的 ShowAI 运行时比插件旧，不支持插件需要的工具。",
    steps: {
      en: [
        "Open the newest ShowAI app; if another build registered itself, click 'Repair registration' in Settings → Plugins.",
        "Click 'Update and enable' for this agent, then restart the agent session.",
      ],
      zh: [
        "打开最新版 ShowAI App；如果登记的是其他版本，在「设置 → 插件」点「修复登记」。",
        "为这个 Agent 点「更新并启用」，然后重启 Agent 会话。",
      ],
    },
  },
  LAUNCH_CONFIG_INVALID: {
    en: "The plugin launch configuration in this agent is invalid.",
    zh: "这个 Agent 中的插件启动配置有误。",
    steps: {
      en: [
        "Reinstall the plugin from ShowAI Settings → Plugins, or correct the environment variables in the agent's MCP configuration.",
        "Restart the agent session.",
      ],
      zh: [
        "在 ShowAI「设置 → 插件」重新安装插件，或修正 Agent MCP 配置中的环境变量。",
        "重启 Agent 会话。",
      ],
    },
  },
  RUNTIME_START_FAILED: {
    en: "The ShowAI runtime could not be started.",
    zh: "ShowAI 运行时未能启动。",
    steps: {
      en: [
        "Open ShowAI, then open Settings → Plugins and click 'Repair registration'.",
        "Restart the agent session.",
      ],
      zh: ["打开 ShowAI，在「设置 → 插件」点「修复登记」。", "重启 Agent 会话。"],
    },
  },
};
const DOCS_URL =
  "https://showai.renaissancemind.ai/doc/agent-troubleshooting";
const REPORT_URL = "https://github.com/Renaissance-Mind/ShowAI/issues/new";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
async function pluginVersion() {
  // Codex and Claude Code read plugin.json; DeepSeek Harness bundles carry package.json.
  for (const file of [
    "plugin.json",
    ".claude-plugin/plugin.json",
    "package.json",
  ]) {
    const value = await readJson(join(pluginRoot, file)).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (typeof value?.version === "string") return value.version;
  }
  return undefined;
}

/** Fingerprint of the runtime files a probe result depends on. */
async function probeKey(config, text) {
  const files = await Promise.all(
    [config.launch.command, config.launch.args[0]].map(async (path) => {
      const value = await stat(path);
      return [path, value.size, value.mtimeMs];
    }),
  );
  return createHash("sha256")
    .update(JSON.stringify([text, files]))
    .digest("hex");
}

async function probe(config, text, env) {
  const cachePath = join(home, "local", "agent-runtime-probe.json");
  const key = await probeKey(config, text).catch((error) => {
    throw new LaunchProblem("RUNTIME_UNAVAILABLE", error.message);
  });
  // A missing or unreadable cache only costs one probe.
  const cached = await readJson(cachePath).catch((error) => {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  });
  if (cached?.key === key && cached.info) return cached.info;
  const result = await promisify(execFile)(
    config.launch.command,
    [...config.launch.args, "runtime", "info", "--json"],
    { env, timeout: 30000, maxBuffer: 1024 * 1024 },
  ).catch((error) => {
    throw new LaunchProblem(
      error.code === "ENOENT" || error.code === "EACCES"
        ? "RUNTIME_UNAVAILABLE"
        : "RUNTIME_PROBE_FAILED",
      [
        error.killed
          ? `stopped after ${error.signal ?? "timeout"}`
          : error.signal
            ? `signal ${error.signal}`
            : typeof error.code === "number"
              ? `exit ${error.code}`
              : "",
        (error.stderr || error.message || String(error)).trim(),
      ]
        .filter(Boolean)
        .join(": ")
        .slice(-2000),
    );
  });
  let info;
  try {
    info = JSON.parse(result.stdout);
  } catch (error) {
    throw new LaunchProblem("RUNTIME_PROBE_FAILED", error.message);
  }
  // Only the fields this launcher checks are cached; a changed runtime file changes the key.
  const kept = {
    ok: info.ok,
    data: {
      version: info.data?.version,
      home: info.data?.home,
      capabilities: info.data?.capabilities,
    },
  };
  if (kept.ok) {
    const temporary = `${cachePath}.${randomUUID()}.tmp`;
    await mkdir(dirname(cachePath), { recursive: true })
      .then(() => writeFile(temporary, JSON.stringify({ key, info: kept }) + "\n"))
      .then(() => rename(temporary, cachePath))
      .catch((error) =>
        // The cache only saves time; the next launch probes again.
        process.stderr.write(`ShowAI could not cache the runtime probe: ${error.message}\n`),
      );
  }
  return kept;
}

async function prepare() {
  const text = await readFile(configPath, "utf8").catch((error) => {
    throw new LaunchProblem(
      error.code === "ENOENT" ? "RUNTIME_MISSING" : "RUNTIME_INVALID",
      error.message,
    );
  });
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new LaunchProblem("RUNTIME_INVALID", error.message);
  }
  if (
    config?.format !== "showai-agent-runtime" ||
    config.protocol !== 1 ||
    typeof config.home !== "string" ||
    !isAbsolute(config.launch?.command ?? "") ||
    !Array.isArray(config.launch?.args) ||
    !config.launch.args.length ||
    !config.launch.args.every((x) => typeof x === "string")
  )
    throw new LaunchProblem(
      "RUNTIME_INVALID",
      "Unexpected format, protocol or launch command in agent-runtime.json.",
    );
  if (resolve(config.home) !== home)
    throw new LaunchProblem(
      "LIBRARY_MISMATCH",
      `Registered library ${config.home}; plugin library ${home}. No other library was selected.`,
    );
  const version = await pluginVersion();
  const env = {
    ...process.env,
    ...config.launch.env,
    SHOWAI_HOME: home,
    ...(version ? { SHOWAI_PLUGIN_VERSION: version } : {}),
  };
  const info = await probe(config, text, env);
  const capabilities = info.data?.capabilities ?? {};
  const outdated = (detail) => {
    throw new LaunchProblem(
      "RUNTIME_OUTDATED",
      `Registered runtime ${info.data?.version ?? "unknown"}: ${detail}`,
    );
  };
  if (!info.ok || resolve(info.data?.home || "") !== home)
    throw new LaunchProblem(
      "LIBRARY_MISMATCH",
      "The registered runtime reports another library.",
    );
  if (capabilities.agentOperations?.protocol !== "showai-mcp-v1")
    outdated("no unified MCP entry (showai-mcp-v1).");
  const templateProtocol = capabilities.templateWorkflow?.protocol;
  if (
    !["showai-template-workflow-v2", "showai-template-workflow-v1"].includes(
      templateProtocol,
    )
  )
    outdated("no staged template workflow (template_context/template_guide).");
  if (templateProtocol === "showai-template-workflow-v1")
    process.stderr.write(
      "ShowAI runtime still serves the six-stage template workflow (v1); the installed skills describe the four-stage workflow (v2). Update the registered runtime to use intent/material/logic/design stages.\n",
    );
  if (
    capabilities.componentParameters?.protocol !==
    "showai-component-parameters-v1"
  )
    outdated("no versioned component parameters.");
  if (capabilities.agentOperations?.toolSurface !== "showai-mcp-tools-v2")
    outdated(
      "no merged tool surface (organization_update, dataset_write, draft_write).",
    );
  const args = [...config.launch.args, "mcp"];
  if (process.env.SHOWAI_TEMPLATES) {
    if (!process.env.SHOWAI_PROJECT_ID)
      throw new LaunchProblem(
        "LAUNCH_CONFIG_INVALID",
        "Startup SHOWAI_TEMPLATES requires SHOWAI_PROJECT_ID; library clients select task templates with template_context.",
      );
    args.push("--templates", process.env.SHOWAI_TEMPLATES);
  }
  if (process.env.SHOWAI_PROJECT_ID)
    args.push("--project", process.env.SHOWAI_PROJECT_ID);
  if (process.env.SHOWAI_PRESENTATION_DIR) {
    if (!isAbsolute(process.env.SHOWAI_PRESENTATION_DIR))
      throw new LaunchProblem(
        "LAUNCH_CONFIG_INVALID",
        "SHOWAI_PRESENTATION_DIR must be an absolute host-owned output directory.",
      );
    args.push("--presentation-directory", process.env.SHOWAI_PRESENTATION_DIR);
  }
  return { command: config.launch.command, args, env, version };
}

/** Library-relative names; the record and the tool never show the person's home or secrets. */
const redact = (text) =>
  String(text ?? "")
    .split(home)
    .join("<library>")
    .split(homedir())
    .join("~")
    .replace(/(token|key|secret|password)=\S+/gi, "$1=<redacted>")
    .slice(0, 2000);

function connectionFile(client) {
  const slug = client
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const digest = createHash("sha256").update(client).digest("hex").slice(0, 8);
  return `${slug || "client"}-${digest}-failure.json`;
}

/** Lets Settings → Plugins show the latest failure of each host next to its calls. */
async function recordFailure(problem, client, version) {
  // Only an existing library receives a record; a mistyped SHOWAI_HOME is not created.
  const exists = await stat(home).then(
    (value) => value.isDirectory(),
    () => false,
  );
  if (!exists) return;
  const directory = join(home, "local", "agent-connections");
  await mkdir(directory, { recursive: true });
  const path = join(directory, connectionFile(client.name));
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify(
      {
        format: "showai-connection-failure",
        client: client.name,
        ...(client.version ? { clientVersion: client.version } : {}),
        ...(version ? { pluginVersion: version } : {}),
        code: problem.code,
        message: PROBLEMS[problem.code].en,
        detail: redact(problem.message),
        at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  await rename(temporary, path);
}

/**
 * Completes the MCP handshake and exposes one diagnostic tool, so the host shows
 * a readable reason instead of "connection closed". Nothing in the library changes
 * except the failure record.
 */
async function serveProblem(problem) {
  const code = problem instanceof LaunchProblem ? problem.code : "RUNTIME_START_FAILED";
  const failure =
    problem instanceof LaunchProblem
      ? problem
      : new LaunchProblem(code, problem?.message ?? String(problem));
  const text = PROBLEMS[code];
  const version = await pluginVersion().catch(() => undefined);
  process.stderr.write(
    `ShowAI could not start (${code}): ${text.en} ${failure.message}\n`,
  );
  process.exitCode = 1;
  const report = {
    ok: false,
    error: {
      code,
      message: text.en,
      userMessage: { en: text.en, "zh-CN": text.zh },
      steps: { en: text.steps.en, "zh-CN": text.steps.zh },
      contentSafe:
        "No ShowAI content was read or changed; the library is untouched.",
      detail: redact(failure.message),
      nextStep:
        "Tell the user which step failed and relay the steps in their language. Do not retry other ShowAI tools, switch libraries or edit configuration files until the user has fixed this and restarted the session.",
      support: {
        docsUrl: DOCS_URL,
        reportUrl: REPORT_URL,
        appPath: "设置 → 关于与反馈 / Settings → About & feedback",
        ...(version ? { pluginVersion: version } : {}),
      },
    },
  };
  const send = (message) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    if (message.id === undefined || message.id === null) continue;
    if (message.method === "initialize") {
      const info = message.params?.clientInfo;
      if (typeof info?.name === "string" && info.name.trim())
        await recordFailure(
          failure,
          {
            name: info.name.trim().slice(0, 200),
            version:
              typeof info.version === "string"
                ? info.version.slice(0, 100)
                : undefined,
          },
          version,
        ).catch((error) =>
          process.stderr.write(
            `ShowAI could not record the connection failure: ${error.message}\n`,
          ),
        );
      send({
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "showai", version: version ?? "unknown" },
          instructions: `ShowAI is not connected (${code}). Call showai_connection_problem and relay its reason and steps to the user.`,
        },
      });
    } else if (message.method === "ping") send({ id: message.id, result: {} });
    else if (message.method === "tools/list")
      send({
        id: message.id,
        result: {
          tools: [
            {
              name: "showai_connection_problem",
              description:
                "ShowAI failed to start. Returns the reason and fix steps to relay to the user.",
              inputSchema: { type: "object", properties: {} },
              annotations: { readOnlyHint: true },
            },
          ],
        },
      });
    else if (message.method === "tools/call")
      send({
        id: message.id,
        result: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(report) }],
          structuredContent: report,
        },
      });
    else
      send({
        id: message.id,
        error: { code: -32601, message: `ShowAI is not connected (${code}).` },
      });
  }
}

let launch;
try {
  launch = await prepare();
} catch (error) {
  await serveProblem(error);
}
if (launch) {
  const child = spawn(launch.command, launch.args, {
    env: launch.env,
    stdio: "inherit",
  });
  // A spawn error happens before the child reads stdin, so the handshake is still ours to answer.
  child.once("error", (error) => {
    void serveProblem(new LaunchProblem("RUNTIME_START_FAILED", error.message));
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => child.kill(signal));
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
