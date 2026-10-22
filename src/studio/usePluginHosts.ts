import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PluginHost,
  PluginInstallation,
  PluginInstallReceipt,
} from "../plugin/desktop-install";
import type { RuntimeRegistrationStatus } from "../agent/runtime";
import { getLocale, translator } from "../i18n";
import messages from "../i18n/messages/pluginInstall";
import { desktop, errorCode, errorMessage } from "./bridge";

export const pluginHostNames: Record<PluginHost, string> = {
  codex: "Codex",
  claude: "Claude Code",
  deepseek: "DeepSeek Harness",
};

/** Host names as one phrase in the interface language ("Codex and Claude Code"). */
export function pluginHostList(hosts: PluginHost[]) {
  return new Intl.ListFormat(getLocale(), {
    style: "long",
    type: "conjunction",
  }).format(hosts.map((host) => pluginHostNames[host]));
}

/** Label key (pluginInstall messages) of the install action for one host. */
export function pluginActionLabel(
  host: PluginInstallation,
  home?: string | null,
) {
  return host.host === "deepseek"
    ? host.installedPath
      ? ("dshUpdate" as const)
      : ("dshPrepare" as const)
    : host.installed
      ? host.enabled && host.current && !pluginLibraryMismatch(host, home)
        ? ("reinstall" as const)
        : ("update" as const)
      : ("install" as const);
}

/** Codex or Claude Code already runs the plugin this App would install; nothing to do. */
export function pluginUpToDate(
  host: PluginInstallation,
  home?: string | null,
) {
  return (
    host.installed &&
    host.enabled &&
    host.current === true &&
    !pluginLibraryMismatch(host, home)
  );
}

/** The installed plugin is bound to another library than the App's current one. */
export function pluginLibraryMismatch(
  host: PluginInstallation,
  home: string | null | undefined,
) {
  return (
    !!home && host.installed && !!host.boundHome && host.boundHome !== home
  );
}

/**
 * Welcome text key (onboarding messages) for a host: detection, then plugin
 * state, refined by the host's own login check when the Agent scan has one.
 */
export function pluginHostState(
  host: PluginInstallation,
  auth?: "ready" | "missing" | "unknown",
  home?: string | null,
) {
  if (!host.executable) return "connect.notFound" as const;
  if (host.error) return "connect.failed" as const;
  if (host.otherSources.length) return "connect.otherSource" as const;
  if (host.installed)
    return !host.enabled
      ? ("connect.disabled" as const)
      : pluginLibraryMismatch(host, home)
        ? ("connect.libraryMismatch" as const)
        : host.current === false
          ? ("connect.outdated" as const)
          : ("connect.enabled" as const);
  if (host.host === "deepseek" && host.installedPath)
    return "connect.dshStaged" as const;
  return auth === "ready"
    ? ("connect.signedIn" as const)
    : auth === "missing"
      ? ("connect.signedOut" as const)
      : ("connect.found" as const);
}

/** The host must exist and own the ShowAI plugin identity before installing. */
export function pluginActionBlocked(host: PluginInstallation) {
  return !host.executable || !!host.error || !!host.otherSources.length;
}

/**
 * The host runs the App's plugin, but from an earlier App, another library or a
 * moved App. Hosts without the plugin or with another source are left alone.
 */
export function pluginNeedsUpdate(host: PluginInstallation) {
  return (
    !pluginActionBlocked(host) &&
    host.installed &&
    host.enabled &&
    host.current === false
  );
}

/** Localized text of a plugin error code; the host CLI's own output stays in technical details. */
export function pluginErrorText(
  reason: unknown,
  host?: PluginHost,
): { message: string; details?: string } {
  const t = translator(messages);
  const code = errorCode(reason);
  const raw = errorMessage(reason);
  const data =
    reason && typeof reason === "object" && "details" in reason
      ? (reason.details as Record<string, unknown> | undefined)
      : undefined;
  const key = `error.${code}` as Parameters<typeof t>[0];
  const name = pluginHostNames[(data?.host as PluginHost) ?? host ?? "codex"];
  const localized =
    code?.startsWith("PLUGIN_") && t(key, {
      host: name,
      version: String(data?.minimumVersion ?? ""),
    });
  // An unknown code falls back to the namespaced key; show the original message then.
  if (!localized || localized.startsWith("pluginInstall.")) return { message: raw };
  const output = typeof data?.output === "string" ? data.output : "";
  return { message: localized, details: [raw, output].filter(Boolean).join("\n\n") };
}

export interface PluginBatchResult {
  updated: PluginHost[];
  failed: { host: PluginHost; message: string }[];
}

/**
 * Plugin detection and installation shared by Settings → Plugins and the welcome,
 * served by the desktop App or the local browser server. `home` is null where the
 * host CLIs are unreachable (iPad); nothing is scanned then.
 */
export function usePluginHosts(home: string | null) {
  const [hosts, setHosts] = useState<PluginInstallation[]>([]);
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState<
    PluginHost | "scan" | "all" | "runtime" | null
  >(null);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState("");
  const [runtime, setRuntime] = useState<RuntimeRegistrationStatus | null>(
    null,
  );
  const fail = useCallback((reason: unknown, host?: PluginHost) => {
    const text = pluginErrorText(reason, host);
    setError(text.message);
    setErrorDetails(text.details ?? "");
  }, []);
  const [receipt, setReceipt] = useState<PluginInstallReceipt | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const refresh = useCallback(async () => {
    setBusy("scan");
    setError("");
    try {
      const [next, registration] = await Promise.all([
        desktop.invoke<PluginInstallation[]>("plugins:status"),
        desktop.invoke<RuntimeRegistrationStatus>("plugins:runtime"),
      ]);
      if (mounted.current) {
        setHosts(next);
        setRuntime(registration);
      }
    } catch (reason) {
      if (mounted.current) fail(reason);
    } finally {
      if (mounted.current) {
        setBusy(null);
        setScanned(true);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    setReceipt(null);
    setScanned(false);
    if (home) void refresh();
  }, [home, refresh]);
  const install = useCallback(
    async (host: PluginHost, options: { repairRuntime?: boolean } = {}) => {
      setBusy(host);
      setError("");
      setReceipt(null);
      try {
        // 修复并重新连接: register this App first, then bind the plugin to this library.
        if (options.repairRuntime)
          setRuntime(
            await desktop.invoke<RuntimeRegistrationStatus>(
              "plugins:repairRuntime",
            ),
          );
        const result = await desktop.invoke<PluginInstallReceipt>(
          "plugins:install",
          { host },
        );
        if (!mounted.current) return false;
        setReceipt(result);
        setHosts(await desktop.invoke<PluginInstallation[]>("plugins:status"));
        return true;
      } catch (reason) {
        if (mounted.current) fail(reason, host);
        return false;
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [fail],
  );
  const repairRuntime = useCallback(async () => {
    setBusy("runtime");
    setError("");
    try {
      const next = await desktop.invoke<RuntimeRegistrationStatus>(
        "plugins:repairRuntime",
      );
      if (mounted.current) setRuntime(next);
    } catch (reason) {
      if (mounted.current) fail(reason);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [fail]);
  /** A host executable chosen by hand; an empty path returns to detection. */
  const setPath = useCallback(
    async (host: PluginHost, path: string) => {
      setBusy(host);
      setError("");
      try {
        const next = await desktop.invoke<PluginInstallation[]>(
          "plugins:setPath",
          { host, path },
        );
        if (mounted.current) setHosts(next);
      } catch (reason) {
        if (mounted.current) fail(reason, host);
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [fail],
  );
  /** Updates hosts one at a time; the App installs a single plugin at once. */
  const updateAll = useCallback(async (targets: PluginHost[]) => {
    setBusy("all");
    setError("");
    setReceipt(null);
    const result: PluginBatchResult = { updated: [], failed: [] };
    try {
      for (const host of targets) {
        try {
          await desktop.invoke<PluginInstallReceipt>("plugins:install", {
            host,
          });
          result.updated.push(host);
        } catch (reason) {
          // Each host is updated independently; one failure must not stop the others.
          result.failed.push({
            host,
            message: pluginErrorText(reason, host).message,
          });
        }
      }
      const next = await desktop.invoke<PluginInstallation[]>("plugins:status");
      if (mounted.current) setHosts(next);
    } catch (reason) {
      if (mounted.current) fail(reason);
    } finally {
      if (mounted.current) setBusy(null);
    }
    return result;
  }, [fail]);
  return {
    hosts,
    scanned,
    busy,
    error,
    errorDetails,
    receipt,
    runtime,
    refresh,
    install,
    updateAll,
    repairRuntime,
    setPath,
  };
}
