import { installIconTooltips } from "../../ui/icon-tooltip.mjs";
import { useAppearanceTheme } from "../../design/useAppearanceTheme";
import {
  appearanceTokens,
  installSandboxTheme,
} from "../../design/sandbox-theme";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Settings2 } from "../../ui/icons";
import type { BlockProps } from "../blocks/types";
import {
  viewportLockKey,
  readViewportLock,
  writeViewportLock,
} from "../blocks/ViewportLock";
import { injectComponentBootstrap, readCustomBlockData } from "./contract";
import type { CompiledComponent } from "./types";
import { InlineComponent } from "./InlineComponent";
import { findComponent, indexComponents } from "./component-index";
import { installComponentLinks, openComponentLink } from "./external-links";
import "./custom.css";

const ComponentsContext = createContext<ReadonlyMap<string, CompiledComponent>>(
  new Map(),
);
const InlineHostContext = createContext<HTMLElement | null>(null);

export function CustomComponentsProvider({
  components,
  children,
  inlineHost = null,
}: {
  components: CompiledComponent[];
  children: ReactNode;
  inlineHost?: HTMLElement | null;
}) {
  const value = useMemo(() => indexComponents(components), [components]);
  return (
    <ComponentsContext.Provider value={value}>
      <InlineHostContext.Provider value={inlineHost}>
        {children}
      </InlineHostContext.Provider>
    </ComponentsContext.Provider>
  );
}

export function useAvailableComponents() {
  return [...useContext(ComponentsContext).values()];
}

export function AdditionalComponentsProvider({
  components,
  children,
}: {
  components: CompiledComponent[];
  children: ReactNode;
}) {
  const current = useContext(ComponentsContext),
    inlineHost = useContext(InlineHostContext);
  const merged = useMemo(
    () => [...current.values(), ...components],
    [current, components],
  );
  return (
    <CustomComponentsProvider components={merged} inlineHost={inlineHost}>
      {children}
    </CustomComponentsProvider>
  );
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const visit = (entry: unknown, depth = 0): boolean => {
    if (depth > 40) return false;
    if (
      entry === null ||
      typeof entry === "boolean" ||
      typeof entry === "string"
    )
      return true;
    if (typeof entry === "number") return Number.isFinite(entry);
    if (Array.isArray(entry))
      return entry.every((item) => visit(item, depth + 1));
    return (
      !!entry &&
      typeof entry === "object" &&
      Object.entries(entry).every(
        ([key, item]) =>
          !["__proto__", "constructor", "prototype"].includes(key) &&
          visit(item, depth + 1),
      )
    );
  };
  return visit(value) && JSON.stringify(value).length <= 1_000_000;
}

export function CustomBlock({ data, onChange, readOnly }: BlockProps) {
  const parsed = readCustomBlockData(data);
  const components = useContext(ComponentsContext);
  const inlineHost = useContext(InlineHostContext);
  const component = findComponent(components, parsed);
  return component && inlineHost ? (
    <InlineComponent
      key={component.integrity}
      component={component}
      data={parsed.props}
      host={inlineHost}
    />
  ) : component ? (
    <SandboxComponent
      key={component.integrity}
      component={component}
      data={data}
      onChange={onChange}
      readOnly={readOnly}
    />
  ) : (
    <section className="sb-block sb-unavailable" aria-label="组件尚未安装">
      <div style={{ padding: 18 }}>
        <strong>{parsed.componentId}</strong>
        <p>
          需要安装组件 {parsed.componentId}@{parsed.version}
          {parsed.integrity ? `（${parsed.integrity.slice(7, 19)}）` : ""}
          。页面数据已保留。
        </p>
      </div>
    </section>
  );
}

function SandboxComponent({
  component,
  data,
  onChange,
  readOnly,
}: BlockProps & { component: CompiledComponent }) {
  const parsed = readCustomBlockData(data);
  const iframe = useRef<HTMLIFrameElement>(null);
  const theme = useAppearanceTheme();
  const initialTheme = useRef(theme);
  const [channel] = useState(() => crypto.randomUUID());
  const [height, setHeight] = useState(180);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [validating, setValidating] = useState(false);
  const draftBase = useRef("");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const pendingValidation = useRef<{
    id: string;
    props: Record<string, unknown>;
    timeout: number;
  } | null>(null);
  const latest = useRef({ data, parsed, onChange, readOnly });
  const initial = useRef({
    props: parsed.props,
    readOnly: !!readOnly || !onChange,
  });
  latest.current = { data, parsed, onChange, readOnly };
  const editable = !!onChange && !readOnly;
  const cancelValidation = () => {
    if (pendingValidation.current)
      window.clearTimeout(pendingValidation.current.timeout);
    pendingValidation.current = null;
    setValidating(false);
  };
  const closeEditor = () => {
    cancelValidation();
    setEditing(false);
    requestAnimationFrame(() => settingsButton.current?.focus());
  };
  const openEditor = () => {
    draftBase.current = JSON.stringify(latest.current.parsed.props);
    setDraft(JSON.stringify(latest.current.parsed.props, null, 2));
    setDraftError("");
    setEditing(true);
  };
  const saveDraft = () => {
    let next: unknown;
    try {
      next = JSON.parse(draft);
    } catch (error) {
      setDraftError(
        error instanceof Error ? error.message : "JSON 格式不正确。",
      );
      return;
    }
    if (!jsonObject(next)) {
      setDraftError("组件数据必须是 JSON 对象，且不超过 1 MB。");
      return;
    }
    if (JSON.stringify(latest.current.parsed.props) !== draftBase.current) {
      setDraftError("组件数据已更新，请重新打开编辑后再修改。");
      return;
    }
    cancelValidation();
    setDraftError("");
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      pendingValidation.current = null;
      setValidating(false);
      setDraftError("组件未响应数据校验，请重新加载组件后再试。");
    }, 5000);
    pendingValidation.current = { id, props: next, timeout };
    setValidating(true);
    iframe.current?.contentWindow?.postMessage(
      { channel, type: "showai:validate", requestId: id, props: next },
      "*",
    );
  };
  const html = useMemo(() => {
    // A portable package is executable user content. Enforce the policy before
    // parsing any of its markup, even if its own document omits or changes CSP.
    const policy =
      "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'\">";
    return (
      policy +
      injectComponentBootstrap(
        component.html,
        `<style>body{color:var(--text)}</style><script>(${installSandboxTheme.toString()})(${safeJson(channel)},${safeJson(initialTheme.current)},${safeJson(appearanceTokens())});</script><script id="showai-component-data" type="application/json">${safeJson({ channel, ...initial.current })}</script>`,
      ) +
      `<script>(${installIconTooltips.toString()})(document);(${installComponentLinks.toString()})(${safeJson(channel)});</script>`
    );
  }, [component.html, channel]);

  const sendProps = () => {
    const current = latest.current;
    iframe.current?.contentWindow?.postMessage(
      {
        channel,
        type: "showai:props",
        props: current.parsed.props,
        readOnly: !!current.readOnly || !current.onChange,
      },
      "*",
    );
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        !event.data ||
        event.data.channel !== channel
      )
        return;
      if (event.data.type === "showai:ready") sendProps();
      if (event.data.type === "showai:open-url") {
        openComponentLink(event.data.url);
        return;
      }
      if (
        event.data.type === "showai:height" &&
        typeof event.data.height === "number" &&
        Number.isFinite(event.data.height)
      )
        setHeight(Math.min(4000, Math.max(48, Math.ceil(event.data.height))));
      if (event.data.type === "showai:error")
        setError(String(event.data.message || "组件无法显示。").slice(0, 500));
      if (event.data.type === "showai:valid") setError("");
      if (
        ["showai:viewport-lock-get", "showai:viewport-lock-set"].includes(
          event.data.type,
        ) &&
        typeof event.data.scope === "string" &&
        /^[a-z0-9-]+:\d{1,4}$/.test(event.data.scope)
      ) {
        const scope = event.data.scope;
        const key = viewportLockKey(iframe.current!, scope);
        let locked = true,
          error = "";
        try {
          if (
            event.data.type === "showai:viewport-lock-set" &&
            typeof event.data.locked === "boolean"
          )
            writeViewportLock(key, event.data.locked);
          locked = readViewportLock(key);
        } catch (caught) {
          error = `无法保存阅读锁状态：${String(caught)}`;
        }
        iframe.current?.contentWindow?.postMessage(
          { channel, type: "showai:viewport-lock-state", scope, locked, error },
          "*",
        );
      }
      if (
        event.data.type === "showai:reading-wheel" &&
        [event.data.deltaX, event.data.deltaY, event.data.deltaMode].every(
          Number.isFinite,
        )
      ) {
        const frame = iframe.current!;
        const wheel = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: event.data.deltaX,
          deltaY: event.data.deltaY,
          deltaMode: event.data.deltaMode,
          ctrlKey: event.data.ctrlKey === true,
          metaKey: event.data.metaKey === true,
          shiftKey: event.data.shiftKey === true,
        });
        if (frame.dispatchEvent(wheel) && !wheel.ctrlKey && !wheel.metaKey) {
          let remaining =
            wheel.deltaY *
            (wheel.deltaMode === 1
              ? 16
              : wheel.deltaMode === 2
                ? frame.clientHeight
                : 1);
          for (
            let element = frame.parentElement;
            element && remaining;
            element = element.parentElement
          ) {
            if (!/auto|scroll/.test(getComputedStyle(element).overflowY))
              continue;
            const before = element.scrollTop;
            element.scrollTop += remaining;
            remaining -= element.scrollTop - before;
          }
        }
      }
      const current = latest.current;
      const pending = pendingValidation.current;
      if (
        event.data.type === "showai:validation" &&
        pending &&
        pending.id === event.data.requestId
      ) {
        cancelValidation();
        if (event.data.valid !== true) {
          setDraftError(
            String(event.data.message || "数据不符合组件的属性要求。").slice(
              0,
              1000,
            ),
          );
        } else if (JSON.stringify(current.parsed.props) !== draftBase.current) {
          setDraftError("组件数据已更新，请重新打开编辑后再修改。");
        } else if (!current.readOnly && current.onChange) {
          current.onChange({ ...current.data, props: pending.props });
          closeEditor();
        }
      }
      if (
        event.data.type === "showai:change" &&
        !current.readOnly &&
        current.onChange &&
        jsonObject(event.data.props)
      )
        current.onChange({ ...current.data, props: event.data.props });
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      if (pendingValidation.current)
        window.clearTimeout(pendingValidation.current.timeout);
    };
  }, [channel]);
  // Callback identity is host plumbing; only data and edit permission cross the sandbox.
  useEffect(sendProps, [parsed.props, readOnly, editable, channel]);
  useEffect(() => {
    const sendTheme = () =>
      iframe.current?.contentWindow?.postMessage(
        { channel, type: "showai:theme", theme, tokens: appearanceTokens() },
        "*",
      );
    const frame = iframe.current;
    frame?.addEventListener("load", sendTheme);
    sendTheme();
    return () => frame?.removeEventListener("load", sendTheme);
  }, [theme, channel]);

  return (
    <section
      className="showai-custom-block"
      aria-label={component.name}
      style={{ margin: "18px 0" }}
    >
      {editable && !editing && (
        <button
          ref={settingsButton}
          type="button"
          className="custom-props-trigger"
          aria-label="编辑组件数据"
          title="编辑组件数据"
          onClick={openEditor}
        >
          <Settings2 size={15} />
        </button>
      )}
      {editable && editing && (
        <div
          className="custom-props-editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeEditor();
            }
          }}
        >
          <label htmlFor={`${channel}-props`}>组件数据</label>
          <textarea
            id={`${channel}-props`}
            aria-label="组件属性 JSON"
            value={draft}
            spellCheck={false}
            rows={Math.max(5, Math.min(14, draft.split("\n").length))}
            autoFocus
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError("");
            }}
            disabled={validating}
          />
          {draftError && (
            <p role="alert" className="custom-props-error">
              {draftError}
            </p>
          )}
          <div className="custom-props-actions">
            <button type="button" onClick={closeEditor}>
              取消
            </button>
            <button type="button" disabled={validating} onClick={saveDraft}>
              {validating ? "校验中…" : "应用"}
            </button>
          </div>
        </div>
      )}
      <iframe
        ref={iframe}
        title={component.name}
        srcDoc={html}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        onLoad={sendProps}
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        style={{
          width: "100%",
          height,
          border: 0,
          display: "block",
          background: "transparent",
        }}
      />
      {error && (
        <p role="alert" style={{ color: "#ae3c3c", fontSize: 12 }}>
          {error}
        </p>
      )}
    </section>
  );
}
