import { useEffect, useMemo, useState } from "react";
import { desktop, errorMessage } from "../host/bridge";
import { visibleInterval } from "./visible-interval";
import type { SyncConfiguration, ProjectConnection } from "../sync/protocol";

type Connection = Omit<SyncConfiguration["connections"][number], "token">;
export interface SyncOverviewState {
  projects: ProjectConnection[];
  connections: Connection[];
}
export type SyncMarker = "unsynced" | "signIn" | "readOnly";

export const SYNC_STATUS_FAILURE_THRESHOLD = 3;

export function syncMarker(
  binding: ProjectConnection | undefined,
  connection?: Connection,
): SyncMarker | undefined {
  if (!binding || binding.paused) return undefined;
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

export function expiredConnections(state: SyncOverviewState) {
  const expired = new Map<string, string[]>();
  for (const project of state.projects)
    if (!project.paused && project.errorKind === "auth")
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

export function useSyncOverview(home?: string) {
  const [state, setState] = useState<SyncOverviewState | null>(null);
  const [failures, setFailures] = useState(0);
  const [lastError, setLastError] = useState("");
  useEffect(() => {
    let active = true;
    let previous = "";
    setState(null);
    const read = () =>
      desktop.invoke<SyncOverviewState>("sync:status").then(
        (next) => {
          if (!active) return;
          const value = {
            projects: next.projects,
            connections: next.connections,
          };
          const serialized = JSON.stringify(value);
          if (serialized !== previous) {
            previous = serialized;
            setState(value);
          }
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
    const stop = visibleInterval(() => void read(), 3000);
    return () => {
      active = false;
      stop();
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
