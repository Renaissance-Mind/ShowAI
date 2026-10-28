import { useCallback, useEffect, useState } from "react";
import type { AppUpdateState } from "../desktop/bridge";
import { desktop } from "./bridge";

export type AppUpdateAction =
  | "appUpdate:check"
  | "appUpdate:download"
  | "appUpdate:install"
  | "appUpdate:setAutomatic";

/**
 * In-app update state of the desktop App, shared by every window through the
 * main process. Null outside the desktop App.
 */
export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    if (!window.showai?.onAppUpdate) return;
    let stopped = false;
    const stop = desktop.onAppUpdate((next) => setState(next));
    desktop.invoke<AppUpdateState>("appUpdate:state").then(
      (initial) => {
        // A pushed change may arrive before the first answer.
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
