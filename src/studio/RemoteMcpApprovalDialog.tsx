import { useEffect, useState } from "react";
import { desktop, errorMessage } from "../host/bridge";
import Dialog from "../ui/Dialog";
import { visibleInterval } from "./visible-interval";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteMcp";
import connectionMessages from "../i18n/messages/remoteConnections";
import {
  ArrowRight,
  Check,
  Eye,
  FilePlus2,
  Laptop,
  Pencil,
  ShieldCheck,
  X,
} from "../ui/icons";
import { RemoteBrand, remoteProviderKeys } from "./RemoteConnectionControls";
import type { RemoteApprovalRequest } from "../remote-mcp/types";

export default function RemoteMcpApprovalDialog() {
  const t = useTranslator(messages);
  const c = useTranslator(connectionMessages);
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
        if (active)
          setRequests((current) =>
            JSON.stringify(current) === JSON.stringify(next) ? current : next,
          );
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      } finally {
        reading = false;
      }
    };
    void read();
    const stop = visibleInterval(() => void read(), 1500);
    return () => {
      active = false;
      stop();
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
      <div className="rm-approval">
        <div className="rm-approval-route">
          <div>
            <Laptop size={24} />
            <span>
              <strong>{request.clientName}</strong>
              <small>{request.callbackOrigin}</small>
            </span>
          </div>
          {request.provider && (
            <>
              <ArrowRight size={16} />
              <div>
                <RemoteBrand provider={request.provider} />
                <strong>{c(remoteProviderKeys[request.provider])}</strong>
              </div>
            </>
          )}
        </div>
        <div className="rm-field">
          <label>
            <ShieldCheck size={15} />
            {c("code")}
          </label>
          <code className="rm-approval-code">{request.code}</code>
        </div>
        <dl className="rm-approval-permissions">
          <div>
            <dt>{c("requestScope")}</dt>
            <dd>{c(request.access === "all" ? "all" : "selected")}</dd>
          </div>
          <div>
            <dt>{c("requestOperations")}</dt>
            <dd>
              <span>
                <Eye size={14} />
                {c("read")}
              </span>
              {request.scopes.includes("projects.write") && (
                <span>
                  <Pencil size={14} />
                  {c("edit")}
                </span>
              )}
              {request.scopes.includes("projects.create") && (
                <span>
                  <FilePlus2 size={14} />
                  {c("create")}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {error && <p role="alert">{error}</p>}
        <div className="rm-form-actions">
          <button
            className="rm-button"
            disabled={busy}
            onClick={() => void decide("deny")}
          >
            <X size={15} />
            {t("approvalDeny")}
          </button>
          <button
            className="rm-button primary"
            disabled={busy}
            onClick={() => void decide("allow")}
          >
            <Check size={15} />
            {t("approvalAllow")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
