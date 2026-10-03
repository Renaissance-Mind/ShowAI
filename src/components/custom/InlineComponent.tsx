import * as ReactRuntime from "react";
import * as DomRuntime from "react-dom";
import * as ClientRuntime from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import { useEffect, useRef, useState } from "react";
import type { CompiledComponent } from "./types";

interface MountedComponent {
  update(data: Record<string, unknown>): void;
  destroy(): void;
}
interface InlineModule {
  mount(
    target: HTMLElement,
    options: {
      data: Record<string, unknown>;
      onError: (message: string) => void;
    },
  ): MountedComponent;
}

/** Only the portable reader enables this inside an existing conversation sandbox.
 * Shadow DOM isolates styling; the host iframe is the JavaScript security boundary.
 */
export function InlineComponent({
  component,
  data,
  host,
}: {
  component: CompiledComponent;
  data: Record<string, unknown>;
  host: HTMLElement;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedComponent | null>(null);
  const currentData = useRef(data);
  const [error, setError] = useState("");
  currentData.current = data;
  useEffect(() => {
    if (
      !container.current ||
      !host.hasAttribute("data-showai-inline-root") ||
      !host.contains(container.current) ||
      window.showai
    ) {
      setError("此运行方式仅用于对话内的独立页面。");
      return;
    }
    if (!component.inline) {
      setError(
        `组件 ${component.id}@${component.version} 尚无对话内运行版本，请从源码导入新版本后重新导出。`,
      );
      return;
    }
    const shadow =
      container.current.shadowRoot ??
      container.current.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent =
      ":host{display:block;font:14px/1.6 system-ui,sans-serif;color:inherit}*{box-sizing:border-box}button,input,select,textarea{font:inherit}.component-root{display:flow-root;overflow-wrap:anywhere}" +
      component.inline.styles.replace(
        /:root\b|(?<![\w-])(?:html|body)(?=\s*[{,])/g,
        ":host",
      );
    const root = document.createElement("div");
    root.className = "component-root";
    shadow.replaceChildren(style, root);
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousHost = globals.__SHOWAI_COMPONENT_HOST__;
    const callbackKey = `__showai_mount_${crypto.randomUUID().replaceAll("-", "")}`;
    globals.__SHOWAI_COMPONENT_HOST__ = {
      react: ReactRuntime,
      client: ClientRuntime,
      dom: DomRuntime,
      jsx: JsxRuntime,
      jsxDev: JsxDevRuntime,
    };
    globals[callbackKey] = (module: InlineModule) => {
      mounted.current = module.mount(root, {
        data: currentData.current,
        onError: setError,
      });
    };
    const script = document.createElement("script");
    // This is a normal inline script in the host's pre-existing sandbox. It never
    // enters the desktop document, and neither eval nor arbitrary HTML is used.
    script.textContent = `(()=>{${component.inline.script}\nglobalThis[${JSON.stringify(callbackKey)}](ShowAIInlineComponent);})();`;
    try {
      host.appendChild(script);
      if (!mounted.current) setError("宿主未允许此组件运行。");
    } finally {
      script.remove();
      delete globals[callbackKey];
      if (previousHost === undefined) delete globals.__SHOWAI_COMPONENT_HOST__;
      else globals.__SHOWAI_COMPONENT_HOST__ = previousHost;
    }
    return () => {
      const instance = mounted.current;
      mounted.current = null;
      queueMicrotask(() => instance?.destroy());
    };
  }, [component.integrity, host]);
  useEffect(() => mounted.current?.update(data), [data]);
  return (
    <section aria-label={component.name} style={{ margin: "18px 0" }}>
      <div ref={container} />
      {error && (
        <p role="alert" className="custom-props-error">
          {error}
        </p>
      )}
    </section>
  );
}
