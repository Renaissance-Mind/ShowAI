import { useEffect, useState } from "react";
import { desktop, errorCode, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import { Laptop, Tablet, Link2, Loader2, RefreshCw } from "../ui/icons";
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
type Pair = {
  id: string;
  state: string;
  code: string;
  expiresAt: number;
  /** Set by the Mac when a request ends: "declined" or "cancelled". */
  reason?: string;
};
const pairingErrors: Record<string, Parameters<typeof t>[0]> = {
  PAIRING_EXPIRED: "error.expired",
  PAIRING_QUEUE_FULL: "error.queueFull",
  PAIRING_RATE_LIMITED: "error.rateLimited",
  UNAUTHORIZED: "error.pairAgain",
};
/** Pairing failures by code in the UI language; anything else keeps its text. */
export function pairingErrorText(reason: unknown) {
  const key = pairingErrors[errorCode(reason) ?? ""];
  return key ? t(key) : errorMessage(reason);
}
/** Why a finished request ended, for its title and hint. */
export function pairingEnd(pair: Pick<Pair, "state" | "reason">) {
  if (pair.state === "expired") return "expired" as const;
  if (pair.state === "rejected")
    return pair.reason === "cancelled"
      ? ("cancelled" as const)
      : ("declined" as const);
  return null;
}
/** m:ss until a request expires. */
export function countdown(expiresAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** Re-renders every second while a request waits, for its countdown. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
export function NearbyMacs({
  onClose,
  onPaired,
}: {
  onClose(): void;
  onPaired(id: string): Promise<void>;
}) {
  const [state, setState] = useState<Nearby>({ nearby: [], peers: [] });
  const [pair, setPair] = useState<Pair | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const now = useNow(pair?.state === "pending");
  const load = () =>
    desktop
      .invoke<Nearby>("agent:nearby")
      .then(setState)
      .catch((reason) => setError(pairingErrorText(reason)));
  const begin = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      const result = await desktop.invoke<Omit<Pair, "id">>("agent:pair", {
        id,
      });
      setPair({ ...result, id });
      if (result.state === "approved") await useMac(id);
    } catch (reason) {
      setError(pairingErrorText(reason));
    } finally {
      setBusy("");
    }
  };
  const useMac = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await onPaired(id);
    } catch (reason) {
      if (
        ["UNAUTHORIZED", "PAIRING_REQUIRED"].includes(errorCode(reason) ?? "")
      )
        await begin(id);
      else setError(pairingErrorText(reason));
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!pair || pair.state !== "pending") return;
    let stopped = false,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      if (Date.now() > pair.expiresAt) {
        setPair({ ...pair, state: "expired" });
        return;
      }
      pending = true;
      void desktop
        .invoke<Omit<Pair, "id">>("agent:pairStatus")
        .then(async (value) => {
          if (stopped) return;
          setPair({ ...value, id: pair.id });
          if (value.state === "approved") await useMac(pair.id);
        })
        .catch((reason) => {
          if (!stopped) setError(pairingErrorText(reason));
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
  const devices = [
    ...new Map<string, Device & { nearby: boolean }>([
      ...state.peers.map(
        (peer) => [peer.id, { ...peer, paired: true, nearby: false }] as const,
      ),
      ...state.nearby.map(
        (device) => [device.id, { ...device, nearby: true }] as const,
      ),
    ]).values(),
  ];
  const close = () => {
    void desktop
      .invoke("agent:cancelPair")
      .catch((reason) => console.error("Cancel pairing:", reason));
    onClose();
  };
  return (
    <Dialog
      title={t("connectANearbyMac")}
      onClose={close}
      className="lan-pairing-dialog"
    >
      {pair ? (
        <div className="lan-confirmation">
          <div className="lan-pair-illustration" aria-hidden="true">
            <Tablet size={38} />
            <Link2 size={20} />
            <Laptop size={48} />
          </div>
          <h3>
            {pair.state === "pending"
              ? t("confirmOnMac")
              : busy
                ? t("connecting")
                : pairingEnd(pair)
                  ? t(`ended.${pairingEnd(pair)!}`)
                  : t("requestEnded")}
          </h3>
          <p>
            {pair.state === "pending"
              ? t("matchCode")
              : pairingEnd(pair)
                ? t(`ended.${pairingEnd(pair)!}Hint`)
                : t("retryHint")}
          </p>
          <div className="lan-pair-code" role="status">
            <strong>{pair.code}</strong>
          </div>
          {pair.state === "pending" && (
            <p className="lan-footnote" aria-live="off">
              {t("expiresIn", { time: countdown(pair.expiresAt, now) })}
            </p>
          )}
          {(pair.state === "pending" || pairingEnd(pair) === "expired") && (
            <p className="lan-footnote">{t("keepAwake")}</p>
          )}
          {pair.state === "pending" || busy ? (
            <span className="lan-waiting">
              <Loader2 size={15} />
              {t("waitingForMac")}
            </span>
          ) : (
            <button
              type="button"
              className="settings-button primary"
              onClick={() => void begin(pair.id)}
            >
              {t("tryAgain")}
            </button>
          )}
          <button type="button" className="lan-text-button" onClick={close}>
            {t("cancel")}
          </button>
        </div>
      ) : (
        <>
          <p className="lan-intro">{t("sameNetwork")}</p>
          <div className="lan-device-list">
            {devices.map((device) => (
              <div className="lan-device" key={device.id}>
                <span className="lan-device-icon" aria-hidden="true">
                  <Laptop size={32} />
                </span>
                <div className="lan-device-identity">
                  <b>{device.name}</b>
                  <small>
                    <i
                      className={
                        device.nearby || device.online ? "available" : ""
                      }
                    />
                    {device.nearby || device.online
                      ? device.paired
                        ? t("nearbyPaired")
                        : t("nearbyMac")
                      : t("offline")}
                  </small>
                </div>
                <button
                  type="button"
                  className="settings-button primary"
                  disabled={!!busy || (!device.nearby && !device.online)}
                  onClick={() =>
                    void (device.paired ? useMac(device.id) : begin(device.id))
                  }
                >
                  {busy === device.id ? (
                    <>
                      <Loader2 size={14} className="lan-spin" />
                      {t("connecting")}
                    </>
                  ) : (
                    t("useMac")
                  )}
                </button>
              </div>
            ))}
            {!devices.length && (
              <div className="lan-empty" role="status">
                <span className="lan-device-icon">
                  <Laptop size={38} />
                </span>
                <b>{t("searching")}</b>
                <p>{t("openShowAI")}</p>
                <p>{t("keepAwake")}</p>
                <button className="lan-text-button" onClick={() => void load()}>
                  <RefreshCw size={14} />
                  {t("searchAgain")}
                </button>
              </div>
            )}
          </div>
          {!!devices.length && (
            <p className="lan-footnote">{t("firstConnection")}</p>
          )}
        </>
      )}
      {(error || state.error) && (
        <p role="alert" className="agent-error">
          {error || state.error}
        </p>
      )}
    </Dialog>
  );
}
/** One consent surface per Mac window. Remembered devices reconnect directly. */
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
          if (stopped) return;
          // Hosts without nearby pairing, such as the website workbench, answer UNAVAILABLE.
          if (errorCode(reason) === "UNAVAILABLE") {
            stopped = true;
            clearInterval(timer);
            return;
          }
          console.error("Pairing status:", reason);
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
  const now = useNow(!!request?.expiresAt);
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
      setError(pairingErrorText(reason));
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
      <div className="lan-confirmation">
        <div className="lan-pair-illustration" aria-hidden="true">
          <Tablet size={38} />
          <Link2 size={20} />
          <Laptop size={48} />
        </div>
        <h3>{request.name}</h3>
        <p>{t("receiveProjects")}</p>
        <div className="lan-pair-code">
          <strong>{request.code}</strong>
        </div>
        <p className="lan-footnote">{t("confirmSameCode")}</p>
        {!!request.expiresAt && (
          <p className="lan-footnote">
            {t("expiresIn", { time: countdown(request.expiresAt, now) })}
          </p>
        )}
      </div>
      <div className="lan-pair-actions">
        <button
          className="settings-button"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          {t("reject")}
        </button>
        <button
          className="settings-button primary"
          disabled={busy}
          onClick={() => void decide(true)}
        >
          {t("allowConnection")}
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
