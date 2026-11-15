import { useCallback, useEffect, useState } from "react";
import type { AppUpdateState } from "../host/protocol";
import { desktop } from "../host/bridge";

export type AppUpdateAction =
  | "appUpdate:check"
  | "appUpdate:download"
  | "appUpdate:install"
  | "appUpdate:setAutomatic";

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    if (!window.showai?.onAppUpdate) return;
    let stopped = false;
    const stop = desktop.onAppUpdate((next) => setState(next));
    desktop.invoke<AppUpdateState>("appUpdate:state").then(
      (initial) => {
        if (!stopped) setState((current) => current ?? initial);
      },
      (reason: unknown) => console.error("ShowAI update state", reason),
    );
    return () => {
      stopped = true;
      stop();
    };
  }, []);
  const run = useCallback(
    (action: AppUpdateAction, args?: Record<string, unknown>) =>
      desktop.invoke<AppUpdateState>(action, args).then(setState),
    [],
  );
  return { state, run };
}
