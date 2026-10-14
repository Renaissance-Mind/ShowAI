import { useEffect, useState } from "react";
import { desktop, errorMessage } from "./bridge";
type Flow = {
  id: string;
  pollSecret: string;
  url?: string;
  serverUrl: string;
  provider: string;
  expiresAt: number;
};
export default function ServiceLogin({
  url,
  registrationKey,
  connectionId,
  onConnected,
}: {
  url: string;
  registrationKey: string;
  connectionId?: string;
  onConnected: (id: string) => Promise<void>;
}) {
  const [methods, setMethods] = useState<string[]>([]),
    [flow, setFlow] = useState<Flow | null>(null);
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [confirming, setConfirming] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setMethods([]);
    setFlow(null);
    setError("");
    if (!url) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void desktop
        .invoke<{ auth: string[] }>("sync:serverInfo", { url })
        .then((info) => {
          if (!cancelled) setMethods(info.auth);
        })
        .catch(() => {
          if (!cancelled) setMethods([]);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);
  async function finish(
    current: Flow,
    entered?: { code?: string; completionCode?: string },
  ) {
    const result = await desktop.invoke<{
      status: string;
      connection?: { id: string };
    }>("sync:finishLogin", {
      url: current.serverUrl,
      id: current.id,
      pollSecret: current.pollSecret,
      ...entered,
    });
    if (result.status === "completed" && result.connection) {
      setFlow(null);
      setConfirming(false);
      await onConnected(result.connection.id);
      return true;
    }
    if (result.status === "confirm") setConfirming(true);
    return false;
  }
  useEffect(() => {
    if (!flow || flow.provider === "email") return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= flow.expiresAt) {
        setError("登录等待已过期，请重新发起。");
        setFlow(null);
        return;
      }
      try {
        if (await finish(flow)) return;
      } catch (error) {
        if (!cancelled) {
          setError(errorMessage(error));
          setFlow(null);
        }
        return;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow]);
  async function start(provider: string) {
    setBusy(true);
    setError("");
    setCode("");
    setConfirming(false);
    try {
      setFlow(
        await desktop.invoke<Flow>("sync:beginLogin", {
          url,
          provider,
          email,
          registrationKey,
          connectionId,
        }),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!methods.some((method) => ["github", "google", "email"].includes(method)))
    return null;
  return (
    <div className="sync-form">
      {connectionId && (
        <p className="settings-help">
          为当前账号添加登录方式。在浏览器完成授权并确认绑定后，可用该方式登录同一个账号。
        </p>
      )}
      {error && (
        <p role="alert" className="sync-error">
          {error}
        </p>
      )}
      {!["email"].includes(flow?.provider ?? "") && (
        <div className="sync-actions">
          {methods.includes("github") && (
            <button
              type="button"
              className="settings-button"
              disabled={busy || !!flow}
              onClick={() => void start("github")}
            >
              {connectionId ? "添加 GitHub 登录方式" : "使用 GitHub 登录"}
            </button>
          )}
          {methods.includes("google") && (
            <button
              type="button"
              className="settings-button"
              disabled={busy || !!flow}
              onClick={() => void start("google")}
            >
              {connectionId ? "添加 Google 登录方式" : "使用 Google 登录"}
            </button>
          )}
        </div>
      )}
      {flow?.url && !confirming && (
        <p className="settings-help">
          <a href={flow.url} target="_blank" rel="noopener noreferrer">
            打开 {flow.provider === "github" ? "GitHub" : "Google"} 授权页面
          </a>
          ，完成后返回这里。正在等待登录…
        </p>
      )}
      {flow?.url && confirming && (
        <>
          <p className="settings-help">
            授权已完成。点击浏览器页面中的「在 ShowAI 中完成」，或输入页面显示的完成码。
          </p>
          <label>
            完成码
            <input
              autoComplete="one-time-code"
              maxLength={9}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={busy || code.replace(/[\s-]/g, "").length !== 8}
            onClick={() => {
              setBusy(true);
              setError("");
              void finish(flow, { completionCode: code })
                .catch((error) => {
                  setError(errorMessage(error));
                  setFlow(null);
                  setConfirming(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            完成登录
          </button>
        </>
      )}
      {methods.includes("email") && !flow && (
        <>
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={busy || !email}
            onClick={() => void start("email")}
          >
            发送登录验证码
          </button>
        </>
      )}
      {flow?.provider === "email" && (
        <>
          <label>
            邮箱验证码
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="settings-button"
            disabled={busy || !/^\d{8}$/.test(code)}
            onClick={() => {
              setBusy(true);
              setError("");
              void finish(flow, { code })
                .catch((error) => setError(errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            确认邮箱登录
          </button>
        </>
      )}
      {flow && (
        <button
          type="button"
          className="settings-button"
          onClick={() => {
            setFlow(null);
            setCode("");
            setConfirming(false);
          }}
        >
          取消本次登录
        </button>
      )}
    </div>
  );
}
