import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import { translator } from "../i18n";
import messages from "../i18n/messages/lanPairing";
import { remoteExecution } from "./AgentExecution";
const t = translator(messages);
interface Device {
  id: string;
  name: string;
  paired?: boolean;
  online?: boolean;
  enabled?: boolean;
  code?: string;
  expiresAt?: number;
  error?: string;
}
interface Nearby {
  nearby: Device[];
  peers: Device[];
  error?: string;
}
export function NearbyMacs({
  onClose,
  onPaired,
  initialId,
}: {
  onClose(): void;
  onPaired(id: string): void;
  initialId?: string;
}) {
  const [state, setState] = useState<Nearby>({ nearby: [], peers: [] });
  const [pair, setPair] = useState<{
    id: string;
    state: string;
    code: string;
    expiresAt: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    desktop
      .invoke<Nearby>("agent:nearby")
      .then(setState)
      .catch((reason) => setError(errorMessage(reason)));
  const begin = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      setPair({
        ...(await desktop.invoke<Omit<NonNullable<typeof pair>, "id">>(
          "agent:pair",
          { id },
        )),
        id,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (initialId) void begin(initialId);
  }, [initialId]);
  useEffect(() => {
    if (!pair || pair.state !== "pending") return;
    let stopped = false,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void desktop
        .invoke<Omit<NonNullable<typeof pair>, "id">>("agent:pairStatus")
        .then((value) => {
          if (stopped) return;
          setPair({ ...value, id: pair.id });
          if (value.state === "approved") onPaired(pair.id);
        })
        .catch((reason) => {
          if (!stopped) setError(errorMessage(reason));
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pair?.id, pair?.state]);
  return (
    <Dialog
      title={t("connectANearbyMac")}
      onClose={() => {
        void desktop
          .invoke("agent:cancelPair")
          .catch((reason) => console.error("Cancel pairing:", reason));
        onClose();
      }}
      className="lan-pairing-dialog"
    >
      <p>
        {t(
          "joinTheSameLocalNetworkEnableRemoteExecutionAndSelectProjectsInTheMacSSettingsAgentThenConnectHere",
        )}
      </p>
      {pair && (
        <div className="lan-pair-code" role="status">
          <strong>{pair.code}</strong>
          <p>
            {pair.state === "pending"
              ? t("matchThisCodeOnTheMacAndApproveWithinTwoMinutes")
              : t("requestEndedYouCanPairAgain")}
          </p>
        </div>
      )}
      {!state.nearby.length && (
        <p className="settings-help">
          {t("searchingAllowShowAIToAccessYourLocalNetwork")}
        </p>
      )}
      {state.nearby.map((device) => (
        <div className="lan-device" key={device.id}>
          <div>
            <b>{device.name}</b>
            <small>
              {device.online
                ? t("connectedLAN")
                : device.paired
                  ? t("rememberedPairAgain")
                  : t("nearbyMac")}
            </small>
          </div>
          <button
            type="button"
            className="settings-button"
            disabled={busy || pair?.state === "pending"}
            onClick={() =>
              device.online ? onPaired(device.id) : void begin(device.id)
            }
          >
            {device.online ? t("useMac") : t("pair")}
          </button>
        </div>
      ))}
      {state.peers
        .filter((peer) => peer.enabled)
        .map((peer) => (
          <div className="lan-device" key={peer.id}>
            <small>
              {peer.name} · {t("macSavesToServerIPadRetainsChangesOffline")}
            </small>
            <button
              type="button"
              className="settings-button"
              onClick={() =>
                void desktop
                  .invoke("agent:unpair", { id: peer.id })
                  .then(load)
                  .catch((reason) => setError(errorMessage(reason)))
              }
            >
              {t("disconnectAndUseServerSync")}
            </button>
          </div>
        ))}
      {(error || state.error) && (
        <p role="alert" className="agent-error">
          {error || state.error}
        </p>
      )}
    </Dialog>
  );
}
/** One consent surface per Mac window; the backend grant is shared and expires. */
export function MacPairingPrompt() {
  const [requests, setRequests] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (remoteExecution()) return;
    let stopped = false,
      pending = false;
    const load = () => {
      if (pending) return;
      pending = true;
      void desktop
        .invoke<{ pendingClients: Device[] }>("agent:remoteDevice")
        .then((value) => {
          if (!stopped)
            setRequests(
              value.pendingClients.filter((p) => p.id.startsWith("lan:")),
            );
        })
        .catch((reason) => {
          if (!stopped) console.error("Pairing status:", reason);
        })
        .finally(() => {
          pending = false;
        });
    };
    load();
    const timer = setInterval(load, 1800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  const request = requests[0];
  if (!request) return null;
  const decide = async (approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      await desktop.invoke("agent:approveRemoteClient", {
        id: request.id,
        approve,
      });
      setRequests((items) => items.filter((item) => item.id !== request.id));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("allowThisIPadToConnect")}
      onClose={() => void decide(false)}
      className="lan-pairing-dialog"
    >
      <p>
        <b>{request.name}</b>{" "}
        {t(
          "requestsAccessToYourSharedProjectsAgentExecutionAndPageSavingOnThisMac",
        )}
      </p>
      <div className="lan-pair-code">
        <strong>{request.code}</strong>
        <p>{t("confirmTheIPadDisplaysTheSameCode")}</p>
      </div>
      <div className="lan-pair-actions">
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          {t("reject")}
        </button>
        <button
          type="button"
          className="settings-button primary"
          disabled={busy}
          onClick={() => void decide(true)}
        >
          {t("codeMatchesAllow")}
        </button>
      </div>
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
