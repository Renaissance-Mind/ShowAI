import type { LabSession, SceneContext } from "./types";
import { domDriver } from "./dom-driver";
import { uiScene } from "./registry";
import { uiFlow, flowNode } from "./flow";
import { mountFlowOverlay } from "./flow-overlay";
import { setLanguagePreference } from "../i18n";

declare global {
  interface Window {
    __SHOWAI_UI_LAB__?: LabSession;
  }
}

export async function prepareUiLab() {
  const config = window.__SHOWAI_UI_LAB__;
  if (
    !config ||
    new URL(location.href).hostname !== "127.0.0.1" ||
    !window.showai
  )
    throw new Error("UI Lab requires its isolated development server.");
  localStorage.setItem("showai:appearance", config.theme);
  setLanguagePreference(config.locale);
  const normal = window.showai.invoke.bind(window.showai);
  window.showai.invoke = async <T>(
    action: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    if (action === "clipboard:write") {
      await fetch(`/__ui-lab/api/sessions/${config.id}/clipboard`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(args),
      });
      return null as T;
    }
    return normal<T>(action, args);
  };
  const call = async (path: string, input?: unknown) => {
    const response = await fetch(
      `/__ui-lab/api/sessions/${config.id}/${path}`,
      {
        method: input === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.token}`,
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const context: SceneContext = {
    locale: config.locale,
    ui: domDriver(document),
    event: (name, input = {}) => call("events", { name, input }),
    inspect: () => call("inspect"),
    assert(value, message) {
      if (!value) throw new Error(message);
    },
  };
  return async () => {
    try {
      if (new URLSearchParams(location.search).get("prepare") !== "0") {
        if (config.flow)
          await flowNode(config.flow, config.node!, config.locale).enter(
            context,
          );
        else
          await uiScene(config.feature, config.scene, config.locale).prepare(
            context,
          );
      }
      if (config.flow)
        mountFlowOverlay(config, uiFlow(config.flow, config.locale), () =>
          call("inspect?fixture=1"),
        );
      document.documentElement.dataset.uiLabReady = "true";
      window.parent.postMessage(
        { type: "showai-ui-lab-ready", session: config.id },
        location.origin,
      );
    } catch (error) {
      document.documentElement.dataset.uiLabError = String(error);
      window.parent.postMessage(
        {
          type: "showai-ui-lab-error",
          session: config.id,
          error: String(error),
        },
        location.origin,
      );
    }
  };
}
