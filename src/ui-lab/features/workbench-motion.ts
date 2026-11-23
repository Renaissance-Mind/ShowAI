import type { Locale } from "../../i18n";
import labMessages from "../../i18n/messages/uiLab";
import motionMessages from "../../i18n/messages/uiMotion";
import studioMessages from "../../i18n/messages/studio";
import onboardingMessages from "../../i18n/messages/onboarding";
import agentMessages from "../../i18n/messages/assistant";
import { messages } from "../messages";
import type {
  FlowAction,
  FlowNode,
  SceneContext,
  SceneStep,
  UiFeature,
  UiFlow,
  UiTarget,
} from "../types";

export function workbenchMotion(locale: Locale): {
  feature: UiFeature;
  flow: UiFlow;
} {
  const m = messages(motionMessages, locale),
    t = messages(labMessages, locale),
    s = messages(studioMessages, locale),
    o = messages(onboardingMessages, locale),
    agent = messages(agentMessages, locale);
  const feature: UiFeature = {
    id: "workbench-motion",
    title: m("feature"),
    scenes: [],
  };
  const flow: UiFlow = {
    feature: feature.id,
    title: feature.title,
    entry: "directory",
    nodes: [],
  };
  const css = (selector: string): UiTarget => ({ selector });
  const byTitle = (title: string) =>
    `.studio-tree-main[title=${JSON.stringify(title)}]`;
  const panel = (name: string): UiTarget => ({ role: "tabpanel", name });
  const tab = (name: string): UiTarget => ({ role: "tab", name });
  const action = (id: string, title: string, target: UiTarget): FlowAction => ({
    id,
    title,
    target,
  });
  const click = (
    item: FlowAction,
    after: UiTarget,
    motion?: SceneStep["motion"],
    state: "visible" | "hidden" = "visible",
  ): SceneStep => ({
    id: item.id,
    title: item.title,
    motion,
    run: async ({ ui }) => {
      await ui.click(item.target);
      await ui.expect(after, state);
    },
  });
  function add(
    id: string,
    title: string,
    anchor: string,
    prepare: FlowNode["enter"],
    actions: FlowAction[],
    steps: SceneStep[],
  ) {
    feature.scenes.push({
      id,
      title,
      description: t("realApp"),
      fixture: "none",
      prepare,
      steps,
    });
    flow.nodes.push({
      id,
      title,
      scene: id,
      screen: feature.id,
      screenTitle: feature.title,
      enter: prepare,
      matches: [{ target: css(`html[data-ui-lab-motion="${id}"] ${anchor}`) }],
      actions,
      checks: steps,
    });
  }
  const research = t("research"),
    first = m("interview"),
    second = m("plan");
  async function project({ ui }: SceneContext) {
    await ui.expect(css(byTitle(o("samples.project"))));
    await ui.click(css(byTitle(research)));
    await ui.expect(panel(research));
    await ui.expect(css(byTitle(first)));
  }
  async function page(ctx: SceneContext) {
    await project(ctx);
    await ctx.ui.click(css(byTitle(first)));
    await ctx.ui.expect(panel(first));
  }
  const rowToggle = (title: string) =>
    `.studio-tree-row:has(> ${byTitle(title)}) > .studio-tree-folder-toggle`;
  const toggles = [
    { id: "project", title: m("project"), selector: rowToggle(research) },
    { id: "folder", title: m("folder"), selector: rowToggle(m("materials")) },
    { id: "group", title: m("group"), selector: ".studio-section-toggle" },
  ];
  const directoryActions = toggles.map(({ id, title, selector }) =>
    action(id, title, css(selector)),
  );
  const toggleStep = (i: number, expanded: boolean, id = toggles[i].id) =>
    click(
      { ...directoryActions[i], id },
      css(`${toggles[i].selector}[aria-expanded="${expanded}"]`),
    );
  const docs = action("docs", m("docs"), css(".studio-docs-toggle"));
  const docsMotion = {
    selector: ".studio-docs",
    events: ["transition:grid-template-rows"],
  };
  add(
    "directory",
    m("directory"),
    ".studio-sidebar-projects",
    project,
    [...directoryActions, docs],
    [
      toggleStep(0, false),
      toggleStep(0, true, "reopen-project"),
      toggleStep(1, true),
      toggleStep(2, false),
      click(docs, css('.studio-docs-toggle[aria-expanded="true"]'), docsMotion),
      click(
        { ...docs, id: "close-docs" },
        css('.studio-docs-toggle[aria-expanded="false"]'),
        docsMotion,
      ),
    ],
  );

  const tabs = [first, second].map((name, i) =>
    action(i ? "second" : "first", name, tab(name)),
  );
  const tabSelection = {
    selector: ".studio-tab[data-active]",
    events: ["animation:studio-tab-select"],
  };
  add(
    "tabs",
    m("tabs"),
    ".studio-tabs:has(.studio-tab + .studio-tab)",
    async (ctx) => {
      await page(ctx);
      await ctx.ui.click(css(".studio-tab-add"));
      await ctx.ui.expect(css(".studio-tab + .studio-tab"));
      await project(ctx);
      await ctx.ui.click(css(byTitle(second)));
      await ctx.ui.expect(panel(second));
    },
    tabs,
    [
      click(tabs[0], panel(first), tabSelection),
      click(tabs[1], panel(second), tabSelection),
    ],
  );

  const lock = action(
    "pin",
    m("toggleNavigation"),
    css(".studio-sidebar-lock"),
  );
  const sidebar = {
    selector: ".studio-sidebar-shell > .studio-sidebar",
    events: ["transition:transform"],
    stableWidth: ".studio-window-topbar",
  };
  add(
    "navigation",
    m("navigation"),
    ".studio-sidebar-lock",
    page,
    [lock],
    [
      {
        id: "hide",
        title: m("hideNavigation"),
        motion: sidebar,
        run: async ({ ui }) => {
          await ui.click(lock.target);
          await ui.click(tab(first));
          await ui.expect(
            css(
              '.studio-sidebar-shell[data-sidebar-mode="hidden"] .studio-sidebar-edge',
            ),
          );
        },
      },
      click(
        { ...lock, id: "dock", title: m("dockNavigation") },
        css(
          '.studio-sidebar-shell[data-sidebar-mode="docked"] .studio-sidebar',
        ),
        sidebar,
      ),
    ],
  );

  const openAgent = action("open", m("openAgent"), {
    selector:
      '.studio-header-actions .studio-icon-labeled[aria-pressed="false"]',
    name: agent("panel.button"),
  });
  const closeAgent = action("close", m("closeAgent"), {
    role: "button",
    name: agent("panel.close"),
    within: css(".assistant-panel"),
  });
  const agentMotion = {
    selector: ".assistant-panel",
    events: ["transition:opacity", "transition:translate"],
    stableWidth: ".studio-main",
  };
  add(
    "agent",
    m("assistant"),
    ".studio-topbar .studio-icon-labeled[aria-pressed]",
    page,
    [openAgent, closeAgent],
    [
      click(
        openAgent,
        css('.assistant-panel[data-presence="shown"]'),
        agentMotion,
      ),
      click(closeAgent, css(".assistant-panel"), agentMotion, "hidden"),
    ],
  );

  const select = (name: string): UiTarget => ({
    role: "checkbox",
    name: s("selectPage", { title: name }),
  });
  const pick = action(
    "first",
    s("selectPage", { title: first }),
    select(first),
  );
  const another = action(
    "second",
    s("selectPage", { title: second }),
    select(second),
  );
  const done = action("finish", s("finishPageSelection"), {
    role: "button",
    name: s("finishPageSelection"),
  });
  const count = (value: number): UiTarget => ({
    name: s("selectedPages", { count: value }),
    within: css(".studio-page-selection"),
  });
  const search = ".studio-topbar .expandable-search";
  const expand = action(
    "open",
    m("openSearch"),
    css(search + " .expandable-search-trigger"),
  );
  const close = action(
    "close",
    m("closeSearch"),
    css(search + " .expandable-search-close"),
  );
  const input = css(search + " input");
  for (const proposed of [false, true]) {
    add(
      proposed ? "selection-proposal" : "selection",
      m(proposed ? "selectionProposal" : "selection"),
      ".studio-page-list",
      project,
      [pick, another, done],
      [
        click(pick, count(1), {
          selector: ".studio-page-selection",
          events: proposed ? ["animation:ui-lab-selection-in"] : [],
        }),
        click(another, count(2), {
          selector: ".studio-page-selection",
          events: [],
        }),
        click(done, css(".studio-page-selection"), undefined, "hidden"),
      ],
    );
  }
  for (const proposed of [false, true]) {
    add(
      proposed ? "search-proposal" : "search",
      m(proposed ? "searchProposal" : "search"),
      search,
      project,
      [expand, close],
      [
        click(
          expand,
          input,
          proposed
            ? {
                selector: search + " input",
                events: ["animation:ui-lab-search-in"],
                stableWidth: search,
              }
            : { selector: search, events: ["transition:width"] },
        ),
        {
          id: "filter",
          title: m("filter"),
          run: async ({ ui }) => {
            await ui.fill(input, first);
            await ui.expect(select(first));
            await ui.expect(select(second), "hidden");
          },
        },
        click(
          close,
          select(second),
          proposed
            ? { selector: search, events: [], stableWidth: search }
            : { selector: search, events: ["transition:width"] },
        ),
      ],
    );
  }
  return { feature, flow };
}
