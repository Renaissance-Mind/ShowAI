import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { FlowMatch, FlowNode, LabSession, UiFlow } from "./types";
import { domDriver, queryUiTarget } from "./dom-driver";
import { messages } from "./messages";
import flowMessages from "../i18n/messages/uiFlow";
import "./flow-overlay.css";

export function resolveFlowNode(
  flow: UiFlow,
  state: Record<string, unknown>,
  matches: (match: FlowMatch) => boolean,
  previous?: string,
): FlowNode | undefined {
  return flow.nodes
    .filter(
      (node) => (!node.when || node.when(state)) && node.matches.every(matches),
    )
    .sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        b.matches.length - a.matches.length ||
        Number(b.id === previous) - Number(a.id === previous),
    )[0];
}
export function mountFlowOverlay(
  config: LabSession,
  flow: UiFlow,
  inspect: () => Promise<Record<string, unknown>>,
) {
  const host = document.createElement("div");
  host.id = "showai-ui-lab-overlay";
  document.body.append(host);
  const root = createRoot(host),
    ui = domDriver(document),
    f = messages(flowMessages, config.locale);
  type Action = {
    id: string;
    title: string;
    disabled: boolean;
    rect: { x: number; y: number; width: number; height: number };
  };
  function Overlay() {
    const [snapshot, setSnapshot] = useState<{
        node?: string;
        actions: Action[];
      }>({ actions: [] }),
      [enabled, setEnabled] = useState(
        config.annotations ?? config.mode === "manual",
      );
    useEffect(() => {
      let stopped = false,
        refreshing = false,
        previous: string | undefined,
        last = "",
        frame = 0;
      const disabled = (element: HTMLElement) =>
        (element as HTMLButtonElement).disabled ||
        element.getAttribute("aria-disabled") === "true";
      const match = ({ target, state }: FlowMatch) => {
        const element = queryUiTarget(document, target);
        if (state === "hidden") return !element;
        return (
          !!element &&
          (state === "disabled"
            ? disabled(element)
            : state === "enabled"
              ? !disabled(element)
              : true)
        );
      };
      async function refresh() {
        if (stopped || refreshing) return;
        refreshing = true;
        try {
          const data = await inspect();
          if (stopped) return;
          const node = resolveFlowNode(flow, data, match, previous);
          previous = node?.id;
          const next = {
            node: node?.id,
            actions: (node?.actions ?? []).flatMap((action) => {
              const element = queryUiTarget(document, action.target);
              if (!element) return [];
              const rect = element.getBoundingClientRect();
              return [
                {
                  id: action.id,
                  title: action.title,
                  disabled: !!disabled(element),
                  rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  },
                },
              ];
            }),
          };
          const serialized = JSON.stringify(next);
          if (serialized !== last) {
            last = serialized;
            document.documentElement.dataset.uiLabNode = node?.id ?? "";
            document.documentElement.dataset.uiLabActions = String(
              next.actions.length,
            );
            setSnapshot(next);
            window.parent.postMessage(
              { type: "showai-ui-lab-state", session: config.id, ...next },
              location.origin,
            );
          }
        } catch (error) {
          if (!stopped)
            window.parent.postMessage(
              {
                type: "showai-ui-lab-error",
                session: config.id,
                error: String(error),
              },
              location.origin,
            );
        } finally {
          refreshing = false;
        }
      }
      function schedule() {
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            void refresh();
          });
      }
      const observer = new MutationObserver((changes) => {
        if (
          changes.some(
            (change) =>
              !(
                change.target instanceof Element
                  ? change.target
                  : change.target.parentElement
              )?.closest("#showai-ui-lab-overlay"),
          )
        )
          schedule();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      document.addEventListener("scroll", schedule, true);
      document.addEventListener("input", schedule, true);
      document.addEventListener("change", schedule, true);
      window.addEventListener("resize", schedule);
      const timer = setInterval(() => void refresh(), 500);
      const receive = (event: MessageEvent) => {
        if (
          event.origin !== location.origin ||
          event.source !== window.parent ||
          event.data?.session !== config.id
        )
          return;
        if (event.data.type === "showai-ui-lab-annotations")
          setEnabled(!!event.data.enabled);
        if (event.data.type === "showai-ui-lab-action") {
          const action = flow.nodes
            .find((node) => node.id === previous)
            ?.actions.find((action) => action.id === event.data.action);
          if (action)
            void ui.click(action.target).then(schedule, (error) =>
              window.parent.postMessage(
                {
                  type: "showai-ui-lab-error",
                  session: config.id,
                  error: String(error),
                },
                location.origin,
              ),
            );
        }
      };
      window.addEventListener("message", receive);
      void refresh();
      return () => {
        stopped = true;
        clearInterval(timer);
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener("scroll", schedule, true);
        document.removeEventListener("input", schedule, true);
        document.removeEventListener("change", schedule, true);
        window.removeEventListener("resize", schedule);
        window.removeEventListener("message", receive);
      };
    }, []);
    return enabled ? (
      <div
        className="ui-flow-markers"
        data-mode={config.mode}
        aria-label={f("annotations")}
      >
        {snapshot.actions.map(
          (action, index) =>
            action.rect.y + action.rect.height > 0 &&
            action.rect.y < innerHeight &&
            action.rect.x + action.rect.width > 0 &&
            action.rect.x < innerWidth && (
              <div
                key={action.id}
                className={`ui-flow-target${action.disabled ? " disabled" : ""}`}
                style={{
                  left: action.rect.x,
                  top: action.rect.y,
                  width: action.rect.width,
                  height: action.rect.height,
                }}
              >
                <button
                  type="button"
                  aria-label={f("marker", {
                    index: index + 1,
                    name: action.title,
                  })}
                  disabled={action.disabled}
                  onClick={() => {
                    const target = flow.nodes
                      .find((node) => node.id === snapshot.node)
                      ?.actions.find((item) => item.id === action.id)?.target;
                    if (target) void ui.click(target);
                  }}
                >
                  {index + 1}
                  <span>{action.title}</span>
                </button>
              </div>
            ),
        )}
      </div>
    ) : null;
  }
  root.render(<Overlay />);
  return () => {
    root.unmount();
    host.remove();
  };
}
