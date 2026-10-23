import { useEffect, useMemo, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import type { SyncConfiguration, ProjectConnection } from "../sync/protocol";

type Connection = Omit<SyncConfiguration["connections"][number], "token">;
export interface SyncOverviewState {
  projects: ProjectConnection[];
  connections: Connection[];
}
/** What a project row or page header says about sync, if anything. */
export type SyncMarker = "unsynced" | "signIn" | "readOnly";

/** Consecutive failed status reads before the workbench shows a marker. */
export const SYNC_STATUS_FAILURE_THRESHOLD = 3;

export function syncMarker(
  binding: ProjectConnection | undefined,
  connection?: Connection,
): SyncMarker | undefined {
  if (!binding) return undefined;
  if (binding.role === "viewer" || binding.status === "revoked")
    return "readOnly";
  if (binding.errorKind === "auth" || connection?.signedOut) return "signIn";
  if (
    binding.status === "offline" ||
    binding.status === "conflict" ||
    binding.status === "save-failed" ||
    (binding.status === "pending" && !!binding.error)
  )
    return "unsynced";
  return undefined;
}

/** Connections whose sign-in expired while projects still sync through them. */
export function expiredConnections(state: SyncOverviewState) {
  const expired = new Map<string, string[]>();
  for (const project of state.projects)
    if (project.errorKind === "auth")
      expired.set(project.connectionId, [
        ...(expired.get(project.connectionId) ?? []),
        project.projectId,
      ]);
  return [...expired].map(([connectionId, projectIds]) => ({
    connection: state.connections.find((item) => item.id === connectionId),
    connectionId,
    projectIds,
  }));
}

/**
 * Reads the sync state for the workbench every few seconds. Failed reads are
 * counted so a persistent problem shows a marker instead of only the console.
 */
export function useSyncOverview(home?: string) {
  const [state, setState] = useState<SyncOverviewState | null>(null);
  const [failures, setFailures] = useState(0);
  const [lastError, setLastError] = useState("");
  useEffect(() => {
    let active = true;
    setState(null);
    const read = () =>
      desktop.invoke<SyncOverviewState>("sync:status").then(
        (next) => {
          if (!active) return;
          setState(next);
          setFailures(0);
          setLastError("");
        },
        (error: unknown) => {
          if (!active) return;
          setFailures((count) => count + 1);
          setLastError(errorMessage(error));
        },
      );
    void read();
    const timer = setInterval(() => void read(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [home]);
  return useMemo(() => {
    const bindings = new Map(
      (state?.projects ?? []).map((item) => [item.projectId, item]),
    );
    const markers = new Map<string, SyncMarker>();
    for (const binding of bindings.values()) {
      const marker = syncMarker(
        binding,
        state?.connections.find((item) => item.id === binding.connectionId),
      );
      if (marker) markers.set(binding.projectId, marker);
    }
    return {
      loaded: !!state,
      bindings,
      markers,
      expired: state ? expiredConnections(state) : [],
      failures,
      unavailable: failures >= SYNC_STATUS_FAILURE_THRESHOLD,
      lastError,
    };
  }, [state, failures, lastError]);
}
