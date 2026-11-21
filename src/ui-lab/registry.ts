import type { Locale } from "../i18n";
import labMessages from "../i18n/messages/uiLab";
import studioMessages from "../i18n/messages/studio";
import sidebarMessages from "../i18n/messages/sidebar";
import onboardingMessages from "../i18n/messages/onboarding";
import { messages } from "./messages";
import { remoteConnectionFeature } from "./features/remote-connection";
import { settingsAcceptance } from "./features/settings";
import { workbenchMotion } from "./features/workbench-motion";
import type { UiFeature, UiScene } from "./types";

export function uiFeatures(locale: Locale = "zh-CN"): UiFeature[] {
  const t = messages(labMessages, locale);
  const s = messages(studioMessages, locale);
  const n = messages(sidebarMessages, locale);
  const o = messages(onboardingMessages, locale);
  const prepareWorkbench: UiScene["prepare"] = async ({ ui }) => {
    await ui.expect({ role: "button", name: t("settings") });
    await ui.expect({
      name: o("samples.project"),
      within: { selector: '[data-project-section="projects"]' },
    });
    await ui.click({
      name: t("research"),
      within: { selector: '[data-project-section="projects"]' },
    });
    await ui.expect({ role: "tabpanel", name: t("research") });
    await ui.expect({ role: "heading", name: s("projectEmpty") });
  };
  return [
    remoteConnectionFeature(locale),
    {
      id: "workbench",
      title: t("workspace"),
      scenes: [
        {
          id: "basic",
          title: t("empty"),
          description: t("realApp"),
          fixture: "none",
          prepare: prepareWorkbench,
          steps: [
            {
              id: "workbench",
              title: t("workspace"),
              run: async ({ ui }) => {
                await ui.expect({ role: "button", name: t("settings") });
              },
            },
          ],
        },
        {
          id: "create-project",
          title: n("createProject"),
          description: t("realApp"),
          fixture: "none",
          layout: { dialogPadding: 16 },
          prepare: prepareWorkbench,
          steps: [
            {
              id: "form",
              title: n("createProject"),
              run: async ({ ui }) => {
                await ui.click({
                  role: "button",
                  name: n("createProject"),
                  within: { selector: '[data-project-section="projects"]' },
                });
                await ui.expect({ role: "dialog", name: s("newProjectTitle") });
                await ui.fill(
                  { role: "textbox", name: s("projectName") },
                  t("createdProject"),
                );
              },
            },
            {
              id: "created",
              title: t("save"),
              run: async (ctx) => {
                const dialog = {
                  role: "dialog" as const,
                  name: s("newProjectTitle"),
                };
                await ctx.ui.click({
                  role: "button",
                  name: s("createProject"),
                  within: dialog,
                });
                await ctx.ui.expect(dialog, "hidden");
                await ctx.ui.expect({
                  role: "tabpanel",
                  name: t("createdProject"),
                });
                await ctx.ui.expect({
                  role: "heading",
                  name: s("projectEmpty"),
                });
                const state = await ctx.inspect();
                const projects = (
                  state.application as { projects: Array<{ name: string }> }
                ).projects;
                ctx.assert(
                  projects.some(
                    (project) => project.name === t("createdProject"),
                  ),
                  "The actual application must persist the project.",
                );
              },
            },
          ],
        },
      ],
    },
    workbenchMotion(locale).feature,
    settingsAcceptance(locale).feature,
  ];
}
export function uiScene(
  feature: string,
  scene: string,
  locale: Locale = "zh-CN",
): UiScene {
  const found = uiFeatures(locale)
    .find((item) => item.id === feature)
    ?.scenes.find((item) => item.id === scene);
  if (!found) throw new Error(`Unknown UI scene: ${feature}/${scene}`);
  return found;
}
