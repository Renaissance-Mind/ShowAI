import { remoteConnectionFlow } from "./remote-flow";
import { workbenchMotion } from "./features/workbench-motion";
import type { Locale } from "../i18n";
import labMessages from "../i18n/messages/uiLab";
import flowMessages from "../i18n/messages/uiFlow";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";
import sidebarMessages from "../i18n/messages/sidebar";
import { messages } from "./messages";
import { uiFeatures } from "./registry";
import type {
  FlowAction,
  FlowNode,
  SceneStep,
  UiFlow,
  UiTarget,
} from "./types";

export function uiFlow(feature: string, locale: Locale = "zh-CN"): UiFlow {
  if (feature === "remote-connection") return remoteConnectionFlow(locale);
  if (feature === "workbench-motion") return workbenchMotion(locale).flow;
  const owner = uiFeatures(locale).find((item) => item.id === feature);
  if (!owner) throw new Error(`Unknown UI flow: ${feature}`);
  const t = messages(labMessages, locale),
    f = messages(flowMessages, locale);
  const button = (name: string, within?: UiTarget): UiTarget => ({
    role: "button",
    name,
    within,
  });
  const heading = (name: string): UiTarget => ({ role: "heading", name });
  const dialog = (name: string): UiTarget => ({ role: "dialog", name });
  const action = (
    id: string,
    title: string,
    target: UiTarget,
    to?: string,
  ): FlowAction => ({ id, title, target, to });
  const b = (id: string, title: string, to?: string, within?: UiTarget) =>
    action(id, title, button(title, within), to);
  const nodes: FlowNode[] = [];
  const scene = (id: string) => {
    const found = owner.scenes.find((item) => item.id === id);
    if (!found) throw new Error(`Missing flow scene ${feature}/${id}`);
    return found;
  };
  const prefix = (id: string, through: string) => {
    const steps = scene(id).steps,
      end = steps.findIndex((step) => step.id === through);
    if (end < 0) throw new Error(`Missing flow checkpoint ${id}/${through}`);
    return steps.slice(0, end + 1);
  };
  const enter =
    (
      base: string,
      steps: SceneStep[],
      before?: SceneStep["run"],
    ): FlowNode["enter"] =>
    async (ctx) => {
      await before?.(ctx);
      await scene(base).prepare(ctx);
      for (const item of steps) await item.run(ctx);
    };
  if (feature === "workbench") {
    const s = messages(studioMessages, locale);
    const n = messages(sidebarMessages, locale);
    const add = action(
      "new-project",
      n("createProject"),
      button(n("createProject"), {
        selector: '[data-project-section="projects"]',
      }),
      "form",
    );
    nodes.push({
      id: "project",
      title: t("research"),
      screen: "project",
      screenTitle: t("workspace"),
      scene: "basic",
      matches: [
        { target: { role: "tabpanel", name: t("research") } },
        { target: heading(s("projectEmpty")) },
      ],
      enter: enter("basic", []),
      actions: [add],
    });
    nodes.push({
      id: "form",
      title: s("newProjectTitle"),
      parent: "project",
      screen: "form",
      screenTitle: s("newProjectTitle"),
      scene: "create-project",
      priority: 100,
      matches: [{ target: dialog(s("newProjectTitle")) }],
      enter: enter("create-project", prefix("create-project", "form")),
      actions: [
        action("name", s("projectName"), {
          role: "textbox",
          name: s("projectName"),
        }),
        b(
          "create",
          s("createProject"),
          "created",
          dialog(s("newProjectTitle")),
        ),
        b(
          "close",
          messages(commonMessages, locale)("cancel"),
          "project",
          dialog(s("newProjectTitle")),
        ),
      ],
    });
    nodes.push({
      id: "created",
      title: f("projectCreated"),
      parent: "form",
      screen: "project",
      screenTitle: t("workspace"),
      scene: "create-project",
      matches: [
        { target: { role: "tabpanel", name: t("research") }, state: "hidden" },
        { target: heading(s("projectEmpty")) },
      ],
      enter: enter("create-project", prefix("create-project", "created")),
      actions: [add],
    });
    return { feature, title: owner.title, entry: "project", nodes };
  }
  throw new Error(`Unknown UI flow: ${feature}`);
}
export function flowNode(
  feature: string,
  node: string,
  locale: Locale = "zh-CN",
) {
  const found = uiFlow(feature, locale).nodes.find((item) => item.id === node);
  if (!found) throw new Error(`Unknown UI state: ${feature}/${node}`);
  return found;
}
