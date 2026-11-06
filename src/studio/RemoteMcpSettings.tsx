import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
} from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteMcp";
import type {
  RemoteMcpConfig,
  RemoteMcpProvider,
  RemoteMcpStatus,
} from "../remote-mcp/types";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import ChatgptConnectionGuide from "./ChatgptConnectionGuide";
import { pairingDisplay } from "../remote-mcp/client-setup";
import cloudflareLogo from "./assets/connection-brands/cloudflare.svg";
import tailscaleLight from "./assets/connection-brands/tailscale-light.svg";
import tailscaleDark from "./assets/connection-brands/tailscale-dark.svg";
import "./remote-mcp-settings.css";

type Screen =
  | "provider"
  | "cloudflare"
  | "cloudflare-quick"
  | "domain"
  | "tailscale"
  | "client"
  | "connected";
export default function RemoteMcpSettings() {
  const t = useTranslator(messages);
  const [state, setState] = useState<RemoteMcpStatus>();
  const [config, setConfig] = useState<RemoteMcpConfig>();
  const [screen, setScreen] = useState<Screen>("provider");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [pair, setPair] = useState("");
  const [pairReceipt, setPairReceipt] = useState<{
    id: string;
    expiresAt: string;
  }>();
  const [copied, setCopied] = useState("");
  const [routeStep, setRouteStep] = useState(0);
  const [clientStep, setClientStep] = useState(0);
  const [otherClient, setOtherClient] = useState(false);
  const [modal, setModal] = useState<
    "rules" | "tools" | "diagnostics" | "authorization" | null
  >(null);
  const [rules, setRules] = useState<RemoteMcpConfig>();
  const initialized = useRef(false);
  const attempt = useRef(0);
  const awaitingClient = useRef(false);
  const clientBaseline = useRef(new Set<string>());
  const active = state?.phase === "starting" || state?.phase === "running";
  const pending = busy || state?.phase === "starting";
  const methodScreen = (p: RemoteMcpProvider): Screen =>
    p === "cloudflare" ? "domain" : p;
  useEffect(() => {
    let mounted = true;
    const read = async (refresh = false) => {
      try {
        const value = await desktop.invoke<RemoteMcpStatus>(
          "remoteMcp:status",
          { refresh },
        );
        if (!mounted) return;
        setState(value);
        if (!initialized.current) {
          initialized.current = true;
          setConfig({ ...value.config, access: value.config.access ?? "all" });
          if (value.phase === "prepared") setScreen("domain");
          else if (["starting", "running", "error"].includes(value.phase))
            setScreen(methodScreen(value.config.provider));
        }
        if (value.phase === "prepared" && value.error) setRouteStep(0);
        if (value.phase === "error" || value.phase === "stopped")
          setScreen((current) =>
            current === "client" || current === "connected"
              ? methodScreen(value.config.provider)
              : current,
          );
        if (value.phase === "prepared")
          setConfig((previous) =>
            previous ? { ...previous, port: value.config.port } : previous,
          );
        if (value.phase === "running" && value.reachable)
          setScreen((current) =>
            current === "connected"
              ? current
              : value.lastCallAt &&
                  (!awaitingClient.current ||
                    (!!value.lastCallClientId &&
                      !clientBaseline.current.has(value.lastCallClientId)))
                ? "connected"
                : "client",
          );
      } catch (reason) {
        if (mounted) setError(errorMessage(reason));
      }
    };
    void read(true);
    const timer = setInterval(() => void read(), 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string, id: string) {
    await desktop.invoke("clipboard:write", { text });
    setCopied(id);
  }
  async function generatePair() {
    const value = await desktop.invoke<{
      code: string;
      id: string;
      expiresAt: string;
    }>("remoteMcp:pair");
    setState(await desktop.invoke<RemoteMcpStatus>("remoteMcp:status"));
    setPair(value.code);
    setPairReceipt({ id: value.id, expiresAt: value.expiresAt });
    setCopied("");
  }
  async function stop() {
    attempt.current++;
    setState(await desktop.invoke<RemoteMcpStatus>("remoteMcp:stop"));
    setPair("");
    setPairReceipt(undefined);
    setClientStep(0);
  }
  async function choose(provider: RemoteMcpProvider) {
    await run(async () => {
      if (state?.localUrl) await stop();
      const next = {
        ...config!,
        provider,
        executable: "",
        access: config!.access ?? "all",
        port:
          provider === "cloudflare" && config!.provider === "cloudflare"
            ? config!.port
            : 0,
      };
      setConfig(next);
      setToken("");
      setRouteStep(0);
      setScreen(methodScreen(provider));
      if (provider === "cloudflare") {
        const prepared = await desktop.invoke<RemoteMcpStatus>(
          "remoteMcp:prepare",
          { config: next },
        );
        setState(prepared);
        setConfig(prepared.config);
        if (
          next.publicUrl &&
          state?.tokenSaved &&
          next.port > 0 &&
          prepared.config.port === next.port
        )
          setRouteStep(2);
      }
    });
  }
  async function connect(next = config!) {
    const ticket = ++attempt.current;
    await run(async () => {
      if (
        next.provider !== "tailscale" &&
        !(next.executable || state?.executables.cloudflare)
      ) {
        next = {
          ...next,
          executable: await desktop.invoke<string>(
            "remoteMcp:installCloudflare",
          ),
        };
        setConfig(next);
      }
      if (ticket !== attempt.current) return;
      const value = await desktop.invoke<RemoteMcpStatus>("remoteMcp:start", {
        config: next,
        token,
      });
      setState(value);
      setToken("");
      setPair("");
      setPairReceipt(undefined);
      setClientStep(0);
    });
  }
  const logo = (provider: RemoteMcpProvider) =>
    provider === "tailscale" ? (
      <span className="remote-brand">
        <img className="remote-logo-light" src={tailscaleLight} alt="" />
        <img className="remote-logo-dark" src={tailscaleDark} alt="" />
      </span>
    ) : (
      <img className="remote-brand" src={cloudflareLogo} alt="" />
    );
  const link = (href: string, label: string, onClick?: () => void) => (
    <a
      className="settings-button remote-action"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
    >
      {label}
      <ExternalLink size={14} />
    </a>
  );
  if (!config || !state)
    return <p role={error ? "alert" : "status"}>{error || t("working")}</p>;
  const pairState = pairingDisplay(
    pair ? pairReceipt : undefined,
    state.pairing,
  );
  const secondsLeft = pairReceipt
    ? Math.max(
        0,
        Math.ceil((Date.parse(pairReceipt.expiresAt) - Date.now()) / 1000),
      )
    : 0;
  const stage =
    screen === "provider" || screen === "cloudflare"
      ? 0
      : screen === "client" || screen === "connected"
        ? 2
        : 1;
  const provider = config.provider;
  const toolReady = !!(
    config.executable ||
    (provider === "tailscale"
      ? state.executables.tailscale
      : state.executables.cloudflare)
  );
  const visibleError = error || (stage === 1 ? state.error : "");
  return (
    <div className="remote-flow" aria-busy={pending}>
      <ol className="remote-progress" aria-label={t("client")}>
        {(["choose", "establish", "client"] as const).map((key, i) => (
          <li
            key={key}
            aria-current={i === stage ? "step" : undefined}
            data-done={i < stage}
          >
            <span>{i < stage ? <Check size={14} /> : i + 1}</span>
            {t(key)}
          </li>
        ))}
      </ol>
      {error && stage !== 1 && (
        <div role="alert" className="remote-error">
          <strong>{t("errorTitle")}</strong>
          <button
            className="settings-button"
            onClick={() => setModal("diagnostics")}
          >
            {t("details")}
          </button>
        </div>
      )}
      {stage > 0 && !active && (
        <button
          className="remote-back"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await stop();
              setScreen("provider");
            })
          }
        >
          <ArrowLeft size={15} />
          {t("back")}
        </button>
      )}
      {screen === "provider" && (
        <section className="remote-stage">
          <h3>{t("providerTitle")}</h3>
          <div className="remote-provider-cards">
            <button
              aria-label="Cloudflare"
              onClick={() => {
                setError("");
                setScreen("cloudflare");
              }}
            >
              {logo("cloudflare")}
              <strong>Cloudflare</strong>
              <ArrowRight size={18} />
            </button>
            <button
              aria-label="Tailscale"
              onClick={() => void choose("tailscale")}
            >
              {logo("tailscale")}
              <strong>Tailscale</strong>
              <ArrowRight size={18} />
            </button>
          </div>
        </section>
      )}
      {screen === "cloudflare" && (
        <section className="remote-stage">
          <button className="remote-back" onClick={() => setScreen("provider")}>
            <ArrowLeft size={15} />
            {t("back")}
          </button>
          <h3>{t("cloudflareChoice")}</h3>
          <div className="remote-methods">
            <button onClick={() => void choose("cloudflare-quick")}>
              <span>
                <strong>{t("quick")}</strong>
                <small>{t("quickHint")}</small>
              </span>
              <ArrowRight size={18} />
            </button>
            <button onClick={() => void choose("cloudflare")}>
              <span>
                <strong>{t("domain")}</strong>
                <small>{t("domainHint")}</small>
              </span>
              <ArrowRight size={18} />
            </button>
          </div>
        </section>
      )}
      {stage === 1 && (
        <section className="remote-stage remote-setup">
          <header>
            {logo(provider)}
            <h3>
              {t(
                provider === "cloudflare"
                  ? "domainTitle"
                  : provider === "tailscale"
                    ? "tailscaleTitle"
                    : "quickTitle",
              )}
            </h3>
          </header>
          {visibleError && (
            <div role="alert" className="remote-error">
              <strong>{t("errorTitle")}</strong>
              <button
                className="settings-button"
                onClick={() => setModal("diagnostics")}
              >
                {t("details")}
              </button>
            </div>
          )}
          {pending ? (
            <div className="remote-wait" role="status">
              <RefreshCw size={24} />
              {t(busy ? "working" : "starting")}
              <button
                className="settings-button"
                onClick={() =>
                  void run(async () => {
                    await stop();
                  })
                }
              >
                {t("cancel")}
              </button>
            </div>
          ) : state.phase === "running" ? (
            <div className="remote-primary-row">
              <button
                className="settings-button primary"
                onClick={() =>
                  void run(async () => {
                    setState(
                      await desktop.invoke<RemoteMcpStatus>("remoteMcp:check"),
                    );
                  })
                }
              >
                {t("retry")}
              </button>
              <button
                className="remote-secondary"
                onClick={() =>
                  void run(async () => {
                    await stop();
                    if (provider === "cloudflare") {
                      const prepared = await desktop.invoke<RemoteMcpStatus>(
                        "remoteMcp:prepare",
                        { config },
                      );
                      setState(prepared);
                      setConfig(prepared.config);
                      setRouteStep(0);
                    }
                  })
                }
              >
                {t("repair")}
              </button>
            </div>
          ) : (
            <>
              {provider === "cloudflare-quick" && (
                <div className="remote-primary-row">
                  <button
                    className="settings-button primary"
                    onClick={() => void connect()}
                  >
                    {t(
                      toolReady
                        ? state.error
                          ? "retry"
                          : "connect"
                        : "download",
                    )}
                    <ArrowRight size={16} />
                  </button>
                  <button
                    className="remote-secondary"
                    onClick={() => setModal("tools")}
                  >
                    {t("chooseTool")}
                  </button>
                </div>
              )}
              {provider === "tailscale" && (
                <div className="remote-steps">
                  <div>
                    <span>1</span>
                    {link(
                      "https://tailscale.com/download",
                      t("installTailscale"),
                    )}
                  </div>
                  <div>
                    <span>2</span>
                    <section>
                      {link(
                        "https://login.tailscale.com/admin/dns",
                        t("tailscaleSettings"),
                      )}
                      <p>{t("tailscaleSetup")}</p>
                    </section>
                  </div>
                  <div>
                    <span>3</span>
                    <button
                      className="settings-button primary"
                      onClick={() => void connect()}
                    >
                      {t("tailscaleCheck")}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <button
                    className="remote-secondary"
                    onClick={() => setModal("tools")}
                  >
                    {t("chooseTool")}
                  </button>
                </div>
              )}
              {provider === "cloudflare" && (
                <div className="remote-steps">
                  <div>
                    <span>{routeStep > 0 ? <Check size={14} /> : 1}</span>
                    <section>
                      <label>{t("route")}</label>
                      <code>{state.localUrl || t("working")}</code>
                      <button
                        className="settings-button"
                        disabled={!state.localUrl}
                        onClick={() =>
                          void run(async () => {
                            await copy(state.localUrl!, "route");
                            setRouteStep(1);
                          })
                        }
                      >
                        {t(copied === "route" ? "copied" : "copyRoute")}
                        <Copy size={14} />
                      </button>
                    </section>
                  </div>
                  {routeStep >= 1 && (
                    <div>
                      <span>{routeStep > 1 ? <Check size={14} /> : 2}</span>
                      <section>
                        {link(
                          "https://dash.cloudflare.com/",
                          t("openCloudflare"),
                        )}
                        <p>{t("routeSetup")}</p>
                        {routeStep === 1 && (
                          <button
                            className="settings-button"
                            onClick={() => setRouteStep(2)}
                          >
                            {t("routeDone")}
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </section>
                    </div>
                  )}
                  {routeStep >= 2 && (
                    <div>
                      <span>3</span>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void connect();
                        }}
                      >
                        <label>
                          {t("publicUrl")}
                          <input
                            type="url"
                            required
                            placeholder="https://showai.example.com"
                            value={config.publicUrl}
                            onChange={(e) => {
                              setError("");
                              setConfig({
                                ...config,
                                publicUrl: e.target.value,
                              });
                            }}
                          />
                        </label>
                        <label>
                          {t("token")}
                          <input
                            type="password"
                            required={!state.tokenSaved}
                            autoComplete="off"
                            value={token}
                            placeholder={t(
                              state.tokenSaved
                                ? "tokenSaved"
                                : "tokenPlaceholder",
                            )}
                            onChange={(e) => setToken(e.target.value)}
                          />
                        </label>
                        <button
                          className="settings-button primary"
                          type="submit"
                        >
                          {t(toolReady ? "connect" : "download")}
                          <ArrowRight size={16} />
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
      {screen === "client" && (
        <section className="remote-stage">
          <header>
            <Check size={20} />
            <h3>{t("connected")}</h3>
          </header>
          <div className="remote-steps">
            <div>
              <span>{clientStep > 0 ? <Check size={14} /> : 1}</span>
              <section>
                <label>{t("endpoint")}</label>
                <code>{state.url}</code>
                <button
                  className="settings-button"
                  onClick={() =>
                    void run(async () => {
                      await copy(state.url!, "endpoint");
                      setClientStep(Math.max(1, clientStep));
                    })
                  }
                >
                  {t(copied === "endpoint" ? "copied" : "copyEndpoint")}
                  <Copy size={14} />
                </button>
              </section>
            </div>
            {clientStep >= 1 && (
              <div>
                <span>{clientStep > 1 ? <Check size={14} /> : 2}</span>
                <section>
                  {otherClient ? (
                    <>
                      <p>{t("addOther")}</p>
                      <button
                        className="settings-button"
                        onClick={() => setClientStep(2)}
                      >
                        {t("addedOther")}
                      </button>
                    </>
                  ) : (
                    <>
                      {link("https://chatgpt.com/plugins", t("openChatgpt"))}
                      {clientStep === 1 && (
                        <ChatgptConnectionGuide
                          endpoint={state.url!}
                          busy={pending}
                          onCopy={(text) => copy(text, "field")}
                          onCheck={async () => {
                            const value =
                              await desktop.invoke<RemoteMcpStatus>(
                                "remoteMcp:check",
                              );
                            setState(value);
                            if (!value.reachable)
                              throw new Error(value.error || t("errorTitle"));
                            return true;
                          }}
                          onReady={() => setClientStep(2)}
                        />
                      )}
                    </>
                  )}
                  <button
                    className="remote-secondary"
                    onClick={() => setOtherClient(!otherClient)}
                  >
                    {t(otherClient ? "chatgptClient" : "otherClient")}
                  </button>
                </section>
              </div>
            )}
            {clientStep >= 2 && (
              <div>
                <span>3</span>
                <section>
                  <h4>{t("authorize")}</h4>
                  <p>{t("pairInstructions")}</p>
                  {pairState === "ready" && (
                    <>
                      <code>{pair}</code>
                      <p role="status">
                        {t("pairExpires", {
                          minutes: Math.floor(secondsLeft / 60),
                          seconds: secondsLeft % 60,
                        })}
                      </p>
                      <button
                        className="settings-button primary"
                        disabled={pending}
                        onClick={() =>
                          void run(async () => {
                            const latest =
                              await desktop.invoke<RemoteMcpStatus>(
                                "remoteMcp:status",
                              );
                            setState(latest);
                            if (
                              pairingDisplay(pairReceipt, latest.pairing) ===
                              "ready"
                            )
                              await copy(pair, "pair");
                          })
                        }
                      >
                        {t(copied === "pair" ? "copied" : "copyPair")}
                      </button>
                    </>
                  )}
                  {pairState !== "none" && pairState !== "ready" && (
                    <p role="status">
                      {t(
                        pairState === "used"
                          ? "pairUsed"
                          : pairState === "replaced"
                            ? "pairReplaced"
                            : "pairExpired",
                      )}
                    </p>
                  )}
                  <button
                    className={`settings-button ${pairState === "none" || pairState === "expired" || pairState === "replaced" ? "primary" : ""}`}
                    disabled={pending}
                    onClick={() => void run(generatePair)}
                  >
                    {t(pair ? "regenerate" : "generate")}
                  </button>
                  {pair && (
                    <>
                      <p>{t("verifyInstructions")}</p>
                      <button
                        className="settings-button"
                        onClick={() =>
                          void run(() => copy(t("verifyPrompt"), "prompt"))
                        }
                      >
                        {t(copied === "prompt" ? "copied" : "copyPrompt")}
                      </button>
                      <p role="status">{t("waiting")}</p>
                    </>
                  )}
                  <button
                    className="settings-button"
                    onClick={() => setModal("authorization")}
                  >
                    {t("authWindowExpired")}
                  </button>
                </section>
              </div>
            )}
          </div>
          <button
            className="remote-secondary"
            onClick={() =>
              void run(async () => {
                await stop();
                setScreen("provider");
              })
            }
          >
            {t("disconnect")}
          </button>
        </section>
      )}
      {screen === "connected" && (
        <section className="remote-stage">
          <header>
            <Check size={22} />
            <h3>{t("verified")}</h3>
          </header>
          <code>{state.url}</code>
          <div className="remote-primary-row">
            <button
              className="settings-button"
              onClick={() => void run(() => copy(state.url!, "endpoint"))}
            >
              {t(copied === "endpoint" ? "copied" : "copyEndpoint")}
            </button>
            <button
              className="settings-button"
              onClick={() => {
                clientBaseline.current = new Set(
                  state.clients.map((client) => client.id),
                );
                awaitingClient.current = true;
                setClientStep(0);
                setPair("");
                setPairReceipt(undefined);
                setScreen("client");
              }}
            >
              {t("addClient")}
            </button>
            <button
              className="remote-secondary"
              onClick={() =>
                void run(async () => {
                  await stop();
                  setScreen("provider");
                })
              }
            >
              {t("disconnect")}
            </button>
          </div>
          {state.clients.map((c) => (
            <div className="remote-client" key={c.id}>
              <span>{c.name}</span>
              <button
                className="remote-secondary"
                onClick={() =>
                  void run(async () => {
                    setState(
                      await desktop.invoke<RemoteMcpStatus>(
                        "remoteMcp:revoke",
                        { id: c.id },
                      ),
                    );
                  })
                }
              >
                {t("revoke")}
              </button>
            </div>
          ))}
        </section>
      )}
      <footer className="remote-rules">
        <span>
          {t(config.access === "selected" ? "selectedAccess" : "allAccess")}
        </span>
        <button
          className="remote-secondary"
          disabled={pending}
          onClick={() => {
            setRules({ ...config, projects: [...config.projects] });
            setModal("rules");
          }}
        >
          {t("accessRules")}
        </button>
      </footer>
      {modal === "rules" && rules && (
        <Dialog title={t("accessRules")} onClose={() => setModal(null)}>
          <div className="remote-form">
            <label>
              {t("accessRange")}
              <select
                value={rules.access ?? "all"}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    access: e.target.value as "all" | "selected",
                  })
                }
              >
                <option value="all">{t("allProjects")}</option>
                <option value="selected">{t("selectedProjects")}</option>
              </select>
            </label>
            {rules.access !== "selected" ? (
              <p>{t("createAllowed")}</p>
            ) : (
              state.projects.map((p) => {
                const rule = rules.projects.find((r) => r.id === p.id);
                return (
                  <label key={p.id} className="remote-rule-row">
                    {p.name}
                    <select
                      aria-label={t("permission", { name: p.name })}
                      value={rule ? (rule.write ? "write" : "read") : "none"}
                      onChange={(e) =>
                        setRules({
                          ...rules,
                          projects: [
                            ...rules.projects.filter((r) => r.id !== p.id),
                            ...(e.target.value === "none"
                              ? []
                              : [
                                  {
                                    id: p.id,
                                    write: e.target.value === "write",
                                  },
                                ]),
                          ],
                        })
                      }
                    >
                      <option value="none">{t("none")}</option>
                      <option value="read">{t("read")}</option>
                      <option value="write">{t("full")}</option>
                    </select>
                  </label>
                );
              })
            )}
            <button
              className="settings-button primary"
              disabled={rules.access === "selected" && !rules.projects.length}
              onClick={() => {
                setConfig(rules);
                setModal(null);
                if (active)
                  void run(async () => {
                    await stop();
                    setScreen(methodScreen(rules.provider));
                    setState(
                      await desktop.invoke<RemoteMcpStatus>("remoteMcp:start", {
                        config: rules,
                      }),
                    );
                  });
              }}
            >
              {t(active ? "saveReconnect" : "save")}
            </button>
          </div>
        </Dialog>
      )}
      {modal === "tools" && (
        <Dialog title={t("tools")} onClose={() => setModal(null)}>
          <div className="remote-form">
            <label>
              {t("toolPath")}
              <input
                placeholder={t("autoDetect")}
                value={config.executable}
                onChange={(e) =>
                  setConfig({ ...config, executable: e.target.value })
                }
              />
            </label>
            <button
              className="settings-button"
              onClick={() =>
                void run(async () => {
                  const path = await desktop.invoke<string | null>(
                    "remoteMcp:chooseExecutable",
                  );
                  if (path) setConfig({ ...config, executable: path });
                })
              }
            >
              {t("browse")}
            </button>
            <button
              className="settings-button primary"
              onClick={() => setModal(null)}
            >
              {t("continue")}
            </button>
          </div>
        </Dialog>
      )}
      {modal === "authorization" && (
        <Dialog title={t("authWindowExpired")} onClose={() => setModal(null)}>
          <p>{t("authWindowRecovery")}</p>
          {link("https://chatgpt.com/plugins", t("backToChatgpt"))}
        </Dialog>
      )}
      {modal === "diagnostics" && (
        <Dialog title={t("details")} onClose={() => setModal(null)}>
          <pre className="remote-diagnostics">
            {error || state.error}
            {state.diagnostics ? `\n\n${state.diagnostics}` : ""}
          </pre>
        </Dialog>
      )}
    </div>
  );
}
