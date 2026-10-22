import { componentSelectionScript } from "./selection-bridge";
import { useSelectionFrame } from "./useSelectionFrame";
import { CAPACITY, assertContent } from "../../portable/capacity.mjs";
import { installIconTooltips } from "../../ui/icon-tooltip.mjs";
import { componentSandboxPolicy } from "./sandbox-policy.mjs";
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
import { Settings2, Sparkles } from "../../ui/icons";
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
import { openComponentMedia } from "./LocalMediaViewer";
import { installComponentActivity } from "./activity";
import { useLocale, useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/customComponents";
import common from "../../i18n/messages/common";
import { AssistantContext } from "../assistant-context";
import { componentContextIssue } from "./component-context.mjs";
import { BindingBasisContext } from "../../datasets/basis";
import "./custom.css";

const ComponentsContext = createContext<ReadonlyMap<string, CompiledComponent>>(
  new Map(),
);
const InlineHostContext = createContext<HTMLElement | null>(null);
export const useInlineComponentHost = () => useContext(InlineHostContext);

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
  const components = useContext(ComponentsContext);
  return useMemo(() => [...components.values()], [components]);
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
      Object.getPrototypeOf(entry) === Object.prototype &&
      Object.entries(entry).every(
        ([key, item]) =>
          !["__proto__", "constructor", "prototype"].includes(key) &&
          visit(item, depth + 1),
      )
    );
  };
  return visit(value);
}

export function CustomBlock({ data, onChange, readOnly }: BlockProps) {
  const parsed = readCustomBlockData(data);
  const components = useContext(ComponentsContext);
  const inlineHost = useContext(InlineHostContext);
  const component = findComponent(components, parsed);
  const t = useTranslator(messages);
  const reference = `${parsed.componentId}@${parsed.version}`;
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
    <section className="sb-block sb-unavailable" aria-label={t("notInstalled")}>
      <div style={{ padding: 18 }}>
        <strong>{parsed.componentId}</strong>
        <p>
          {parsed.integrity
            ? t("installRequiredIntegrity", {
                component: reference,
                integrity: parsed.integrity.slice(7, 19),
              })
            : t("installRequired", { component: reference })}
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
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const locale = useLocale();
  const initialTheme = useRef(theme);
  const [channel] = useState(() => crypto.randomUUID());
  useSelectionFrame(iframe, channel);
  const [height, setHeight] = useState(180);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [validating, setValidating] = useState(false);
  // Raw JSON is the advanced path; without an agent it is the only one, so it starts open.
  const [jsonOpen, setJsonOpen] = useState(false);
  const draftBase = useRef("");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const pendingValidation = useRef<{
    id: string;
    props: Record<string, unknown>;
    timeout: number;
  } | null>(null);
  // Present in the workbench page; readers and exports have no conversation.
  const assistant = useContext(AssistantContext);
  const latest = useRef({ data, parsed, onChange, readOnly, assistant });
  const initial = useRef({
    props: parsed.props,
    readOnly: !!readOnly || !onChange,
  });
  latest.current = { data, parsed, onChange, readOnly, assistant };
  // A bound block asks which props each change started from. The frame posts
  // showai:valid after applying each props message, in order.
  const basisContext = useContext(BindingBasisContext);
  const basisReporter = useRef(basisContext);
  basisReporter.current = basisContext;
  const reportBasis = (props: Record<string, unknown>) =>
    basisReporter.current?.(props);
  const frameProps = useRef(initial.current.props);
  const unconfirmed = useRef<Record<string, unknown>[]>([]);
  /** The page block this instance renders, for state handed to the conversation. */
  const blockId = () => {
    const owner = iframe.current?.closest<HTMLElement>(
      "[data-block-id],[data-surface-id]",
    );
    return owner?.dataset.blockId ?? owner?.dataset.surfaceId;
  };
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
    setJsonOpen(!latest.current.assistant);
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
      setDraftError(error instanceof Error ? error.message : t("invalidJson"));
      return;
    }
    if (!jsonObject(next)) {
      setDraftError(t("notJsonObject"));
      return;
    }
    try {
      assertContent(
        next,
        "Component instance data",
        CAPACITY.componentPropsBytes,
      );
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : t("dataTooLarge"));
      return;
    }
    if (JSON.stringify(latest.current.parsed.props) !== draftBase.current) {
      setDraftError(t("dataChanged"));
      return;
    }
    cancelValidation();
    setDraftError("");
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      pendingValidation.current = null;
      setValidating(false);
      setDraftError(t("validationTimeout"));
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
    const policy = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${componentSandboxPolicy}">`;
    return (
      policy +
      injectComponentBootstrap(
        component.html,
        // Built-in blocks compiled into the package start in the workbench language.
        `<style>body{color:var(--text)}</style><script>document.documentElement.lang=document.documentElement.dataset.showaiLocale=${safeJson(locale)};(${installComponentActivity.toString()})(${safeJson(channel)});(${installSandboxTheme.toString()})(${safeJson(channel)},${safeJson(initialTheme.current)},${safeJson(appearanceTokens())});</script><script id="showai-component-data" type="application/json">${safeJson({ channel, ...initial.current })}</script>`,
      ) +
      `<script>${componentSelectionScript(channel)}(${installIconTooltips.toString()})(document);(${installComponentLinks.toString()})(${safeJson(channel)});</script>`
    );
  }, [component.html, channel, locale]);

  const sendProps = () => {
    const current = latest.current;
    unconfirmed.current.push(current.parsed.props);
    if (unconfirmed.current.length > 64) unconfirmed.current.shift();
    iframe.current?.contentWindow?.postMessage(
      {
        channel,
        type: "showai:props",
        props: current.parsed.props,
        readOnly: !!current.readOnly || !current.onChange,
        // Previews and dialogs are not page blocks, so they cannot hand over state.
        context: !!current.assistant && !!blockId(),
      },
      "*",
    );
  };
  useEffect(() => {
    const frame = iframe.current;
    const activate = () =>
      frame?.contentWindow?.postMessage(
        { channel, type: "showai:activity", active: true },
        "*",
      );
    activate();
    frame?.addEventListener("load", activate);
    return () => {
      frame?.removeEventListener("load", activate);
      frame?.contentWindow?.postMessage(
        { channel, type: "showai:activity", active: false },
        "*",
      );
    };
  }, [channel]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        !event.data ||
        event.data.channel !== channel
      )
        return;
      if (event.data.type === "showai:ready") {
        frameProps.current = initial.current.props;
        unconfirmed.current = [];
        sendProps();
        // State still waiting in the conversation input returns to its component.
        const id = blockId();
        const pending = id
          ? latest.current.assistant?.pendingComponentContext(id)
          : undefined;
        if (pending)
          iframe.current?.contentWindow?.postMessage(
            { channel, type: "showai:context-restore", snapshot: pending },
            "*",
          );
      }
      if (event.data.type === "showai:context") {
        const snapshot = event.data.snapshot;
        const id = blockId();
        // The runtime checks this too; the host never trusts the frame.
        if (!id || componentContextIssue(snapshot)) return;
        latest.current.assistant?.componentContext({
          ...snapshot,
          blockId: id,
          componentId: latest.current.parsed.componentId,
          name: component.name,
        });
        return;
      }
      if (event.data.type === "showai:open-url") {
        // The page around the block may open its own links in place, such as the built-in docs.
        const link = new CustomEvent("showai:component-link", {
          bubbles: true,
          cancelable: true,
          detail: { url: event.data.url },
        });
        if (iframe.current?.dispatchEvent(link) !== false)
          openComponentLink(event.data.url);
        return;
      }
      if (event.data.type === "showai:open-media") {
        openComponentMedia(event.data.url);
        return;
      }
      if (
        event.data.type === "showai:height" &&
        typeof event.data.height === "number" &&
        Number.isFinite(event.data.height)
      )
        setHeight(Math.min(4000, Math.max(48, Math.ceil(event.data.height))));
      if (event.data.type === "showai:error")
        setError(
          String(event.data.message || t("cannotDisplay")).slice(0, 500),
        );
      if (event.data.type === "showai:valid") {
        setError("");
        frameProps.current = unconfirmed.current.shift() ?? frameProps.current;
      }
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
          error = t("viewportLockFailed", { error: String(caught) });
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
            String(event.data.message || t("invalidProps")).slice(0, 1000),
          );
        } else if (JSON.stringify(current.parsed.props) !== draftBase.current) {
          setDraftError(t("dataChanged"));
        } else if (!current.readOnly && current.onChange) {
          reportBasis(current.parsed.props);
          current.onChange({ ...current.data, props: pending.props });
          closeEditor();
        }
      }
      if (
        event.data.type === "showai:change" &&
        !current.readOnly &&
        current.onChange &&
        jsonObject(event.data.props)
      ) {
        try {
          assertContent(
            event.data.props,
            "Component instance data",
            CAPACITY.componentPropsBytes,
          );
        } catch (error) {
          setDraftError(
            error instanceof Error ? error.message : t("dataTooLarge"),
          );
          return;
        }
        reportBasis(frameProps.current);
        frameProps.current = event.data.props;
        current.onChange({ ...current.data, props: event.data.props });
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      if (pendingValidation.current)
        window.clearTimeout(pendingValidation.current.timeout);
    };
  }, [channel]);
  // Callback identity is host plumbing; only data and edit permission cross the sandbox.
  useEffect(sendProps, [
    parsed.props,
    readOnly,
    editable,
    channel,
    !!assistant,
  ]);
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
          aria-label={t("editData")}
          title={t("editData")}
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
          <p className="custom-props-note">{t("noManualEditing")}</p>
          {assistant && (
            <button
              type="button"
              className="custom-props-agent"
              onClick={(event) => {
                const id = blockId();
                if (!id) return;
                const rect = event.currentTarget.getBoundingClientRect();
                closeEditor();
                assistant.open({
                  kind: "blocks",
                  blockIds: [id],
                  anchor: {
                    left: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                  },
                });
              }}
            >
              <Sparkles size={14} aria-hidden="true" />
              {t("askAgentToEdit")}
            </button>
          )}
          <details
            className="custom-props-advanced"
            open={jsonOpen}
            onToggle={(event) => setJsonOpen(event.currentTarget.open)}
          >
          <summary>{t("advancedJson")}</summary>
          <label htmlFor={`${channel}-props`}>{t("data")}</label>
          <textarea
            id={`${channel}-props`}
            aria-label={t("propsJson")}
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
          </details>
          <div className="custom-props-actions">
            <button type="button" onClick={closeEditor}>
              {tc("cancel")}
            </button>
            {jsonOpen && (
              <button
                type="button"
                className="is-primary"
                disabled={validating}
                onClick={saveDraft}
              >
                {validating ? t("validating") : t("apply")}
              </button>
            )}
          </div>
        </div>
      )}
      {!editing && draftError && (
        <p role="alert" className="custom-props-error">
          {draftError}
        </p>
      )}
      <iframe
        ref={iframe}
        title={component.name}
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-downloads"
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
