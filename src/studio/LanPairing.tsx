import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import { getLocale } from "../i18n";
import { remoteExecution } from "./AgentExecution";
const zh = () => getLocale() === "zh-CN";
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
      title={zh() ? "连接附近的 Mac" : "Connect a nearby Mac"}
      onClose={() => {
        void desktop
          .invoke("agent:cancelPair")
          .catch((reason) => console.error("Cancel pairing:", reason));
        onClose();
      }}
      className="lan-pairing-dialog"
    >
      <p>
        {zh()
          ? "两台设备连接同一个局域网。在 Mac 的设置 → Agent 中开启远程执行并选择项目，然后在这里发起连接。"
          : "Join the same local network. Enable remote execution and select projects in the Mac’s Settings → Agent, then connect here."}
      </p>
      {pair && (
        <div className="lan-pair-code" role="status">
          <strong>{pair.code}</strong>
          <p>
            {pair.state === "pending"
              ? zh()
                ? "核对 Mac 显示的数字，并在 Mac 上确认。两分钟内有效。"
                : "Match this code on the Mac and approve within two minutes."
              : zh()
                ? "请求已结束，可重新发起配对。"
                : "Request ended. You can pair again."}
          </p>
        </div>
      )}
      {!state.nearby.length && (
        <p className="settings-help">
          {zh()
            ? "正在查找…请允许 ShowAI 使用本地网络。"
            : "Searching… Allow ShowAI to access your local network."}
        </p>
      )}
      {state.nearby.map((device) => (
        <div className="lan-device" key={device.id}>
          <div>
            <b>{device.name}</b>
            <small>
              {device.online
                ? zh()
                  ? "已连接 · 局域网"
                  : "Connected · LAN"
                : device.paired
                  ? zh()
                    ? "已记住，可重新配对"
                    : "Remembered · pair again"
                  : zh()
                    ? "附近的 Mac"
                    : "Nearby Mac"}
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
            {device.online
              ? zh()
                ? "使用此 Mac"
                : "Use Mac"
              : zh()
                ? "发起配对"
                : "Pair"}
          </button>
        </div>
      ))}
      {state.peers
        .filter((peer) => peer.enabled)
        .map((peer) => (
          <div className="lan-device" key={peer.id}>
            <small>
              {peer.name} ·{" "}
              {zh()
                ? "Mac 负责服务器保存，断联期间修改留在 iPad"
                : "Mac saves to server; iPad retains changes offline"}
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
              {zh() ? "断开并恢复服务器同步" : "Disconnect and use server sync"}
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
      title={zh() ? "允许 iPad 连接这台 Mac？" : "Allow this iPad to connect?"}
      onClose={() => void decide(false)}
      className="lan-pairing-dialog"
    >
      <p>
        <b>{request.name}</b>{" "}
        {zh()
          ? "请求使用你已开放的项目，在此 Mac 上运行 Agent 并保存页面。"
          : "requests access to your shared projects, Agent execution, and page saving on this Mac."}
      </p>
      <div className="lan-pair-code">
        <strong>{request.code}</strong>
        <p>
          {zh()
            ? "请确认 iPad 上显示相同数字。"
            : "Confirm the iPad displays the same code."}
        </p>
      </div>
      <div className="lan-pair-actions">
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          {zh() ? "拒绝" : "Reject"}
        </button>
        <button
          type="button"
          className="settings-button primary"
          disabled={busy}
          onClick={() => void decide(true)}
        >
          {zh() ? "数字一致，允许连接" : "Code matches, allow"}
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
