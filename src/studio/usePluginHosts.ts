import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DshPendingSteps,
  PluginHost,
  PluginInstallation,
  PluginInstallReceipt,
} from "../plugin/desktop-install";
import type { RuntimeRegistrationStatus } from "../agent/runtime";
import { getLocale, translator } from "../i18n";
import messages from "../i18n/messages/pluginInstall";
import { desktop, errorCode, errorMessage } from "../host/bridge";

export const pluginHostNames: Record<PluginHost, string> = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
  deepseek: "DeepSeek Harness",
};

export function pluginHostList(hosts: PluginHost[]) {
  return new Intl.ListFormat(getLocale(), {
    style: "long",
    type: "conjunction",
  }).format(hosts.map((host) => pluginHostNames[host]));
}

export function pluginActionLabel(
  host: PluginInstallation,
  home?: string | null,
) {
  return host.installed
    ? host.enabled && host.current && !pluginLibraryMismatch(host, home)
      ? ("reinstall" as const)
      : ("update" as const)
    : ("install" as const);
}

export function pluginUpToDate(host: PluginInstallation, home?: string | null) {
  return (
    host.installed &&
    host.enabled &&
    host.current === true &&
    !pluginLibraryMismatch(host, home)
  );
}

export function pluginLibraryMismatch(
  host: PluginInstallation,
  home: string | null | undefined,
) {
  return (
    !!home && host.installed && !!host.boundHome && host.boundHome !== home
  );
}

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

export function pluginActionBlocked(host: PluginInstallation) {
  return !host.executable || !!host.error || !!host.otherSources.length;
}

export function dshInstallIssue(
  steps?: DshPendingSteps,
  automatic = steps?.automatic,
): { message: string; bundlePath?: string } | undefined {
  if (!steps) return;
  const t = translator(messages);
  if (steps.profileMissing) return { message: t("dshOpenOnce") };
  const conflicts = [
    steps.otherSource && t("dshRemoveOther", { source: steps.otherSource }),
    steps.legacyBundles.length > 0 &&
      t("dshRemoveLegacy", { names: steps.legacyBundles.join(", ") }),
    steps.manualMcpRow && t("dshRemoveRow", { path: steps.manualMcpRow }),
    steps.shadowingSkills.length > 0 &&
      t("dshRemoveSkills", { path: steps.skillRoot, names: steps.shadowingSkills.join(", ") }),
  ].filter(Boolean);
  if (conflicts.length) return { message: conflicts.join(" ") };
  if (automatic === "quit") return { message: t("dshQuit") };
  if (automatic === "manual") {
    if (steps.enable) return { message: t("dshEnable") };
    return { message: t("dshManual"), bundlePath: steps.bundlePath };
  }
}

export function pluginNeedsUpdate(host: PluginInstallation) {
  return (
    !pluginActionBlocked(host) &&
    host.installed &&
    host.enabled &&
    host.current === false
  );
}

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
    code?.startsWith("PLUGIN_") &&
    t(key, {
      host: name,
      version: String(data?.minimumVersion ?? ""),
    });
  if (!localized || localized.startsWith("pluginInstall."))
    return { message: raw };
  const output = typeof data?.output === "string" ? data.output : "";
  return {
    message: localized,
    details: [raw, output].filter(Boolean).join("\n\n"),
  };
}

export interface PluginBatchResult {
  updated: PluginHost[];
  failed: { host: PluginHost; message: string; details?: string }[];
}

export function usePluginHosts(home: string | null) {
  const [hosts, setHosts] = useState<PluginInstallation[]>([]);
  const publishHosts = useCallback(
    (next: PluginInstallation[]) => {
      setHosts(next);
      if (home)
        window.dispatchEvent(
          new CustomEvent("showai:plugin-hosts", {
            detail: { home, hosts: next },
          }),
        );
    },
    [home],
  );
  useEffect(() => {
    if (!home) return;
    const changed = (event: Event) => {
      const detail = (
        event as CustomEvent<{ home: string; hosts: PluginInstallation[] }>
      ).detail;
      if (detail.home === home) setHosts(detail.hosts);
    };
    window.addEventListener("showai:plugin-hosts", changed);
    return () => window.removeEventListener("showai:plugin-hosts", changed);
  }, [home]);
  const currentHosts = useRef(hosts);
  currentHosts.current = hosts;
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
  const [installedAt, setInstalledAt] = useState<
    Partial<Record<PluginHost, number>>
  >({});
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
        publishHosts(next);
        setRuntime(registration);
        setReceipt((previous) => previous?.dsh ? null : previous);
      }
    } catch (reason) {
      if (mounted.current) fail(reason);
    } finally {
      if (mounted.current) {
        setBusy(null);
        setScanned(true);
      }
    }
  }, [fail, publishHosts]);
  useEffect(() => {
    mounted.current = true;
    setReceipt(null);
    setScanned(false);
    if (home) void refresh();
  }, [home, refresh]);
  const refreshHost = useCallback(
    async (host: PluginHost) => {
      setBusy(host);
      setError("");
      try {
        const hosts = await desktop.invoke<PluginInstallation[]>(
          "plugins:status",
          { host },
        );
        const next = hosts.find((item) => item.host === host);
        if (mounted.current && next) {
          publishHosts(
            currentHosts.current.map((item) =>
              item.host === host ? next : item,
            ),
          );
          setReceipt((previous) =>
            previous?.host === host && previous.dsh ? null : previous,
          );
        }
      } catch (reason) {
        if (mounted.current) fail(reason, host);
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [fail, publishHosts],
  );
  const install = useCallback(
    async (host: PluginHost, options: { repairRuntime?: boolean } = {}) => {
      setBusy(host);
      setError("");
      setReceipt(null);
      try {
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
        if (!result.dsh)
          setInstalledAt((previous) => ({ ...previous, [host]: Date.now() }));
        publishHosts(
          await desktop.invoke<PluginInstallation[]>("plugins:status"),
        );
        return !result.dsh;
      } catch (reason) {
        if (host === "deepseek" && mounted.current) await refreshHost(host);
        if (mounted.current) fail(reason, host);
        return false;
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [fail, publishHosts, refreshHost],
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
  const setPath = useCallback(
    async (host: PluginHost, path: string) => {
      setBusy(host);
      setError("");
      try {
        const next = await desktop.invoke<PluginInstallation[]>(
          "plugins:setPath",
          { host, path },
        );
        if (mounted.current) publishHosts(next);
      } catch (reason) {
        if (mounted.current) fail(reason, host);
      } finally {
        if (mounted.current) setBusy(null);
      }
    },
    [fail, publishHosts],
  );
  const updateAll = useCallback(
    async (targets: PluginHost[]) => {
      setBusy("all");
      setError("");
      setReceipt(null);
      const result: PluginBatchResult = { updated: [], failed: [] };
      try {
        for (const host of targets) {
          try {
            const installed = await desktop.invoke<PluginInstallReceipt>("plugins:install", {
              host,
            });
            if (installed.dsh) {
              if (mounted.current) setReceipt(installed);
              result.failed.push({
                host,
                message: dshInstallIssue(installed.dsh)?.message
                  ?? translator(messages)("dshStaged"),
              });
              continue;
            }
            result.updated.push(host);
            if (mounted.current)
              setInstalledAt((previous) => ({
                ...previous,
                [host]: Date.now(),
              }));
          } catch (reason) {
            result.failed.push({
              host,
              ...pluginErrorText(reason, host),
            });
          }
        }
        const next =
          await desktop.invoke<PluginInstallation[]>("plugins:status");
        if (mounted.current) publishHosts(next);
      } catch (reason) {
        if (mounted.current) fail(reason);
      } finally {
        if (mounted.current) setBusy(null);
      }
      return result;
    },
    [fail, publishHosts],
  );
  return {
    hosts,
    scanned,
    busy,
    error,
    errorDetails,
    receipt,
    runtime,
    refresh,
    refreshHost,
    installedAt,
    install,
    updateAll,
    repairRuntime,
    setPath,
  };
}
