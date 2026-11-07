import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteMcp";
import type { RemoteApprovalRequest } from "../remote-mcp/types";

/** Global to the workbench so a request is visible without opening Settings. */
export default function RemoteMcpApprovalDialog() {
  const t = useTranslator(messages);
  const [requests, setRequests] = useState<RemoteApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next =
          await desktop.invoke<RemoteApprovalRequest[]>("remoteMcp:requests");
        if (active) setRequests(next);
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const request = requests[0];
  if (!request) return null;
  async function decide(decision: "allow" | "deny") {
    setBusy(true);
    setError("");
    try {
      setRequests(
        await desktop.invoke<RemoteApprovalRequest[]>("remoteMcp:decide", {
          id: request.id,
          decision,
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t("approvalTitle")}
      className="remote-approval-dialog"
      onClose={() => void decide("deny")}
      dismissible={!busy}
      initialFocus="container"
    >
      <div className="remote-flow remote-chatgpt-guide">
        <strong>{request.clientName}</strong>
        <p>{request.callbackOrigin}</p>
        <p>{t("approvalMatch")}</p>
        <code className="remote-approval-code">{request.code}</code>
        <p>{t(request.access === "all" ? "allAccess" : "selectedAccess")}</p>
        <p>
          {t(
            request.scopes.includes("projects.create")
              ? "createAllowed"
              : request.scopes.includes("projects.write")
                ? "write"
                : "read",
          )}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="remote-primary-row">
          <button
            className="settings-button"
            disabled={busy}
            onClick={() => void decide("deny")}
          >
            {t("approvalDeny")}
          </button>
          <button
            className="settings-button primary"
            disabled={busy}
            onClick={() => void decide("allow")}
          >
            {t("approvalAllow")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
