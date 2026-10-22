import { useEffect, useState } from "react";
import { connectionState, type ConnectionState } from "./browser/bridge";
import { useTranslator } from "./i18n/react";
import messages from "./i18n/messages/appShell";

/** Browser mode only: the loopback service went away or restarted. */
export function ConnectionBanner() {
  const t = useTranslator(messages);
  const [state, setState] = useState<ConnectionState>(connectionState);
  useEffect(() => {
    const update = (event: Event) =>
      setState((event as CustomEvent<ConnectionState>).detail);
    window.addEventListener("showai:connection", update);
    return () => window.removeEventListener("showai:connection", update);
  }, []);
  if (state === "connected") return null;
  return (
    <div
      className="studio-problem"
      role="alert"
      style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000 }}
    >
      <span>
        {state === "restarted"
          ? t("connection.restarted")
          : t("connection.lost")}
      </span>
      {state === "restarted" && (
        <button className="settings-button" onClick={() => location.reload()}>
          {t("connection.refresh")}
        </button>
      )}
    </div>
  );
}
