import { useCallback, useEffect, useState } from "react";
import type { AppUpdateState } from "../host/protocol";
import { desktop, errorMessage } from "../host/bridge";
import { workbenchCapabilities } from "./capabilities";

export type AppUpdateAction =
  | "appUpdate:check"
  | "appUpdate:download"
  | "appUpdate:install"
  | "appUpdate:setAutomatic";

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!window.showai || workbenchCapabilities().remote) return;
    let stopped = false;
    const stop = window.showai.onAppUpdate
      ? desktop.onAppUpdate((next) => setState(next))
      : undefined;
    desktop.invoke<AppUpdateState>("appUpdate:state").then(
      (initial) => {
        if (!stopped) setState((current) => current ?? initial);
      },
      (reason: unknown) => {
        if (!stopped) setError(errorMessage(reason));
      },
    );
    return () => {
      stopped = true;
      stop?.();
    };
  }, []);
  const run = useCallback(
    (action: AppUpdateAction, args?: Record<string, unknown>) =>
      desktop.invoke<AppUpdateState>(action, args).then(setState),
    [],
  );
  return { state, run, error };
}
