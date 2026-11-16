import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import labMessages from "../i18n/messages/uiLab";
import { messages } from "./messages";
import type { LabSession } from "./types";
import "./lab.css";
const t = messages(labMessages, "zh-CN");
type Feature = {
  id: string;
  title: string;
  events?: Array<{ name: string; title: string }>;
  scenes: Array<{
    id: string;
    title: string;
    description: string;
    fixture: string;
    steps: Array<{ id: string; title: string }>;
  }>;
};
type Run = {
  id: string;
  passed: boolean;
  renderer: string;
  results: Array<{
    title: string;
    passed: boolean;
    error?: string;
    checkpoints: Array<{
      title: string;
      file: string;
      visual: { state: string };
    }>;
  }>;
};
async function api(path: string, input?: unknown, method?: string) {
  const response = await fetch("/__ui-lab/api/" + path, {
    method: method ?? (input === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function Lab() {
  const [features, setFeatures] = useState<Feature[]>([]),
    [selected, setSelected] = useState({
      feature: "remote-connection",
      scene: "overview",
    });
  const [session, setSession] = useState<LabSession>(),
    [theme, setTheme] = useState<"light" | "dark">("light"),
    [viewport, setViewport] = useState("adaptive"),
    [status, setStatus] = useState(t("preparing"));
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false),
    [step, setStep] = useState(""),
    [cursor, setCursor] = useState(0),
    [runs, setRuns] = useState<Run[]>([]);
  const frame = useRef<HTMLIFrameElement>(null),
    current = useRef<LabSession | undefined>(undefined),
    readySession = useRef(""),
    pendingReplay = useRef<"all" | "step" | undefined>(undefined),
    stepped = useRef(false),
    ticket = useRef(0);
  const feature = features.find((item) => item.id === selected.feature),
    scene = feature?.scenes.find((item) => item.id === selected.scene);
  async function refresh() {
    const value = await api("results");
    setRuns(value.reports);
  }
  useEffect(() => {
    void api("catalog")
      .then((value) => setFeatures(value.features))
      .catch((error) => setError(String(error)));
    void refresh().catch((error) => setError(String(error)));
  }, []);
  async function reset(replay?: "all" | "step") {
    const token = ++ticket.current;
    pendingReplay.current = replay;
    stepped.current = replay === "step";
    setBusy(true);
    setError("");
    setStatus(t("preparing"));
    setStep("");
    setCursor(0);
    try {
      const next: LabSession = await api("sessions", {
        ...selected,
        theme,
        mode: replay ? "test" : "manual",
      });
      if (token !== ticket.current) {
        await fetch(`/__ui-lab/api/sessions/${next.id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${next.token}` },
        });
        return;
      }
      const previous = current.current;
      current.current = next;
      setSession(next);
      if (previous)
        await fetch(`/__ui-lab/api/sessions/${previous.id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${previous.token}` },
        });
    } catch (error) {
      setError(String(error));
      setBusy(false);
    }
  }
  useEffect(() => {
    if (features.length) void reset();
  }, [selected.feature, selected.scene, theme, features.length]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.session !== current.current?.id
      )
        return;
      if (event.data.type === "showai-ui-lab-ready") {
        readySession.current = event.data.session;
        setStatus(t("ready"));
        if (pendingReplay.current) {
          const type =
            pendingReplay.current === "step"
              ? "showai-ui-lab-advance"
              : "showai-ui-lab-replay";
          pendingReplay.current = undefined;
          frame.current?.contentWindow?.postMessage(
            { type, session: current.current?.id },
            location.origin,
          );
        } else setBusy(false);
      } else if (event.data.type === "showai-ui-lab-error") {
        setError(event.data.error);
        setBusy(false);
      } else if (event.data.type === "showai-ui-lab-step") {
        setStep(event.data.step);
        setCursor(event.data.cursor);
      } else if (event.data.type === "showai-ui-lab-paused") {
        setStatus(t("ready"));
        setBusy(false);
      } else if (event.data.type === "showai-ui-lab-replayed") {
        setStatus(t("passed"));
        setBusy(false);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      if (readySession.current !== session.id) {
        setError(t("timeout"));
        setBusy(false);
      }
    }, 20000);
    return () => clearTimeout(timer);
  }, [session?.id]);
  async function run() {
    setRunning(true);
    setError("");
    try {
      await api("runs", {
        ...selected,
        theme,
        width: viewport === "narrow" ? 800 : 1440,
        height: 1000,
        scale: 2,
      });
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setRunning(false);
    }
  }
  async function event(name: string) {
    if (!session) return;
    const response = await fetch(
      `/__ui-lab/api/sessions/${session.id}/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ name, input: {} }),
      },
    );
    const value = await response.json();
    if (!response.ok) setError(value.error);
    else setError("");
  }
  return (
    <div className="ui-lab">
      <header>
        <h1>{t("title")}</h1>
        <span>{scene?.fixture === "none" ? t("realApp") : t("simulated")}</span>
      </header>
      <aside>
        <nav>
          {features.map((feature) => (
            <section key={feature.id}>
              <h2>{feature.title}</h2>
              {feature.scenes.map((scene) => (
                <button
                  key={scene.id}
                  aria-current={
                    selected.feature === feature.id &&
                    selected.scene === scene.id
                      ? "page"
                      : undefined
                  }
                  onClick={() =>
                    setSelected({ feature: feature.id, scene: scene.id })
                  }
                >
                  {scene.title}
                </button>
              ))}
            </section>
          ))}
        </nav>
      </aside>
      <main>
        <div className="ui-lab-toolbar">
          <strong>{scene?.title}</strong>
          <label>
            {t("theme")}
            <select
              value={theme}
              onChange={(event) =>
                setTheme(event.target.value as "light" | "dark")
              }
            >
              <option value="light">{t("light")}</option>
              <option value="dark">{t("dark")}</option>
            </select>
          </label>
          <label>
            {t("viewport")}
            <select
              value={viewport}
              onChange={(event) => setViewport(event.target.value)}
            >
              <option value="adaptive">{t("adaptive")}</option>
              <option value="desktop">1440 × 1000</option>
              <option value="narrow">800 × 1000</option>
            </select>
          </label>
          <button disabled={busy} onClick={() => void reset()}>
            {t("reset")}
          </button>
          <button disabled={busy || !session} onClick={() => void reset("all")}>
            {t("replay")}
          </button>
          <button
            disabled={busy || !session || cursor === scene?.steps.length}
            onClick={() => {
              if (!stepped.current) void reset("step");
              else {
                setBusy(true);
                frame.current?.contentWindow?.postMessage(
                  { type: "showai-ui-lab-advance", session: session?.id },
                  location.origin,
                );
              }
            }}
          >
            {t("singleStep")}
          </button>
          <button
            className="primary"
            disabled={running}
            onClick={() => void run()}
          >
            {running ? t("preparing") : t("run")}
          </button>
          {session && (
            <a href={session.appUrl} target="_blank" rel="noreferrer">
              {t("open")}
            </a>
          )}
        </div>
        <div className="ui-lab-status" role="status">
          {status}
          {step &&
            ` · ${scene?.steps.find((item) => item.id === step)?.title ?? step}`}
        </div>
        {error && <pre role="alert">{error}</pre>}
        <div className="ui-lab-canvas">
          {session && (
            <iframe
              ref={frame}
              title={t("realApp")}
              src={session.appUrl}
              style={{
                width:
                  viewport === "adaptive"
                    ? "100%"
                    : viewport === "narrow"
                      ? 800
                      : 1440,
                height: 1000,
              }}
            />
          )}
        </div>
        {!!feature?.events?.length && (
          <details className="ui-lab-events">
            <summary>{t("event")}</summary>
            {feature.events.map((item) => (
              <button key={item.name} onClick={() => void event(item.name)}>
                {item.title}
              </button>
            ))}
          </details>
        )}
        <section className="ui-lab-results">
          <h2>{t("results")}</h2>
          {!runs.length && <p>{t("noResults")}</p>}
          {runs.map((run) => (
            <details key={run.id} className="ui-lab-result">
              <summary>
                {run.passed ? t("passed") : t("failed")} · {run.renderer} ·{" "}
                {run.id}
              </summary>
              <a
                href={`/__ui-lab/results/${run.id}/index.html`}
                target="_blank"
                rel="noreferrer"
              >
                {run.passed ? t("passed") : t("failed")} · {run.renderer} ·{" "}
                {run.id}
              </a>
              {run.results.map((result, index) => (
                <div key={index}>
                  <h3>{result.title}</h3>
                  {result.error && <pre>{result.error}</pre>}
                  <div className="ui-lab-shots">
                    {result.checkpoints.map((point) => (
                      <a
                        key={point.file}
                        href={`/__ui-lab/results/${run.id}/${point.file}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          loading="lazy"
                          src={`/__ui-lab/results/${run.id}/${point.file}`}
                          alt={point.title}
                        />
                        <span>
                          {point.title} ·{" "}
                          {point.visual.state === "unreviewed" ||
                          point.visual.state === "missing"
                            ? t("visualNew")
                            : point.visual.state === "passed"
                              ? t("visualPassed")
                              : t("visualChanged")}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </details>
          ))}
        </section>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Lab />);
