import { BuiltinPreview } from "../components/BuiltinPreview";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
} from "../components/custom/types";
import { CustomComponentsProvider } from "../components/custom/CustomBlock";
import { componentWidgetData } from "../components/custom/contract";
import { Widget } from "../components/blocks/Widget";
import { desktop, errorMessage } from "./bridge";
import "./component-preview.css";

export default function ComponentPreviewPage() {
  const [component, setComponent] = useState<
    BuiltinComponentMetadata | CompiledComponent
  >();
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const native = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const args = JSON.parse(
      new URLSearchParams(location.search).get("componentPreview")!,
    );
    document.documentElement.dataset.theme =
      args.theme === "dark" ? "dark" : "light";
  }, []);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(location.search);
    const args = JSON.parse(params.get("componentPreview")!) as Record<
      string,
      unknown
    >;
    void desktop
      .invoke<BuiltinComponentMetadata | CompiledComponent>(
        params.get("thumbnailCapture") === "1"
          ? "components:previewData"
          : "components:get",
        args,
      )
      .then((item) => {
        if (!cancelled) setComponent(item);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!component || !native.current) return;
    const element = native.current;
    let cancelled = false;
    const fit = () => {
      const scale = Math.min(
        1,
        664 / element.offsetWidth,
        364 / Math.max(1, element.offsetHeight),
      );
      element.style.transform = `translate(-50%, -50%) scale(${scale})`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let receive: ((event: MessageEvent) => void) | undefined;
    const sandboxReady =
      "kind" in component
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("组件示例加载超时。")),
              10000,
            );
            receive = (event: MessageEvent) => {
              if (
                event.source !== element.querySelector("iframe")?.contentWindow
              )
                return;
              if (event.data?.type === "showai:error")
                reject(new Error(String(event.data.message)));
              if (event.data?.type === "showai:height") {
                clearTimeout(timeout);
                resolve();
              }
            };
            window.addEventListener("message", receive);
          });
    void (async () => {
      await sandboxReady;
      const deadline = Date.now() + 10000;
      while (
        element.querySelector(
          '[data-preview-pending="true"],[aria-busy="true"]',
        )
      ) {
        if (cancelled) return;
        if (Date.now() >= deadline) throw new Error("组件示例加载超时。");
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const failure = element.querySelector('[role="alert"]');
      if (failure) throw new Error(failure.textContent || "组件无法显示。");
      await document.fonts.ready;
      await Promise.all(
        [...element.querySelectorAll("img")].map((img) => img.decode()),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            fit();
            resolve();
          }),
        ),
      );
      if (!cancelled) setReady(true);
    })().catch((reason) => {
      if (!cancelled) setError(errorMessage(reason));
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      clearTimeout(timeout);
      if (receive) window.removeEventListener("message", receive);
    };
  }, [component]);
  const example = component?.examples[0]?.data ?? component?.defaultData ?? {};
  const data =
    component && "kind" in component && component.kind === "flowchart"
      ? { ...example, height: 360 }
      : example;
  return (
    <div
      className="component-capture-stage"
      data-preview-ready={ready && !error ? "true" : "false"}
      data-preview-error={error || undefined}
    >
      <div className="component-capture-native" ref={native}>
        {component &&
          ("kind" in component ? (
            <BuiltinPreview component={component} data={data} />
          ) : (
            <CustomComponentsProvider components={[component]}>
              <Widget
                kind="custom"
                data={componentWidgetData(component, data)}
                readOnly
              />
            </CustomComponentsProvider>
          ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
