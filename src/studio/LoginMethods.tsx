import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
type LoginMethod = {
  provider: string;
  subject: string;
  email: string | null;
  created_at: string;
};
const providers: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  email: "邮箱",
};
/** Bound external login methods, so an unfamiliar one can be removed. */
export default function LoginMethods({
  connectionId,
  revision,
}: {
  connectionId: string;
  revision: number;
}) {
  const [methods, setMethods] = useState<LoginMethod[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setMethods(
      await desktop.invoke<LoginMethod[]>("sync:loginMethods", {
        connectionId,
      }),
    );
  }
  useEffect(() => {
    setError("");
    // Servers without login method management simply hide this list.
    void load().catch(() => setMethods(null));
  }, [connectionId, revision]);
  if (!methods?.length) return null;
  return (
    <div>
      <h3>已绑定的登录方式</h3>
      <p className="settings-help">
        不认识的登录方式应立即移除，并退出所有设备。移除需要最近 15 分钟内直接登录本服务器。
      </p>
      {error && (
        <p role="alert" className="sync-error">
          {error}
        </p>
      )}
      {methods.map((method) => (
        <div
          className="sync-connection"
          key={`${method.provider}:${method.subject}`}
        >
          <div className="settings-row-text">
            <h3>
              {providers[method.provider] ?? method.provider}
              {method.email ? ` · ${method.email}` : ` · #${method.subject}`}
            </h3>
            <p>添加于 {new Date(method.created_at).toLocaleString()}</p>
          </div>
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void desktop
                .invoke("sync:removeLoginMethod", {
                  connectionId,
                  provider: method.provider,
                  subject: method.subject,
                })
                .then(load)
                .catch((error) => setError(errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            移除
          </button>
        </div>
      ))}
    </div>
  );
}
