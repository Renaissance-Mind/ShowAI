import { useCallback, useEffect, useRef, useState } from "react";
import type { AppUpdateState } from "../host/protocol";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/feedback";
import { errorMessage } from "../host/bridge";
import type { useAppUpdate } from "./useAppUpdate";
import "./plugin-update-notice.css";

type RunUpdate = ReturnType<typeof useAppUpdate>["run"];

function RestartNotice({
  version,
  deadline,
  run,
}: {
  version: string;
  deadline: number;
  run: RunUpdate;
}) {
  const t = useTranslator(messages);
  const notice = useRef<HTMLElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  );
  const [failure, setFailure] = useState<string>();
  const defer = useCallback(() => {
    if (
      notice.current?.contains(document.activeElement) &&
      priorFocus.current?.isConnected
    )
      priorFocus.current.focus({ preventScroll: true });
    setFailure(undefined);
    void run("appUpdate:defer", { version }).catch((reason) =>
      setFailure(errorMessage(reason)),
    );
  }, [run, version]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      const remaining = deadline - Date.now();
      const left = Math.max(0, Math.ceil(remaining / 1000));
      setSeconds(left);
      if (left > 0)
        timer = setTimeout(tick, Math.max(1, remaining - (left - 1) * 1000));
    }
    tick();
    return () => clearTimeout(timer);
  }, [deadline]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented)
        return;
      if (
        document.querySelector(
          'dialog[open], [aria-modal="true"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      event.preventDefault();
      defer();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [defer]);

  return (
    <section
      className="plugin-update-notice app-restart-notice"
      ref={notice}
      aria-labelledby="app-restart-title"
      aria-describedby="app-restart-description"
      onFocusCapture={(event) => {
        const target = event.relatedTarget;
        if (
          target instanceof HTMLElement &&
          !event.currentTarget.contains(target)
        )
          priorFocus.current = target;
      }}
    >
      <div className="plugin-update-notice-text" role="status">
        <strong id="app-restart-title">{t("update.confirmRestart")}</strong>
        <p id="app-restart-description">
          {t("update.confirmDetail", { version })}
        </p>
        {failure && (
          <p role="alert" className="plugin-install-error">
            {t("update.failed", { message: failure })}
          </p>
        )}
      </div>
      <div className="plugin-update-notice-actions">
        <button type="button" className="settings-button" onClick={defer}>
          {t("update.later")}
        </button>
        <button
          type="button"
          className="settings-button plugin-update-notice-primary"
          aria-label={t("update.restartNow", { seconds })}
          onClick={() => {
            setFailure(undefined);
            void run("appUpdate:install", { version }).catch((reason) =>
              setFailure(errorMessage(reason)),
            );
          }}
        >
          {t("update.restartNow", {
            seconds: String(seconds).padStart(2, "\u2007"),
          })}
        </button>
      </div>
    </section>
  );
}

export default function AppUpdateNotice({
  state,
  run,
}: {
  state: AppUpdateState | null;
  run: RunUpdate;
}) {
  if (
    state?.phase !== "ready" ||
    state.restartAt === undefined ||
    !state.version
  )
    return null;
  return (
    <RestartNotice
      key={state.restartAt}
      deadline={state.restartAt}
      version={state.version}
      run={run}
    />
  );
}
