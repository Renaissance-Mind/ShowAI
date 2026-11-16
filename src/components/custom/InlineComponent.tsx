import {
  useComponentInteractions,
  type ComponentTarget,
} from "../blocks/component-interactions";
import { componentActivationIssue } from "../../contract/component-activation.mjs";
import { renderComponentContent } from "../blocks/component-content";
import { createComponentRuntime } from "../../contract/component-runtime.mjs";
import {
  componentHostRequest,
  outlineRuntimeServices,
} from "../../contract/component-host";
import { componentContract } from "../../contract/component-contract.mjs";
import type { ComponentReceipt } from "../../contract/component-runtime.mjs";
import { installIconTooltips } from "../../ui/icon-tooltip.mjs";
import * as ReactRuntime from "react";
import * as DomRuntime from "react-dom";
import * as ClientRuntime from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import { useEffect, useRef, useState } from "react";
import type { CompiledComponent } from "../../contract/types";
import type { PageOutlineComponentProps } from "../../document/page-outline.mjs";
import { ComponentStatus } from "../blocks/ComponentStatus";
import { isValidationMessage, readableValidation, missingComponentCapability } from "./validation-messages";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/customComponents";
import {
  componentContextIssue,
  type ComponentContextSnapshot,
} from "../../contract/component-context.mjs";
import {
  navigationTarget,
  requestNavigation,
} from "../../document/page-link.mjs";

interface MountedComponent {
  update(
    data: Record<string, unknown>,
    outline?: PageOutlineComponentProps,
    activationTargets?: readonly ComponentTarget[],
  ): void;
  destroy(): void;
}
interface InlineModule {
  mount(
    target: HTMLElement,
    options: {
      data: Record<string, unknown>;
      onError: (message: string) => void;
      onContext?: (snapshot: ComponentContextSnapshot) => boolean;
      context?: ComponentContextSnapshot;
      outline?: PageOutlineComponentProps;
      goTo: (target: unknown) => boolean;
      activationTargets?: readonly ComponentTarget[];
      onActivate?: (target: ComponentTarget) => boolean;
      runtimeCapabilities?: Record<string, number>;
      request?: (
        operation: string,
        input: unknown,
      ) => Promise<ComponentReceipt>;
    },
  ): MountedComponent;
}

export const conversationContextEvent = "showai:conversation-context";
const handedOver = new Map<string, ComponentContextSnapshot>();

export function InlineComponent({
  component,
  data,
  host,
  outline,
  onError,
}: {
  component: CompiledComponent;
  data: Record<string, unknown>;
  host: HTMLElement;
  outline?: PageOutlineComponentProps;
  onError?: (message: string) => void;
}) {
  const interactions = useComponentInteractions();
  const activation = useRef(interactions);
  activation.current = interactions;
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedComponent | null>(null);
  const currentData = useRef(data);
  const [error, setError] = useState("");
  const t = useTranslator(messages);
  currentData.current = data;
  const currentOutline = useRef(outline);
  currentOutline.current = outline;
  useEffect(() => onError?.(error), [error, onError]);
  useEffect(() => {
    if (
      !container.current ||
      !host.hasAttribute("data-showai-inline-root") ||
      !host.contains(container.current) ||
      window.showai
    ) {
      setError(t("inlineOnlyInConversation"));
      return;
    }
    if (!component.inline) {
      setError(
        t("inlineUnavailable", {
          component: `${component.id}@${component.version}`,
        }),
      );
      return;
    }
    if (
      component.inline.protocol !== undefined &&
      component.inline.protocol !== 1
    ) {
      setError(t("inlineProtocol", { version: component.inline.protocol }));
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
    const removeTooltips = installIconTooltips(shadow);
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousHost = globals.__SHOWAI_COMPONENT_HOST__;
    const callbackKey = `__showai_mount_${crypto.randomUUID().replaceAll("-", "")}`;
    globals.__SHOWAI_COMPONENT_HOST__ = {
      react: ReactRuntime,
      client: ClientRuntime,
      dom: DomRuntime,
      jsx: JsxRuntime,
      jsxDev: JsxDevRuntime,
      content: renderComponentContent,
      runtime: createComponentRuntime,
    };
    const owner = container.current.closest<HTMLElement>(
      "[data-block-id],[data-surface-id]",
    );
    const blockId = owner?.dataset.blockId ?? owner?.dataset.surfaceId;
    const conversation =
      !!blockId && !!host.closest("[data-showai-conversation]");
    const onContext = (snapshot: ComponentContextSnapshot) => {
      const issue = componentContextIssue(snapshot);
      if (issue) throw new Error(`onContext: ${issue}`);
      if (navigator.userActivation && !navigator.userActivation.isActive)
        return false;
      const copy = JSON.parse(JSON.stringify(snapshot));
      handedOver.set(blockId!, copy);
      container.current?.dispatchEvent(
        new CustomEvent(conversationContextEvent, {
          bubbles: true,
          composed: true,
          detail: {
            blockId,
            componentId: component.id,
            name: component.name,
            snapshot: copy,
          },
        }),
      );
      return true;
    };
    const goTo = (value: unknown) => {
      const target = navigationTarget(value);
      if (!target)
        throw new Error(
          'goTo needs a ShowAI page link, "#blockId" or {pageId, blockId, projectId}.',
        );
      if (navigator.userActivation && !navigator.userActivation.isActive)
        return false;
      return requestNavigation(container.current ?? host, target);
    };
    let startupFailed = false;
    globals[callbackKey] = (module: InlineModule) => {
      try {
        mounted.current = module.mount(root, {
          data: currentData.current,
          outline: currentOutline.current,
          onError: setError,
          goTo,
          runtimeCapabilities: {
            ...componentContract(component).capabilities,
            pageOutline: currentOutline.current ? 1 : 0,
            databaseField: 0,
            events: 1,
            conversation: conversation ? 1 : 0,
            view: 0,
          },
          request: (operation, input) =>
            componentHostRequest({
              contract: component.contract ?? { version: 1 },
              data: currentData.current,
              operation,
              input,
              gesture:
                !navigator.userActivation || navigator.userActivation.isActive,
              services: {
                "event.emit": (value) =>
                  activation.current.emit(
                    value.name,
                    value.target,
                    value.payload,
                  ),
                "navigation.open": (value) => ({
                  status: goTo(value) ? "handled" : "unhandled",
                }),
                "conversation.submit": conversation
                  ? (snapshot) => ({
                      status: onContext(snapshot) ? "handled" : "unhandled",
                    })
                  : undefined,
                ...(currentOutline.current
                  ? outlineRuntimeServices(currentOutline.current)
                  : {}),
              },
            }),
          activationTargets: activation.current.targets.map((target) => ({
            ...target,
          })),
          onActivate: (target) => {
            const issue = componentActivationIssue(target);
            if (issue) throw new Error(issue);
            if (navigator.userActivation && !navigator.userActivation.isActive)
              return false;
            return activation.current.activate(target);
          },
          ...(conversation
            ? { onContext, context: handedOver.get(blockId!) }
            : {}),
        });
      } catch (error) {
        startupFailed = true;
        setError(error instanceof Error ? error.message : String(error));
      }
    };
    const script = document.createElement("script");
    script.textContent = `(()=>{${component.inline.script}\nglobalThis[${JSON.stringify(callbackKey)}](ShowAIInlineComponent);})();`;
    try {
      host.appendChild(script);
      if (!mounted.current && !startupFailed) setError(t("inlineBlocked"));
    } finally {
      script.remove();
      delete globals[callbackKey];
      if (previousHost === undefined) delete globals.__SHOWAI_COMPONENT_HOST__;
      else globals.__SHOWAI_COMPONENT_HOST__ = previousHost;
    }
    return () => {
      removeTooltips();
      const instance = mounted.current;
      mounted.current = null;
      queueMicrotask(() => instance?.destroy());
    };
  }, [component.integrity, host]);
  useEffect(
    () =>
      mounted.current?.update(
        data,
        outline,
        interactions.targets.map((target) => ({ ...target })),
      ),
    [data, outline, interactions.targets],
  );
  const missingCapability = missingComponentCapability(error);
  return (
    <section aria-label={component.name} style={{ margin: "18px 0" }}>
      <div ref={container} />
      {error && (
        <ComponentStatus
          state={isValidationMessage(error) ? "invalid" : "crashed"}
          name={component.name}
          reference={`${component.id}@${component.version}`}
          error={error}
          cause={missingCapability ? t("requiredCapability", { capability: missingCapability }) : undefined}
          issues={
            isValidationMessage(error)
              ? readableValidation(error)
              : []
          }
          readOnly
        />
      )}
    </section>
  );
}
