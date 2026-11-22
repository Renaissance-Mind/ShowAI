import { useEffect, useState } from "react";
import { desktop, errorCode, errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import flowMessages from "../i18n/messages/accountFlow";
import syncMessages from "../i18n/messages/sync";
import { Database, FolderOpen, RefreshCw } from "../ui/icons";
import type { ProjectAccount } from "./managed-projects";

export default function ServerAccountRow({
  connection,
  syncedCount,
  manageId,
  refresh,
  onSignIn,
  onProjects,
  onManage,
}: {
  connection: ProjectAccount;
  syncedCount: number;
  manageId: string;
  refresh: () => Promise<void>;
  onSignIn: () => void;
  onProjects: () => void;
  onManage: () => void;
}) {
  const t = useTranslator(syncMessages);
  const f = useTranslator(flowMessages);
  const [checkError, setCheckError] = useState("");
  const { id, signedOut, sessionExpired } = connection;
  useEffect(() => {
    let active = true;
    setCheckError("");
    if (!signedOut) {
      void desktop
        .invoke<boolean>("sync:checkAccountSession", { connectionId: id })
        .then((valid) => {
          const expired = !valid;
          if (active && expired !== Boolean(sessionExpired)) return refresh();
        })
        .catch((reason) => {
          if (!active) return;
          if (errorCode(reason) === "NOT_FOUND") {
            void refresh().catch((failure) => {
              if (active) setCheckError(errorMessage(failure));
            });
          } else setCheckError(errorMessage(reason));
        });
    }
    return () => {
      active = false;
    };
  }, [id, signedOut, sessionExpired, refresh]);
  const needsSignIn = signedOut || sessionExpired;
  return (
    <article className="settings-row sync-account-row">
      <div className="sync-account-lead">
        <Database size={18} aria-hidden="true" />
        <div className="settings-row-text">
          <div className="settings-title-inline">
            <h3>{connection.user.name}</h3>
            <span
              className="settings-badge"
              data-tone={needsSignIn ? "warn" : syncedCount ? "ok" : undefined}
            >
              {signedOut
                ? f("signedOut")
                : sessionExpired
                  ? f("sessionRejected")
                  : syncedCount
                    ? t("accountSummaryProjects", { count: syncedCount })
                    : t("noProjectsSyncing")}
            </span>
          </div>
          <p>
            {connection.name} · {connection.url}
          </p>
          {checkError && (
            <p role="status">
              {f("sessionCheckFailed", { reason: checkError })}
            </p>
          )}
        </div>
      </div>
      <div className="settings-row-actions">
        {needsSignIn && (
          <button
            type="button"
            className="settings-button settings-primary-button"
            onClick={onSignIn}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {f("signIn")}
          </button>
        )}
        {!signedOut && (
          <>
            <button
              type="button"
              className="settings-button"
              onClick={onProjects}
            >
              <FolderOpen size={15} aria-hidden="true" />
              {f("viewProjects")}
            </button>
            <button
              id={manageId}
              type="button"
              className="settings-button"
              onClick={onManage}
            >
              {f("manageAccount")}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
