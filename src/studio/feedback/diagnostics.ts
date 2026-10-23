/**
 * The diagnostic report behind 复制诊断信息 / 导出诊断包 / 附加诊断信息.
 * Contains versions, mode, language, library format, built-in Agent
 * readiness, plugin hosts, sync hosts and the latest problems. Never page
 * content, conversations, account names, tokens or keys; the library path
 * only when the person includes it.
 */
import type { AgentHostStatus } from "../../agent-host/types";
import type { AgentConnectionRecord } from "../../agent/mcp-connections";
import type { RuntimeRegistrationStatus } from "../../agent/runtime";
import { redact } from "../../core/redact";
import type { DesktopInfo } from "../../desktop/bridge";
import { getLocale } from "../../i18n";
import type { PluginInstallation } from "../../plugin/desktop-install";
import type { SyncConfiguration } from "../../sync/protocol";
import { agentReadiness } from "../AgentReadiness";
import { desktop, errorCode, errorMessage } from "../bridge";
import { verifyState } from "../PluginInstallSettings";
import { recentProblems, type LoggedProblem } from "../problems/problem-log";
import { pluginHostNames } from "../usePluginHosts";

export const DIAGNOSTIC_LOG_LINES = 200;

/** A part that could not be read is reported with its code, not left out. */
export type Part<T> = { ok: true; value: T } | { ok: false; error: string };

type SyncStatus = Omit<SyncConfiguration, "connections"> & {
  connections: Omit<SyncConfiguration["connections"][number], "token">[];
  running?: boolean;
};

export interface DiagnosticsInput {
  generatedAt: string;
  info: DesktopInfo | null;
  locale: string;
  systemLanguage?: string;
  agent?: Part<AgentHostStatus>;
  plugins?: Part<PluginInstallation[]>;
  connections?: Part<AgentConnectionRecord[]>;
  runtime?: Part<RuntimeRegistrationStatus>;
  sync?: Part<SyncStatus>;
  problems: LoggedProblem[];
  includeLibraryPath?: boolean;
  /** Redacted tail of the main-process log. */
  log?: Part<string>;
}

const platforms: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
  ios: "iPadOS",
};

export function shortCommit(commit?: string) {
  return commit && /^[0-9a-f]{7,40}$/i.test(commit)
    ? commit.slice(0, 7)
    : commit || "unknown";
}

export function versionLine(info: DesktopInfo | null) {
  return info ? `${info.version} (${shortCommit(info.sourceCommit)})` : "—";
}

export function platformLine(info: DesktopInfo | null) {
  if (!info) return "—";
  return [platforms[info.platform] ?? info.platform, info.osVersion, info.arch]
    .filter(Boolean)
    .join(" ");
}

export function runtimeLine(info: DesktopInfo | null) {
  const versions = info?.versions;
  if (!versions) return "—";
  return [
    versions.electron && `Electron ${versions.electron}`,
    versions.chrome && `Chrome ${versions.chrome}`,
    `Node ${versions.node}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function modeLine(info: DesktopInfo | null) {
  if (!info) return "—";
  return `${info.mode ?? "desktop"} · ${info.packaged ? "packaged" : "development"}`;
}

/** One line per plugin host: install state and the latest connection result. */
export function pluginLines(
  hosts: PluginInstallation[],
  records: AgentConnectionRecord[],
  home?: string,
): string[] {
  return hosts.map((host) => {
    const install = !host.executable
      ? "host not found"
      : host.installed
        ? [
            `plugin ${host.version ?? "installed"}`,
            host.enabled ? "enabled" : "disabled",
            host.current === false ? "outdated" : host.current ? "current" : "",
            home && host.boundHome && host.boundHome !== home
              ? "bound to another library"
              : "",
          ]
            .filter(Boolean)
            .join(", ")
        : host.installedPath
          ? "bundle staged"
          : "plugin not installed";
    const state = verifyState(host, records);
    const connection =
      state.kind === "failed"
        ? `last connection failed ${state.code} at ${state.at}`
        : state.kind === "called"
          ? `last call ok at ${state.at}`
          : state.kind === "connected"
            ? `last connection ok at ${state.at}`
            : state.kind === "notSinceInstall"
              ? "no connection since the current install"
              : "no connection recorded";
    const error = host.errorCode ?? (host.error ? "ERROR" : "");
    return `  ${pluginHostNames[host.host]}: ${install}; ${connection}${error ? `; error ${error}` : ""}${host.otherSources.length ? "; another ShowAI plugin source installed" : ""}`;
  });
}

function agentLines(status: AgentHostStatus): string[] {
  const { settings } = status;
  const readiness = agentReadiness(status);
  const execution =
    settings.mode === "local"
      ? `local (${settings.localAgent})`
      : `API (${settings.sources.find((item) => item.id === settings.sourceId)?.provider ?? "no source"})`;
  return [
    `  Mode: ${execution}${status.executionKind ? ` on ${status.executionKind}` : ""}`,
    `  Readiness: ${readiness.kind}`,
    `  Runtime: ${status.runtime.state}`,
    ...(settings.mode === "local"
      ? [
          `  Local agents: ${
            status.agents
              .map(
                (agent) =>
                  `${agent.id}${agent.path ? "" : " (not found)"}${agent.auth === "missing" ? " (signed out)" : ""}`,
              )
              .join(", ") || "none detected"
          }`,
        ]
      : []),
  ];
}

function syncLines(status: SyncStatus): string[] {
  const counts = new Map<string, number>();
  for (const project of status.projects)
    counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
  const now = Date.now();
  return [
    ...status.connections.map((connection) => {
      const host = URL.canParse(connection.url)
        ? new URL(connection.url).host
        : "invalid URL";
      const state = connection.signedOut
        ? "signed out"
        : connection.expiresAt && Date.parse(connection.expiresAt) < now
          ? "session expired"
          : "signed in";
      return `  ${host}: ${state}${connection.id === status.defaultConnectionId ? " (default)" : ""}`;
    }),
    ...(status.connections.length ? [] : ["  No sync connection"]),
    `  Projects: ${
      [...counts].map(([state, count]) => `${count} ${state}`).join(", ") ||
      "none synced"
    }${status.connections.length && status.running === false ? " (sync stopped)" : ""}`,
  ];
}

function part<T>(
  label: string,
  value: Part<T> | undefined,
  lines: (value: T) => string[],
): string[] {
  if (!value) return [];
  return [`${label}:`, ...(value.ok ? lines(value.value) : [`  unavailable (${value.error})`])];
}

/** The plain-text report; paths and secrets are redacted. */
export function formatDiagnostics(input: DiagnosticsInput): string {
  const { info } = input;
  const libraryRedaction = info?.home ? { library: info.home } : {};
  const body = [
    "ShowAI diagnostics",
    `Generated: ${input.generatedAt}`,
    `Version: ${versionLine(info)}`,
    `Source commit: ${info?.sourceCommit ?? "unknown"}`,
    `Mode: ${modeLine(info)}`,
    `Platform: ${platformLine(info)}`,
    `Runtime: ${runtimeLine(info)}`,
    `Language: ${input.locale}${input.systemLanguage ? ` (system ${input.systemLanguage})` : ""}`,
    `Library format: ${info?.libraryVersion ? `v${info.libraryVersion}` : "unknown"}`,
    ...part("Built-in Agent", input.agent, agentLines),
    ...part("Agent plugins", input.plugins, (hosts) =>
      pluginLines(
        hosts,
        input.connections?.ok ? input.connections.value : [],
        info?.home,
      ),
    ),
    ...(input.connections && !input.connections.ok
      ? [`  Connection records unavailable (${input.connections.error})`]
      : []),
    ...part("Runtime registration", input.runtime, (runtime) => [
      `  ${runtime.state}${runtime.reason ? ` (${runtime.reason})` : ""}; this App ${runtime.current.version}${runtime.registered ? `; registered ${runtime.registered.version}${runtime.registered.channel ? ` ${runtime.registered.channel}` : ""}${runtime.registered.home === info?.home ? "" : ", other library"}` : ""}`,
    ]),
    ...part("Sync", input.sync, syncLines),
    `Recent problems (${input.problems.length}):`,
    ...(input.problems.length
      ? input.problems
          .slice(-20)
          .map(
            (item) =>
              `  ${item.at}  ${item.source}  ${item.code}  ${item.message}`,
          )
      : ["  none in this window"]),
  ].join("\n");
  const redacted = redact(body, { ...libraryRedaction, truncateIds: true });
  const library =
    input.includeLibraryPath && info?.home
      ? [`Library path: ${redact(info.home)}`]
      : [];
  const log = input.log
    ? input.log.ok
      ? [
          "",
          `Recent log (last ${DIAGNOSTIC_LOG_LINES} lines, redacted):`,
          redact(input.log.value, libraryRedaction) || "  (empty)",
        ]
      : ["", `Recent log unavailable (${input.log.error})`]
    : [];
  return [redacted, ...library, ...log].join("\n");
}

async function read<T>(load: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    // Reported in the text; a missing part must not block the rest of the report.
    return {
      ok: false,
      error: errorCode(error) ?? (errorMessage(error).slice(0, 80) || "ERROR"),
    };
  }
}

export interface GatherOptions {
  info: DesktopInfo | null;
  includeLibraryPath?: boolean;
  includeLog?: boolean;
}

/** Reads every part from the App; desktop-only parts are skipped in the browser. */
export async function gatherDiagnostics(
  options: GatherOptions,
): Promise<string> {
  const { info } = options;
  const plugins = info?.platform !== "ios";
  const [agent, hosts, onboarding, runtime, sync, log] = await Promise.all([
    read(() =>
      desktop.invoke<AgentHostStatus>("agent:status", { projectId: null }),
    ),
    plugins
      ? read(() => desktop.invoke<PluginInstallation[]>("plugins:status"))
      : undefined,
    plugins
      ? read(() =>
          desktop.invoke<{ connections: AgentConnectionRecord[] }>(
            "agent:onboarding",
          ),
        )
      : undefined,
    plugins
      ? read(() => desktop.invoke<RuntimeRegistrationStatus>("plugins:runtime"))
      : undefined,
    read(() => desktop.invoke<SyncStatus>("sync:status")),
    options.includeLog && window.showai?.logTail
      ? read(() => window.showai!.logTail!(DIAGNOSTIC_LOG_LINES))
      : undefined,
  ]);
  return formatDiagnostics({
    generatedAt: new Date().toISOString(),
    info,
    locale: getLocale(),
    systemLanguage:
      typeof navigator === "undefined" ? undefined : navigator.language,
    agent,
    plugins: hosts,
    connections: onboarding
      ? onboarding.ok
        ? { ok: true, value: onboarding.value.connections }
        : onboarding
      : undefined,
    runtime,
    sync,
    problems: recentProblems(),
    includeLibraryPath: options.includeLibraryPath,
    log,
  });
}
