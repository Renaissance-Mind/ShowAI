import type { Locale } from "../../i18n";
import labMessages from "../../i18n/messages/uiLab";
import settingsMessages from "../../i18n/messages/settings";
import libraryMessages from "../../i18n/messages/library";
import syncMessages from "../../i18n/messages/sync";
import flowMessages from "../../i18n/messages/accountFlow";
import agentMessages from "../../i18n/messages/agentSettings";
import pluginMessages from "../../i18n/messages/pluginInstall";
import remoteMessages from "../../i18n/messages/remoteConnections";
import feedbackMessages from "../../i18n/messages/feedback";
import commonMessages from "../../i18n/messages/common";
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

export function settingsAcceptance(locale: Locale = "zh-CN"): {
  feature: UiFeature;
  flow: UiFlow;
} {
  const u = messages(labMessages, locale);
  const s = messages(settingsMessages, locale);
  const lib = messages(libraryMessages, locale);
  const sy = messages(syncMessages, locale);
  const af = messages(flowMessages, locale);
  const ag = messages(agentMessages, locale);
  const pl = messages(pluginMessages, locale);
  const rm = messages(remoteMessages, locale);
  const fb = messages(feedbackMessages, locale);
  const tc = messages(commonMessages, locale);

  const selector = (value: string): UiTarget => ({ selector: value });
  const sidebar: UiTarget = selector(".settings-category-sidebar");
  const button = (name: string, within?: UiTarget): UiTarget => ({
    role: "button",
    name,
    within,
  });
  const action = (
    id: string,
    title: string,
    target: UiTarget,
    to?: string,
  ): FlowAction => ({ id, title, target, to });
  const nav = (
    id:
      | "general"
      | "appearance"
      | "sync"
      | "projects"
      | "agent"
      | "plugins"
      | "remote"
      | "about",
    to: string = id,
  ): FlowAction =>
    action(`nav-${id}`, s(`section.${id}`), button(s(`section.${id}`), sidebar), to);

  const openSettings = async ({ ui }: SceneContext) => {
    await ui.click(button(u("settings")));
    await ui.expect(selector('.studio-settings[data-settings-section="general"]'));
  };

  const openSection =
    (
      id:
        | "general"
        | "appearance"
        | "sync"
        | "projects"
        | "agent"
        | "plugins"
        | "remote"
        | "about",
    ) =>
    async (ctx: SceneContext) => {
      await openSettings(ctx);
      if (id !== "general") {
        await ctx.ui.click(button(s(`section.${id}`), sidebar));
        await ctx.ui.expect(
          selector(`.studio-settings[data-settings-section="${id}"]`),
        );
      }
    };

  const zeroDetailsCheck: SceneStep = {
    id: "no-details",
    title: u("settingsAcceptance"),
    run: async ({ ui }) => {
      await ui.expect(selector(".studio-settings details"), "hidden");
    },
  };

  const nodes: FlowNode[] = [];

  nodes.push({
    id: "general",
    title: s("section.general"),
    screen: "general",
    screenTitle: s("section.general"),
    scene: "overview",
    matches: [{ target: selector('.studio-settings[data-settings-section="general"]') }],
    enter: openSection("general"),
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "find-cleanup",
        lib("findCleanup"),
        button(lib("findCleanup")),
        "general.cleanup",
      ),
      action(
        "show-shortcuts",
        s("showShortcuts"),
        button(s("showShortcuts")),
        "general.shortcuts",
      ),
      nav("appearance"),
      nav("sync"),
      nav("projects"),
      nav("agent"),
      nav("plugins"),
      nav("remote"),
      nav("about"),
    ],
  });

  nodes.push({
    id: "general.cleanup",
    title: lib("findCleanup"),
    parent: "general",
    screen: "general.cleanup",
    screenTitle: lib("findCleanupTitle"),
    scene: "overview",
    priority: 10,
    matches: [
      { target: { role: "dialog", name: lib("findCleanupTitle") } },
    ],
    enter: async (ctx) => {
      await openSection("general")(ctx);
      await ctx.ui.click(button(lib("findCleanup")));
      await ctx.ui.expect({ role: "dialog", name: lib("findCleanupTitle") });
    },
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "dismiss-cleanup",
        lib("dismissCleanupPlan"),
        button(lib("dismissCleanupPlan")),
        "general",
      ),
    ],
  });

  nodes.push({
    id: "general.shortcuts",
    title: s("keyboardShortcuts"),
    parent: "general",
    screen: "general.shortcuts",
    screenTitle: s("keyboardShortcuts"),
    scene: "overview",
    priority: 10,
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="general"] .settings-shortcuts-grid',
        ),
      },
    ],
    enter: async (ctx) => {
      await openSection("general")(ctx);
      await ctx.ui.click(button(s("showShortcuts")));
      await ctx.ui.expect(
        selector(
          '.studio-settings[data-settings-section="general"] .settings-shortcuts-grid',
        ),
      );
    },
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "back",
        s("backToGeneral"),
        button(s("backToGeneral")),
        "general",
      ),
    ],
  });

  nodes.push({
    id: "appearance",
    title: s("section.appearance"),
    parent: "general",
    screen: "appearance",
    screenTitle: s("section.appearance"),
    scene: "overview",
    matches: [
      { target: selector('.studio-settings[data-settings-section="appearance"]') },
    ],
    enter: openSection("appearance"),
    checks: [zeroDetailsCheck],
    actions: [
      action("theme-system", s("themeSystem"), {
        role: "radio",
        name: s("themeSystem"),
      }),
      action("theme-light", s("light"), { role: "radio", name: s("light") }),
      action("theme-dark", s("dark"), { role: "radio", name: s("dark") }),
      action("language", s("language"), {
        role: "combobox",
        name: s("language"),
      }),
      nav("sync"),
    ],
  });

  nodes.push({
    id: "sync",
    title: s("section.sync"),
    stateLabel: u("syncLocalOnly"),
    parent: "general",
    screen: "sync",
    screenTitle: s("section.sync"),
    scene: "overview",
    variants: ["sync", "sync.connected"],
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="sync"] .sync-accounts-view',
        ),
      },
    ],
    when: (state) => !state.syncConnected,
    enter: openSection("sync"),
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "add-account",
        af("addAccount"),
        button(af("addAccount"), selector(".sync-accounts-view")),
        "sync.login",
      ),
      nav("projects"),
    ],
  });

  nodes.push({
    id: "sync.connected",
    title: u("syncConnected"),
    parent: "sync",
    screen: "sync.accounts",
    screenTitle: s("section.sync"),
    scene: "overview",
    priority: 5,
    variants: ["sync", "sync.connected"],
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="sync"] .sync-accounts-view:has(.sync-account-row)',
        ),
      },
    ],
    when: (state) => !!state.syncConnected,
    enter: async (ctx) => {
      await ctx.event("sync.connected");
      await openSection("sync")(ctx);
      await ctx.ui.expect(
        selector(".sync-accounts-view:has(.sync-account-row)"),
      );
    },
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "view-projects",
        af("viewProjects"),
        button(af("viewProjects")),
        "projects.connected",
      ),
      action(
        "manage-account",
        af("manageAccount"),
        button(af("manageAccount")),
        "sync.account",
      ),
      action(
        "re-sign-in",
        af("signIn"),
        button(af("signIn")),
        "sync.login",
      ),
      nav("projects", "projects.connected"),
    ],
  });

  nodes.push({
    id: "sync.login",
    title: af("auth.title"),
    parent: "sync",
    screen: "sync.login",
    screenTitle: af("auth.title"),
    scene: "overview",
    priority: 20,
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="sync"] .sync-login',
        ),
      },
    ],
    enter: async (ctx) => {
      await openSection("sync")(ctx);
      await ctx.ui.click(
        button(af("addAccount"), selector(".sync-accounts-view")),
      );
      await ctx.ui.expect(selector(".sync-login"));
    },
    checks: [zeroDetailsCheck],
    actions: [
      action("server-url", sy("serverUrl"), {
        role: "textbox",
        name: sy("serverUrl"),
      }),
      action(
        "back",
        af("backToAccounts"),
        button(af("backToAccounts")),
        "sync",
      ),
    ],
  });

  nodes.push({
    id: "sync.account",
    title: af("manageAccount"),
    parent: "sync.connected",
    screen: "sync.account",
    screenTitle: af("manageAccount"),
    scene: "overview",
    priority: 20,
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="sync"] .sync-account-panel-groups',
        ),
      },
    ],
    enter: async (ctx) => {
      await ctx.event("sync.connected");
      await openSection("sync")(ctx);
      await ctx.ui.click(button(af("manageAccount")));
      await ctx.ui.expect(selector(".sync-account-panel-groups"));
    },
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "create-token",
        sy("createPersonalToken"),
        button(sy("createPersonalToken")),
      ),
      action(
        "back",
        af("backToAccounts"),
        button(af("backToAccounts")),
        "sync.connected",
      ),
    ],
  });

  nodes.push({
    id: "projects",
    title: s("section.projects"),
    stateLabel: u("syncLocalOnly"),
    parent: "general",
    screen: "projects",
    screenTitle: s("section.projects"),
    scene: "overview",
    variants: ["projects", "projects.connected"],
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="projects"] .sync-local-banner',
        ),
      },
    ],
    when: (state) => !state.syncConnected,
    enter: openSection("projects"),
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "add-account",
        af("addAccount"),
        button(af("addAccount"), selector(".sync-local-banner")),
        "sync.login",
      ),
      action(
        "join-project",
        af("invitationTitle"),
        button(af("invitationTitle"), selector(".sync-project-manager")),
        "projects.join",
      ),
      nav("agent"),
    ],
  });

  nodes.push({
    id: "projects.connected",
    title: u("syncConnected"),
    parent: "projects",
    screen: "projects",
    screenTitle: s("section.projects"),
    scene: "overview",
    priority: 5,
    variants: ["projects", "projects.connected"],
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="projects"] .sync-default-location-card',
        ),
      },
    ],
    when: (state) => !!state.syncConnected,
    enter: async (ctx) => {
      await ctx.event("sync.connected");
      await openSection("projects")(ctx);
      await ctx.ui.expect(selector(".sync-default-location-card"));
    },
    checks: [zeroDetailsCheck],
    actions: [
      action("default-location", af("defaults"), {
        role: "combobox",
        name: af("defaults"),
      }),
      action(
        "resolve-conflict",
        sy("resolveConflict"),
        button(sy("resolveConflict"), selector(".sync-table-card")),
        "projects.conflict",
      ),
    ],
  });

  nodes.push({
    id: "projects.conflict",
    title: sy("compareChanges"),
    parent: "projects.connected",
    screen: "projects.conflict",
    screenTitle: sy("compareChanges"),
    scene: "overview",
    priority: 100,
    matches: [
      { target: { role: "dialog", name: sy("compareChanges") } },
      { target: selector(".sync-conflict") },
    ],
    enter: async (ctx) => {
      await ctx.event("sync.connected");
      await openSection("projects")(ctx);
      await ctx.ui.expect(selector(".sync-default-location-card"));
      await ctx.ui.click(
        button(sy("resolveConflict"), selector(".sync-table-card")),
      );
      await ctx.ui.expect(selector(".sync-conflict"));
    },
    actions: [
      action(
        "later",
        sy("resolveLater"),
        button(sy("resolveLater")),
        "projects.connected",
      ),
    ],
  });

  nodes.push({
    id: "projects.join",
    title: af("invitationTitle"),
    parent: "projects",
    screen: "projects.join",
    screenTitle: af("invitationTitle"),
    scene: "overview",
    priority: 20,
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="projects"] .sync-join',
        ),
      },
    ],
    enter: async (ctx) => {
      await openSection("projects")(ctx);
      await ctx.ui.click(
        button(af("invitationTitle"), selector(".sync-project-manager")),
      );
      await ctx.ui.expect(selector(".sync-join"));
    },
    checks: [zeroDetailsCheck],
    actions: [
      action("invite-url", sy("inviteLinkLabel"), {
        role: "textbox",
        name: sy("inviteLinkLabel"),
      }),
      action("view-invite", sy("viewInvite"), button(sy("viewInvite"))),
      action(
        "back",
        af("backToProjects"),
        button(af("backToProjects")),
        "projects",
      ),
    ],
  });

  nodes.push({
    id: "agent",
    title: s("section.agent"),
    parent: "general",
    screen: "agent",
    screenTitle: s("section.agent"),
    scene: "overview",
    variants: ["agent", "agent.no-local"],
    matches: [
      { target: selector('.studio-settings[data-settings-section="agent"]') },
    ],
    when: (state) => state.localAgentsInstalled !== false,
    enter: openSection("agent"),
    checks: [zeroDetailsCheck],
    actions: [
      action("manage-source", ag("manageSource"), button(ag("manageSource"))),
      action("remove-source", ag("removeSource"), button(ag("removeSource"))),
      nav("plugins"),
    ],
  });

  nodes.push({
    id: "agent.no-local",
    title: u("agentEmptyLocal"),
    parent: "agent",
    screen: "agent",
    screenTitle: s("section.agent"),
    scene: "overview",
    priority: 5,
    variants: ["agent", "agent.no-local"],
    matches: [
      { target: selector('.studio-settings[data-settings-section="agent"]') },
      { target: button(ag("switchToApiMode")) },
    ],
    when: (state) => state.localAgentsInstalled === false,
    enter: async (ctx) => {
      await ctx.event("agent.noLocal");
      await openSection("agent")(ctx);
      await ctx.ui.expect(button(ag("switchToApiMode")));
    },
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "switch-api",
        ag("switchToApiMode"),
        button(ag("switchToApiMode")),
        "agent",
      ),
      action("rescan", ag("rescan"), button(ag("rescan"))),
    ],
  });

  nodes.push({
    id: "plugins",
    title: s("section.plugins"),
    parent: "general",
    screen: "plugins",
    screenTitle: s("section.plugins"),
    scene: "overview",
    matches: [
      { target: selector('.studio-settings[data-settings-section="plugins"]') },
    ],
    enter: openSection("plugins"),
    checks: [zeroDetailsCheck],
    actions: [
      action("rescan", pl("refresh"), button(pl("refresh"))),
      action("specify-path", pl("manualToggle"), button(pl("manualToggle"))),
      nav("remote"),
    ],
  });

  nodes.push({
    id: "remote",
    title: s("section.remote"),
    parent: "general",
    screen: "remote",
    screenTitle: s("section.remote"),
    scene: "overview",
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="remote"] .remote-settings[data-remote-view="overview"]',
        ),
      },
    ],
    enter: openSection("remote"),
    checks: [zeroDetailsCheck],
    actions: [
      action(
        "configure-lan",
        rm("configure", { name: rm("lan") }),
        button(rm("configure", { name: rm("lan") })),
        "remote.lan",
      ),
      nav("about"),
    ],
  });

  nodes.push({
    id: "remote.lan",
    title: rm("lan"),
    parent: "remote",
    screen: "remote.lan",
    screenTitle: rm("lan"),
    scene: "overview",
    priority: 10,
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="remote"] .remote-settings[data-remote-provider="lan"]',
        ),
      },
    ],
    enter: async (ctx) => {
      await openSection("remote")(ctx);
      await ctx.ui.click(button(rm("configure", { name: rm("lan") })));
      await ctx.ui.expect(
        selector('.remote-settings[data-remote-provider="lan"]'),
      );
    },
    checks: [zeroDetailsCheck],
    actions: [
      action("back", rm("back"), button(rm("back")), "remote"),
    ],
  });

  nodes.push({
    id: "about",
    title: s("section.about"),
    parent: "general",
    screen: "about",
    screenTitle: s("section.about"),
    scene: "overview",
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="about"] .feedback-about',
        ),
      },
    ],
    enter: openSection("about"),
    checks: [zeroDetailsCheck],
    actions: [
      action("check-update", fb("update.check"), button(fb("update.check"))),
      action(
        "open-plugins",
        fb("openPluginSettings"),
        button(fb("openPluginSettings")),
        "plugins",
      ),
      action(
        "report",
        fb("help.report"),
        selector(".feedback-card:nth-child(2)"),
        "about.report",
      ),
    ],
  });

  nodes.push({
    id: "about.report",
    title: fb("report.title"),
    parent: "about",
    screen: "about.report",
    screenTitle: fb("report.title"),
    scene: "overview",
    priority: 10,
    matches: [
      {
        target: selector(
          '.studio-settings[data-settings-section="about"] .feedback-report',
        ),
      },
    ],
    enter: async (ctx) => {
      await openSection("about")(ctx);
      await ctx.ui.click(selector(".feedback-card:nth-child(2)"));
      await ctx.ui.expect(selector(".feedback-report"));
    },
    checks: [zeroDetailsCheck],
    actions: [
      action("summary", fb("report.summary"), {
        role: "textbox",
        name: fb("report.summary"),
      }),
      action(
        "back",
        fb("report.back"),
        button(fb("report.back")),
        "about",
      ),
    ],
  });

  const feature: UiFeature = {
    id: "settings",
    title: u("settingsAcceptance"),
    events: [
      { name: "sync.connected", title: u("syncConnected") },
      { name: "sync.localOnly", title: u("syncLocalOnly") },
      { name: "agent.noLocal", title: u("agentEmptyLocal") },
    ],
    scenes: [
      {
        id: "overview",
        title: u("settingsAcceptance"),
        description: tc("settings"),
        fixture: "settings",
        layout: { dialogPadding: 14, primaryContrast: 4.5 },
        prepare: openSettings,
        steps: [
          {
            id: "general",
            title: s("section.general"),
            run: async ({ ui }) => {
              await ui.expect(
                selector('.studio-settings[data-settings-section="general"]'),
              );
              await ui.expect(selector(".studio-settings details"), "hidden");
            },
          },
          {
            id: "appearance",
            title: s("section.appearance"),
            run: async ({ ui }) => {
              await ui.click(button(s("section.appearance"), sidebar));
              await ui.expect(
                selector(
                  '.studio-settings[data-settings-section="appearance"]',
                ),
              );
            },
          },
          {
            id: "sync",
            title: s("section.sync"),
            run: async (ctx) => {
              await ctx.event("sync.connected");
              await ctx.ui.click(button(s("section.sync"), sidebar));
              await ctx.ui.expect(
                selector(".sync-accounts-view:has(.sync-account-row)"),
              );
            },
          },
          {
            id: "projects",
            title: s("section.projects"),
            run: async ({ ui }) => {
              await ui.click(button(s("section.projects"), sidebar));
              await ui.expect(selector(".sync-default-location-card"));
            },
          },
          {
            id: "agent",
            title: s("section.agent"),
            run: async ({ ui }) => {
              await ui.click(button(s("section.agent"), sidebar));
              await ui.expect(
                selector('.studio-settings[data-settings-section="agent"]'),
              );
            },
          },
          {
            id: "plugins",
            title: s("section.plugins"),
            run: async ({ ui }) => {
              await ui.click(button(s("section.plugins"), sidebar));
              await ui.expect(
                selector('.studio-settings[data-settings-section="plugins"]'),
              );
            },
          },
          {
            id: "remote",
            title: s("section.remote"),
            run: async ({ ui }) => {
              await ui.click(button(s("section.remote"), sidebar));
              await ui.expect(
                selector('.remote-settings[data-remote-view="overview"]'),
              );
            },
          },
          {
            id: "about",
            title: s("section.about"),
            run: async ({ ui }) => {
              await ui.click(button(s("section.about"), sidebar));
              await ui.expect(selector(".feedback-about"));
            },
          },
        ],
      },
    ],
  };

  const flow: UiFlow = {
    feature: "settings",
    title: u("settingsAcceptance"),
    entry: "general",
    nodes,
  };

  return { feature, flow };
}
