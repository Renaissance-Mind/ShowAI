import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PluginHost,
  PluginInstallation,
  PluginInstallReceipt,
} from "../plugin/desktop-install";
import { desktop, errorMessage } from "./bridge";

export const pluginHostNames: Record<PluginHost, string> = {
  codex: "Codex",
  claude: "Claude Code",
  deepseek: "DeepSeek Harness",
};

/** Label key (pluginInstall messages) of the install action for one host. */
export function pluginActionLabel(host: PluginInstallation) {
  return host.host === "deepseek"
    ? host.installedPath
      ? ("dshUpdate" as const)
      : ("dshPrepare" as const)
    : host.installed
      ? ("update" as const)
      : ("install" as const);
}

/**
 * Welcome text key (onboarding messages) for a host: detection, then plugin
 * state, refined by the host's own login check when the Agent scan has one.
 */
export function pluginHostState(
  host: PluginInstallation,
  auth?: "ready" | "missing" | "unknown",
) {
  if (!host.executable) return "connect.notFound" as const;
  if (host.error) return "connect.failed" as const;
  if (host.otherSources.length) return "connect.otherSource" as const;
  if (host.installed)
    return host.enabled
      ? ("connect.enabled" as const)
      : ("connect.disabled" as const);
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
 * Desktop plugin detection and installation shared by Settings → Plugins and
 * the welcome. `home` is null where the host CLIs are unreachable (browser
 * workbench, iPad); nothing is scanned then.
 */
export function usePluginHosts(home: string | null) {
  const [hosts, setHosts] = useState<PluginInstallation[]>([]);
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState<PluginHost | "scan" | null>(null);
  const [error, setError] = useState("");
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
      const next = await desktop.invoke<PluginInstallation[]>(
        "plugins:status",
      );
      if (mounted.current) setHosts(next);
    } catch (reason) {
      if (mounted.current) setError(errorMessage(reason));
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
  const install = useCallback(async (host: PluginHost) => {
    setBusy(host);
    setError("");
    setReceipt(null);
    try {
      const result = await desktop.invoke<PluginInstallReceipt>(
        "plugins:install",
        { host },
      );
      if (!mounted.current) return;
      setReceipt(result);
      setHosts(await desktop.invoke<PluginInstallation[]>("plugins:status"));
    } catch (reason) {
      if (mounted.current) setError(errorMessage(reason));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);
  return { hosts, scanned, busy, error, receipt, refresh, install };
}
