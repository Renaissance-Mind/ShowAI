import type { Locale } from "../i18n";
import uiMessages from "../i18n/messages/uiLab";
import flowMessages from "../i18n/messages/uiFlow";
import connectionMessages from "../i18n/messages/remoteConnections";
import remoteMessages from "../i18n/messages/remoteMcp";
import { messages } from "./messages";
import type {
  FlowAction,
  FlowNode,
  SceneContext,
  UiFlow,
  UiTarget,
} from "./types";

export function remoteConnectionFlow(locale: Locale = "zh-CN"): UiFlow {
  const t = messages(connectionMessages, locale),
    f = messages(flowMessages, locale),
    u = messages(uiMessages, locale),
    r = messages(remoteMessages, locale);
  const button = (name: string): UiTarget => ({ role: "button", name }),
    selector = (value: string): UiTarget => ({ selector: value });
  const action = (
    id: string,
    title: string,
    target: UiTarget,
    to?: string,
  ): FlowAction => ({ id, title, target, to });
  const b = (id: string, title: string, to?: string) =>
    action(id, title, button(title), to);
  const providers = [
    { id: "lan", provider: "lan", name: t("lan") },
    { id: "tailnet", provider: "tailscale-private", name: t("tailnet") },
    { id: "funnel", provider: "tailscale", name: t("funnel") },
    { id: "quick", provider: "cloudflare-quick", name: t("quick") },
    { id: "domain", provider: "cloudflare", name: t("domain") },
  ] as const;
  const nodes: FlowNode[] = [];
  async function home({ ui }: SceneContext) {
    await ui.click(button(u("settings")));
    await ui.click(button(u("remote")));
    await ui.expect(selector('.remote-settings[data-remote-view="overview"]'));
  }
  const rootActions = providers.flatMap((p) => [
    b(`configure-${p.id}`, t("configure", { name: p.name }), `${p.id}.setup`),
    action(
      `power-${p.id}`,
      t("toggle", { name: p.name }),
      selector(`[data-connection="${p.provider}"] [role="switch"]`),
    ),
  ]);
  nodes.push({
    id: "modes",
    title: t("title"),
    screen: "overview",
    screenTitle: t("title"),
    scene: "overview",
    variants: ["modes", "multiple"],
    matches: [
      { target: selector('.remote-settings[data-remote-view="overview"]') },
    ],
    enter: home,
    actions: rootActions,
  });
  nodes.push({
    id: "multiple",
    title: f("multiple"),
    parent: "modes",
    screen: "overview",
    screenTitle: t("title"),
    scene: "overview",
    priority: 5,
    variants: ["modes", "multiple"],
    matches: [
      { target: selector('.remote-settings[data-remote-view="overview"]') },
    ],
    when: (state) =>
      ((state.connections as { enabled: boolean }[]) ?? []).filter(
        (value) => value.enabled,
      ).length > 1,
    enter: async (ctx) => {
      await ctx.event("connections.multiple");
      await home(ctx);
    },
    actions: rootActions,
  });
  for (const p of providers) {
    const id = (suffix: string) => `${p.id}.${suffix}`,
      root = `.remote-settings[data-remote-provider="${p.provider}"]`,
      panel = (tab: string) =>
        selector(
          `${root}[data-remote-tab="${tab}"] .rm-detail-body > .rm-tab-panel:not([hidden])`,
        );
    const open = async (ctx: SceneContext) => {
      await home(ctx);
      await ctx.ui.click(button(t("configure", { name: p.name })));
      await ctx.ui.expect(panel("network"));
    };
    const filled = async (ctx: SceneContext) => {
      await open(ctx);
      if (p.id === "domain") {
        await ctx.ui.fill(
          { role: "textbox", name: t("hostname") },
          "https://showai.example",
        );
        await ctx.ui.fill(
          { role: "textbox", name: t("tunnelToken") },
          "UI_LAB_DEMO_TOKEN",
        );
      }
    };
    const starting = async (ctx: SceneContext) => {
      await filled(ctx);
      await ctx.ui.click(button(t("start")));
      await ctx.ui.expect(selector(`${root} .rm-starting`));
    };
    const ready = async (ctx: SceneContext) => {
      await starting(ctx);
      await ctx.event("service.ready", { provider: p.provider });
      await ctx.ui.expect(panel("clients"));
    };
    const configActions = [
      ...(p.id === "lan"
        ? [
            action("address", t("address"), {
              role: "combobox" as const,
              name: t("address"),
            }),
            b("refresh", t("refresh")),
          ]
        : p.id === "domain"
          ? [
              action("hostname", t("hostname"), {
                role: "textbox" as const,
                name: t("hostname"),
              }),
              action("token", t("tunnelToken"), {
                role: "textbox" as const,
                name: t("tunnelToken"),
              }),
              b("route", t("generateRoute")),
            ]
          : p.id === "tailnet" || p.id === "funnel"
            ? [
                action("port", t("httpsPort"), {
                  role: "combobox" as const,
                  name: t("httpsPort"),
                }),
              ]
            : []),
      b("start", t("start"), id("starting")),
      action(
        "permissions",
        t("permissions"),
        { role: "tab", name: t("permissions") },
        id("permissions"),
      ),
      b("back", t("back"), "modes"),
    ];
    const variants = [id("setup"), id("starting"), id("error"), id("ready")];
    nodes.push({
      id: id("setup"),
      title: p.name,
      stateLabel: f("initial"),
      parent: "modes",
      screen: id("network"),
      screenTitle: p.name,
      scene: p.id,
      variants,
      variantLabels: { [id("ready")]: t("on") },
      matches: [
        { target: panel("network") },
        {
          target: selector(
            `${root}[data-remote-phase="stopped"],${root}[data-remote-phase="prepared"]`,
          ),
        },
      ],
      enter: open,
      actions: configActions,
    });
    nodes.push({
      id: id("starting"),
      title: t("starting"),
      parent: id("setup"),
      screen: id("network"),
      screenTitle: p.name,
      scene: p.id,
      variants,
      matches: [{ target: selector(`${root} .rm-starting`) }],
      enter: starting,
      actions: [b("cancel", t("cancel"), id("setup"))],
    });
    nodes.push({
      id: id("error"),
      title: t("failed"),
      parent: id("starting"),
      screen: id("network"),
      screenTitle: p.name,
      scene: p.id,
      variants,
      priority: 10,
      matches: [
        { target: panel("network") },
        { target: selector(`${root} .rm-error`) },
      ],
      enter: async (ctx) => {
        await starting(ctx);
        await ctx.event("service.error", { provider: p.provider });
        await ctx.ui.expect(selector(`${root} .rm-error`));
      },
      actions: [
        b("retry", t("reconnect"), id("starting")),
        b("diagnostics", t("diagnostics"), id("diagnostics")),
        b("back", t("back"), "modes"),
      ],
    });
    nodes.push({
      id: id("ready"),
      title: t("on"),
      parent: id("starting"),
      screen: id("network"),
      screenTitle: p.name,
      scene: p.id,
      variants,
      matches: [
        { target: panel("network") },
        { target: selector(`${root}[data-remote-phase="running"]`) },
      ],
      enter: async (ctx) => {
        await ready(ctx);
        await ctx.ui.click({ role: "tab", name: t("network") });
      },
      actions: [
        action(
          "copy",
          t("copy", { name: t("endpoint") }),
          selector(`${root} [data-copy-field="${t("endpoint")}"] button`),
        ),
        action(
          "clients",
          t("clients"),
          { role: "tab", name: t("clients") },
          id("client"),
        ),
        b("back", t("back"), "modes"),
      ],
    });
    nodes.push({
      id: id("diagnostics"),
      title: t("diagnostics"),
      parent: id("error"),
      screen: id("diagnostics"),
      screenTitle: p.name,
      scene: p.id,
      priority: 100,
      matches: [{ target: { role: "dialog", name: t("diagnostics") } }],
      when: (state) =>
        (state.config as { provider: string })?.provider === p.provider,
      enter: async (ctx) => {
        await starting(ctx);
        await ctx.event("service.error", { provider: p.provider });
        await ctx.ui.click(button(t("diagnostics")));
      },
      actions: [b("close", u("closeDialog"), id("error"))],
    });
    if (p.id === "lan")
      nodes.push({
        id: id("no-address"),
        title: f("noAddress"),
        parent: id("setup"),
        screen: id("network"),
        screenTitle: p.name,
        scene: p.id,
        priority: 5,
        variants: [id("setup"), id("no-address")],
        matches: [
          { target: panel("network") },
          { target: button(t("start")), state: "disabled" },
        ],
        when: (state) => !(state.addresses as unknown[])?.length,
        enter: async (ctx) => {
          await ctx.event("addresses.empty", { provider: p.provider });
          await open(ctx);
        },
        actions: configActions.filter((value) => value.id !== "start"),
      });
    const permissions = async (ctx: SceneContext) => {
      await open(ctx);
      await ctx.ui.click({ role: "tab", name: t("permissions") });
      await ctx.ui.expect(panel("permissions"));
    };
    const permissionsActions = [
      b("all", t("all")),
      b("selected", t("selected")),
      action(
        "read",
        t("setAccess", { name: u("research"), access: t("readOnly") }),
        button(t("setAccess", { name: u("research"), access: t("readOnly") })),
      ),
      action(
        "edit",
        t("setAccess", { name: u("project"), access: t("editable") }),
        button(t("setAccess", { name: u("project"), access: t("editable") })),
      ),
      b("save", t("save")),
      b("back", t("back"), "modes"),
    ];
    for (const selected of [false, true])
      nodes.push({
        id: id(selected ? "permissions.selected" : "permissions"),
        title: t(selected ? "selected" : "all"),
        parent: id("setup"),
        screen: id("permissions"),
        screenTitle: t("permissions"),
        scene: p.id,
        priority: selected ? 5 : 0,
        variants: [id("permissions"), id("permissions.selected")],
        matches: [
          { target: panel("permissions") },
          {
            target: selector(
              `${root} .rm-segmented > button[aria-pressed="true"]`,
            ),
          },
          ...(selected
            ? [{ target: selector(`${root} .rm-permission-table`) }]
            : [{ target: selector(`${root} .rm-permission-capabilities`) }]),
        ],
        enter: async (ctx) => {
          await permissions(ctx);
          if (selected) {
            await ctx.ui.click(button(t("selected")));
            await ctx.ui.click(
              button(
                t("setAccess", { name: u("research"), access: t("readOnly") }),
              ),
            );
            await ctx.ui.click(
              button(
                t("setAccess", { name: u("project"), access: t("editable") }),
              ),
            );
          }
        },
        actions: permissionsActions,
      });
    const publicNetwork = p.id !== "lan" && p.id !== "tailnet";
    const clientSetup = async (ctx: SceneContext, chatgpt = false) => {
      await ready(ctx);
      if (chatgpt) await ctx.ui.click(button("ChatGPT"));
    };
    nodes.push({
      id: id("client"),
      title: t("serverSetup"),
      parent: id("ready"),
      screen: id("client"),
      screenTitle: t("clients"),
      scene: p.id,
      matches: [
        { target: panel("clients") },
        {
          target: selector(
            `${root} [data-client-view="setup"][data-client-type="other"]`,
          ),
        },
      ],
      enter: (ctx) => clientSetup(ctx),
      actions: [
        action(
          "copy",
          t("copy", { name: t("endpoint") }),
          selector(`${root} [data-copy-field="${t("endpoint")}"] button`),
        ),
        ...(p.id === "lan"
          ? [
              action("name", t("name"), {
                role: "textbox" as const,
                name: t("name"),
              }),
              b("key", t("generateKey"), id("key")),
            ]
          : [b("next", t("nextMessage"), id("verify"))]),
        ...(publicNetwork ? [b("chatgpt", "ChatGPT", id("chatgpt"))] : []),
      ],
    });
    const withKey = async (ctx: SceneContext) => {
      await clientSetup(ctx);
      await ctx.ui.fill({ role: "textbox", name: t("name") }, u("client"));
      await ctx.ui.click(button(t("generateKey")));
      await ctx.ui.expect({ role: "textbox", name: t("key") });
    };
    if (p.id === "lan")
      nodes.push({
        id: id("key"),
        title: t("key"),
        parent: id("client"),
        screen: id("client"),
        screenTitle: t("clients"),
        scene: p.id,
        priority: 5,
        matches: [{ target: { role: "textbox", name: t("key") } }],
        enter: withKey,
        actions: [
          b("copy-key", t("copy", { name: t("key") })),
          b("show", t("showKey")),
          b("next", t("nextMessage"), id("verify")),
        ],
      });
    for (const chatgpt of publicNetwork ? [false, true] : [false]) {
      const suffix = chatgpt ? "chatgpt." : "";
      if (chatgpt)
        nodes.push({
          id: id("chatgpt"),
          title: "ChatGPT",
          parent: id("client"),
          screen: id("client"),
          screenTitle: t("clients"),
          scene: p.id,
          matches: [
            {
              target: selector(
                `${root} [data-client-view="setup"][data-client-type="chatgpt"]`,
              ),
            },
          ],
          enter: (ctx) => clientSetup(ctx, true),
          actions: [
            b("next", t("nextMessage"), id("chatgpt.verify")),
            b("advanced", t("oauthEndpoints")),
            b("export", t("exportChatgptPlugin"), id("plugin")),
          ],
        });
      const verify = async (ctx: SceneContext) => {
        if (p.id === "lan") await withKey(ctx);
        else await clientSetup(ctx, chatgpt);
        await ctx.ui.click(button(t("nextMessage")));
        await ctx.ui.expect(selector(`${root} [data-client-view="verify"]`));
      };
      const variants = [
        id(suffix + "verify"),
        ...(p.id !== "lan"
          ? [
              id(suffix + "approval"),
              id(suffix + "denied"),
              id(suffix + "authorized"),
            ]
          : []),
        id("connected"),
      ];
      for (const condition of p.id === "lan"
        ? (["verify"] as const)
        : (["verify", "authorized", "denied"] as const)) {
        nodes.push({
          id: id(suffix + condition),
          title:
            condition === "authorized"
              ? t("authorized")
              : condition === "denied"
                ? t("denied")
                : t("sendMessage"),
          parent: id(chatgpt ? "chatgpt" : "client"),
          screen: id(suffix + "verification"),
          screenTitle: t("sendMessage"),
          scene: p.id,
          variants,
          priority: condition === "verify" ? 0 : 10,
          matches: [
            {
              target: selector(
                `${root} [data-client-view="verify"][data-client-type="${chatgpt ? "chatgpt" : "other"}"]`,
              ),
            },
            ...(condition === "verify"
              ? []
              : [
                  {
                    target: {
                      name: t(condition === "denied" ? "denied" : "authorized"),
                    },
                  },
                ]),
          ],
          when: (state) =>
            condition === "verify"
              ? true
              : condition === "denied"
                ? (state.approval as { decision?: string })?.decision === "deny"
                : (state.approval as { decision?: string })?.decision ===
                  "allow",
          enter: async (ctx) => {
            await verify(ctx);
            if (condition !== "verify") {
              await ctx.event("authorization.request", {
                provider: p.provider,
              });
              await ctx.ui.click(
                button(
                  r(condition === "denied" ? "approvalDeny" : "approvalAllow"),
                ),
              );
              await ctx.ui.expect(
                { role: "dialog", name: r("approvalTitle") },
                "hidden",
              );
            }
          },
          actions: [
            action(
              "copy",
              t("copy", { name: t("testMessage") }),
              selector(
                `${root} [data-copy-field="${t("testMessage")}"] button`,
              ),
            ),
            action(
              "setup",
              t("serverSetup"),
              { role: "tab", name: t("serverSetup") },
              id(chatgpt ? "chatgpt" : "client"),
            ),
          ],
        });
      }
      if (p.id !== "lan")
        nodes.push({
          id: id(suffix + "approval"),
          title: f("review"),
          parent: id(suffix + "verify"),
          screen: id(suffix + "verification"),
          screenTitle: r("approvalTitle"),
          scene: p.id,
          priority: 100,
          variants,
          matches: [
            { target: { role: "dialog", name: r("approvalTitle") } },
            {
              target: selector(
                `${root} [data-client-view="verify"][data-client-type="${chatgpt ? "chatgpt" : "other"}"]`,
              ),
            },
          ],
          when: (state) =>
            ((state.requests as { provider: string }[]) ?? []).some(
              (request) => request.provider === p.provider,
            ),
          enter: async (ctx) => {
            await verify(ctx);
            await ctx.event("authorization.request", { provider: p.provider });
            await ctx.ui.expect({ role: "dialog", name: r("approvalTitle") });
          },
          actions: [
            b("allow", r("approvalAllow"), id(suffix + "authorized")),
            b("deny", r("approvalDeny"), id(suffix + "denied")),
          ],
        });
    }
    const connected = async (ctx: SceneContext) => {
      if (p.id === "lan") {
        await withKey(ctx);
        await ctx.ui.click(button(t("nextMessage")));
      } else {
        await clientSetup(ctx);
        await ctx.ui.click(button(t("nextMessage")));
        await ctx.event("authorization.request", { provider: p.provider });
        await ctx.ui.click(button(r("approvalAllow")));
      }
      await ctx.event("client.call", { provider: p.provider });
      await ctx.ui.expect(selector(`${root} [data-client-view="list"]`));
    };
    nodes.push({
      id: id("connected"),
      title: t("connected"),
      parent: id("client"),
      screen: id("client"),
      screenTitle: t("authorizedClients"),
      scene: p.id,
      matches: [{ target: selector(`${root} [data-client-view="list"]`) }],
      enter: connected,
      actions: [
        b("add", t("addClient"), id("client")),
        b(
          "revoke",
          t("revoke", {
            name: p.id === "lan" ? u("client") : "UI Lab MCP client",
          }),
        ),
      ],
    });
    if (publicNetwork)
      nodes.push({
        id: id("plugin"),
        title: t("export"),
        parent: id("chatgpt"),
        screen: id("plugin"),
        screenTitle: t("export"),
        scene: p.id,
        priority: 100,
        matches: [
          { target: { role: "dialog", name: t("export") } },
          { target: selector(root) },
        ],
        enter: async (ctx) => {
          await clientSetup(ctx, true);
          await ctx.ui.click(button(t("exportChatgptPlugin")));
        },
        actions: [
          action("link", t("binding"), { role: "textbox", name: t("binding") }),
          b("export", t("bindExport")),
          b("close", u("closeDialog")),
        ],
      });
  }
  return {
    feature: "remote-connection",
    title: t("title"),
    entry: "modes",
    nodes,
  };
}
