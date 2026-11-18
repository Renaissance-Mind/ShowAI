import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import labMessages from "../i18n/messages/uiLab";
import flowMessages from "../i18n/messages/uiFlow";
import { messages, motionSummary } from "./messages";
import type { LabSession, MotionObservation } from "./types";
import "./lab.css";
const t = messages(labMessages, "zh-CN"),
  f = messages(flowMessages, "zh-CN");
type Node = {
  stateLabel?: string;
  variantLabels?: Record<string, string>;
  id: string;
  title: string;
  screen: string;
  screenTitle: string;
  parent?: string;
  variants?: string[];
  actions: { id: string; title: string; to?: string }[];
};
type Feature = {
  id: string;
  title: string;
  flow: { entry: string; nodes: Node[] };
};
type Snapshot = {
  node?: string;
  actions: { id: string; title: string; disabled: boolean }[];
};
type Run = {
  id: string;
  passed: boolean;
  renderer: string;
  results: {
    title: string;
    error?: string;
    checkpoints: {
      title: string;
      file: string;
      visual: { state: string };
      motion?: MotionObservation;
    }[];
  }[];
};
async function api(path: string, input?: unknown) {
  const response = await fetch("/__ui-lab/api/" + path, {
    method: input === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function ancestors(nodes: Node[], id?: string): string[] {
  const found: string[] = [];
  let node = nodes.find((node) => node.id === id);
  while (node?.parent && !found.includes(node.parent)) {
    found.push(node.parent);
    node = nodes.find((item) => item.id === node!.parent);
  }
  return found;
}
function FlowTree({
  nodes,
  current,
  jump,
}: {
  nodes: Node[];
  current?: string;
  jump(id: string): void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([...ancestors(nodes, current), nodes[0]?.id]),
  );
  useEffect(() => {
    setExpanded(
      (previous) => new Set([...previous, ...ancestors(nodes, current)]),
    );
  }, [current, nodes]);
  function branch(node: Node) {
    const children = nodes.filter((item) => item.parent === node.id),
      open = expanded.has(node.id);
    return (
      <li key={node.id} data-flow-node={node.id}>
        <div className="flow-tree-row">
          {children.length ? (
            <button
              className="flow-expander"
              aria-label={f("branch", { name: node.title })}
              aria-expanded={open}
              onClick={() =>
                setExpanded((previous) => {
                  const next = new Set(previous);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
            >
              {open ? "−" : "+"}
            </button>
          ) : (
            <span className="flow-expander" />
          )}
          <button
            aria-label={f("direct", { name: node.title })}
            aria-current={current === node.id ? "step" : undefined}
            onClick={() => jump(node.id)}
          >
            {node.title}
          </button>
        </div>
        {children.length > 0 && open && <ul>{children.map(branch)}</ul>}
      </li>
    );
  }
  return (
    <ul className="flow-tree" aria-label={f("tree")}>
      {nodes.filter((node) => !node.parent).map(branch)}
    </ul>
  );
}
function Lab() {
  const [features, setFeatures] = useState<Feature[]>([]),
    [featureId, setFeatureId] = useState("remote-connection"),
    [session, setSession] = useState<LabSession>();
  const [theme, setTheme] = useState<"light" | "dark">("light"),
    [viewport, setViewport] = useState("adaptive"),
    [busy, setBusy] = useState(true),
    [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ actions: [] }),
    [annotations, setAnnotations] = useState(true),
    [tree, setTree] = useState(false),
    [resultsOpen, setResultsOpen] = useState(false),
    [runs, setRuns] = useState<Run[]>([]),
    [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null),
    current = useRef<LabSession | undefined>(undefined),
    ticket = useRef(0),
    target = useRef("");
  const feature = features.find((item) => item.id === featureId),
    nodes = feature?.flow.nodes ?? [],
    node = nodes.find((item) => item.id === snapshot.node);
  const variants = node?.variants
    ? node.variants
        .map((id) => nodes.find((node) => node.id === id)!)
        .filter(Boolean)
    : nodes.filter((item) => item.screen === node?.screen);
  async function refresh() {
    const value = await api("results");
    setRuns(value.reports);
  }
  useEffect(() => {
    void api("catalog")
      .then((value: { features: Feature[] }) => {
        const requested = new URL(location.href).searchParams.get("feature");
        if (requested && value.features.some((item) => item.id === requested))
          setFeatureId(requested);
        setFeatures(value.features);
      })
      .catch((error) => setError(String(error)));
    void refresh().catch((error) => setError(String(error)));
  }, []);
  async function jump(id: string) {
    const sequence = ++ticket.current;
    target.current = id;
    setBusy(true);
    setError("");
    setSnapshot({ actions: [] });
    try {
      const next: LabSession = await api("sessions", {
        feature: featureId,
        flow: true,
        node: id,
        theme,
        mode: "manual",
      });
      if (sequence !== ticket.current) {
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
    if (feature) {
      setTree(false);
      void jump(feature.flow.entry);
    }
  }, [featureId, features.length]);
  useEffect(() => {
    if (feature && current.current && current.current.theme !== theme)
      void jump(target.current || feature.flow.entry);
  }, [theme]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.session !== current.current?.id
      )
        return;
      if (event.data.type === "showai-ui-lab-ready") {
        setBusy(false);
        frame.current?.contentWindow?.postMessage(
          {
            type: "showai-ui-lab-annotations",
            session: current.current?.id,
            enabled: annotations,
          },
          location.origin,
        );
      }
      if (event.data.type === "showai-ui-lab-state") {
        setSnapshot({ node: event.data.node, actions: event.data.actions });
        if (event.data.node) target.current = event.data.node;
      }
      if (event.data.type === "showai-ui-lab-error") {
        setError(event.data.error);
        setBusy(false);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [annotations]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      if (!frame.current?.contentDocument?.documentElement.dataset.uiLabReady) {
        setError(t("timeout"));
        setBusy(false);
      }
    }, 20000);
    return () => clearTimeout(timer);
  }, [session?.id]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      {
        type: "showai-ui-lab-annotations",
        session: session?.id,
        enabled: annotations,
      },
      location.origin,
    );
  }, [annotations]);
  function act(id: string) {
    frame.current?.contentWindow?.postMessage(
      { type: "showai-ui-lab-action", session: session?.id, action: id },
      location.origin,
    );
  }
  async function run() {
    if (!node) return;
    setRunning(true);
    setError("");
    try {
      await api("runs", {
        feature: featureId,
        node: node.id,
        annotations,
        theme,
        width: Math.round(frame.current?.clientWidth ?? 1440),
        height: Math.max(560, Math.round(frame.current?.clientHeight ?? 1000)),
      });
      await refresh();
      setResultsOpen(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setRunning(false);
    }
  }
  return (
    <div className="ui-lab">
      <header className="ui-lab-toolbar">
        <label className="flow-feature">
          <span>{f("feature")}</span>
          <select
            aria-label={f("feature")}
            value={featureId}
            onChange={(event) => {
              const id = event.target.value;
              const url = new URL(location.href);
              url.searchParams.set("feature", id);
              history.replaceState(null, "", url);
              setFeatureId(id);
            }}
          >
            {features.map((feature) => (
              <option key={feature.id} value={feature.id}>
                {feature.title}
              </option>
            ))}
          </select>
        </label>
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
        <label className="flow-annotation-toggle">
          <input
            type="checkbox"
            checked={annotations}
            onChange={(event) => setAnnotations(event.target.checked)}
          />
          {f("annotations")}
        </label>
        <button aria-pressed={tree} onClick={() => setTree((value) => !value)}>
          {f("tree")}
        </button>
        <button
          className="primary"
          disabled={busy || running || !node}
          onClick={() => void run()}
        >
          {running ? t("preparing") : f("inspect")}
        </button>
        <button onClick={() => setResultsOpen(true)}>{f("details")}</button>
      </header>
      {error && (
        <div className="ui-lab-error" role="alert">
          {error}
        </div>
      )}
      <div className="ui-lab-workspace">
        <main className="ui-lab-preview" aria-label={f("preview")}>
          {session && (
            <iframe
              key={session.id}
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
                height: viewport === "adaptive" ? "100%" : 1000,
                visibility: busy ? "hidden" : "visible",
              }}
            />
          )}
          {busy && (
            <div className="flow-loading" role="status">
              {f("switching")}
            </div>
          )}
        </main>
        <section className="ui-lab-inspector" aria-label={f("showPanel")}>
          <div className="flow-scope">
            <span className="flow-dot" />
            {f("range")}
            <span className="flow-mock">
              {f(featureId === "remote-connection" ? "mock" : "storage")}
            </span>
          </div>
          <section className="flow-state-panel" aria-label={f("state")}>
            <h2>
              {node?.screenTitle ?? (busy ? f("preparing") : f("outside"))}
            </h2>
            {node && (
              <div className="flow-current" role="status">
                {node.stateLabel ?? node.title}
              </div>
            )}
            {variants.length > 1 && (
              <div className="flow-state-options">
                {variants.map((variant) => (
                  <button
                    key={variant.id}
                    aria-pressed={variant.id === node?.id}
                    disabled={busy}
                    onClick={() => void jump(variant.id)}
                  >
                    {node?.variantLabels?.[variant.id] ?? variant.title}
                  </button>
                ))}
              </div>
            )}
            {!node && !busy && (
              <button onClick={() => feature && void jump(feature.flow.entry)}>
                {f("entry")}
              </button>
            )}
          </section>
          <section className="flow-actions-panel">
            <h2>{f("actions")}</h2>
            {snapshot.actions.map((item, index) => (
              <button
                key={item.id}
                disabled={item.disabled || busy}
                aria-label={f("marker", { index: index + 1, name: item.title })}
                onClick={() => act(item.id)}
              >
                <span className="flow-number">{index + 1}</span>
                <span>{item.title}</span>
                {node?.actions.find((action) => action.id === item.id)?.to && (
                  <span className="flow-arrow">→</span>
                )}
              </button>
            ))}
            {!snapshot.actions.length && !busy && <p>{f("noActions")}</p>}
          </section>
          {tree && (
            <section className="flow-tree-panel">
              <h2>{f("tree")}</h2>
              <FlowTree
                nodes={nodes}
                current={snapshot.node}
                jump={(id) => void jump(id)}
              />
            </section>
          )}
          <button
            className="flow-entry"
            disabled={busy}
            onClick={() => feature && void jump(feature.flow.entry)}
          >
            {f("entry")}
          </button>
        </section>
      </div>
      {resultsOpen && (
        <div
          className="flow-result-shade"
          role="dialog"
          aria-modal="true"
          aria-label={f("details")}
        >
          <section className="flow-results">
            <header>
              <h2>{f("details")}</h2>
              <button
                aria-label={t("closeDialog")}
                onClick={() => setResultsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="flow-results-body">
              {!runs.length && <p>{t("noResults")}</p>}
              {runs.map((run) => (
                <details key={run.id}>
                  <summary>
                    {run.passed ? t("passed") : t("failed")} · {run.id}
                  </summary>
                  <a
                    href={`/__ui-lab/results/${run.id}/index.html`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("report")}
                  </a>
                  {run.results.map((result, index) => (
                    <section key={index}>
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
                            {point.motion && (
                              <span>
                                {motionSummary(point.motion, "zh-CN")}
                              </span>
                            )}
                          </a>
                        ))}
                      </div>
                    </section>
                  ))}
                </details>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<Lab />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
