import remoteMessages from "../../i18n/messages/remoteMcp";
import labMessages from "../../i18n/messages/uiLab";
import type { Locale } from "../../i18n";
import { messages } from "../messages";
import type {
  SceneContext,
  UiFeature,
  UiScene,
  SceneStep,
  UiTarget,
} from "../types";

export function remoteConnectionFeature(locale: Locale): UiFeature {
  const r = messages(remoteMessages, locale),
    t = messages(labMessages, locale);
  const button = (name: string, within?: UiTarget): UiTarget => ({
    role: "button",
    name,
    within,
  });
  const heading = (name: string): UiTarget => ({ role: "heading", name });
  const dialog = (name: string): UiTarget => ({ role: "dialog", name });
  const prepare = async ({ ui }: SceneContext) => {
    await ui.click(button(t("settings")));
    await ui.click(button(t("remote")));
    await ui.expect(button(r("lan")));
  };
  const step = (
    id: string,
    title: string,
    run: SceneStep["run"],
    capture?: UiTarget,
  ): SceneStep => ({ id, title, run, capture });
  const scene = (
    id: string,
    key: Parameters<typeof t>[0],
    steps: SceneStep[],
  ): UiScene => ({
    id,
    title: t(key),
    description: t("fixtureDescription"),
    fixture: "remote-connection",
    prepare,
    steps,
    layout: { dialogPadding: 16, primaryContrast: 4.5 },
  });
  const start = (provider: "tailnet" | "quick" | "funnel"): SceneStep =>
    step("starting", t("starting"), async ({ ui }) => {
      if (provider === "tailnet") await ui.click(button(r("tailscalePrivate")));
      else {
        await ui.click(button(r("publicNetwork")));
        await ui.click(
          button(
            provider === "quick"
              ? `${r("quick")} ${r("quickHint")}`
              : `${r("tailscalePublic")} ${r("tailscalePublicHint")}`,
          ),
        );
      }
      await ui.click(
        button(provider === "quick" ? r("connect") : r("tailscaleCheck")),
      );
      await ui.expect(button(r("cancel")));
    });
  const ready = step("service-ready", t("configure"), async ({ ui, event }) => {
    await event("service.ready");
    await ui.expect(heading(r("connected")));
  });
  const authorize = step(
    "authorization",
    t("review"),
    async ({ ui, event }) => {
      await event("authorization.request");
      await ui.expect(dialog(r("approvalTitle")));
    },
    dialog(r("approvalTitle")),
  );
  const allow = step("allow", t("authorize"), async (ctx) => {
    await ctx.ui.click(button(r("approvalAllow"), dialog(r("approvalTitle"))));
    await ctx.ui.expect(dialog(r("approvalTitle")), "hidden");
    const state = await ctx.inspect();
    ctx.assert(
      (state.clients as unknown[]).length === 1,
      "Approval must create exactly one client",
    );
  });
  const complete = step("verified", t("complete"), async ({ ui, event }) => {
    await event("client.call");
    await ui.expect(heading(r("verified")));
  });
  const oauthClient = step("client", t("configure"), async ({ ui }) => {
    await ui.expect(heading(r("addServer")));
    await ui.click(button(r("addedOther")));
    await ui.expect(heading(r("verifyConnection")));
  });
  return {
    id: "remote-connection",
    title: t("remote"),
    events: [
      { name: "service.ready", title: t("serviceReady") },
      { name: "service.error", title: t("serviceError") },
      { name: "authorization.request", title: t("authRequest") },
      { name: "client.call", title: t("clientCall") },
    ],
    scenes: [
      scene("overview", "overview", [
        step("modes", t("choose"), async ({ ui }) => {
          await ui.expect(button(r("lan")));
          await ui.expect(button(r("tailscalePrivate")));
          await ui.expect(button(r("publicNetwork")));
        }),
      ]),
      scene("lan", "lan", [
        step("address", t("choose"), async ({ ui }) => {
          await ui.click(button(r("lan")));
          await ui.expect({ role: "combobox", name: r("networkAddress") });
        }),
        step("starting", t("starting"), async ({ ui }) => {
          await ui.click(button(r("startLan")));
          await ui.expect(button(r("cancel")));
        }),
        ready,
        step("key", t("key"), async (ctx) => {
          await ctx.ui.fill(
            { role: "textbox", name: r("clientName") },
            t("client"),
          );
          await ctx.ui.click(button(r("createAccessKey")));
          await ctx.ui.expect(button(r("addedKey")));
          const state = await ctx.inspect();
          ctx.assert(
            (state.clients as unknown[]).length === 1,
            "A key must register its client",
          );
        }),
        step("verify", t("verify"), async ({ ui }) => {
          await ui.click(button(r("addedKey")));
          await ui.expect(heading(r("verifyConnection")));
        }),
        complete,
        step("revoke", t("revoke"), async (ctx) => {
          await ctx.ui.click(button(r("revoke")));
          await ctx.ui.expect(button(r("revoke")), "hidden");
          const state = await ctx.inspect();
          ctx.assert(
            (state.clients as unknown[]).length === 0,
            "Revoked client must be removed",
          );
        }),
      ]),
      scene("tailnet", "tailnet", [
        start("tailnet"),
        ready,
        oauthClient,
        authorize,
        allow,
        complete,
      ]),
      scene("quick", "quick", [
        start("quick"),
        ready,
        step("client-choice", t("configure"), async ({ ui }) => {
          await ui.expect(heading(r("clientChoice")));
          await ui.expect(
            button(`${r("otherClient")} ${r("otherClientHint")}`),
          );
        }),
      ]),
      scene("domain", "domain", [
        step("route", t("route"), async ({ ui }) => {
          await ui.click(button(r("publicNetwork")));
          await ui.click(button(`${r("domain")} ${r("domainHint")}`));
          await ui.click(button(r("copyRoute")));
          await ui.expect(button(r("routeDone")));
        }),
        step("form", t("form"), async ({ ui }) => {
          await ui.click(button(r("routeDone")));
          await ui.fill(
            { role: "textbox", name: r("publicUrl") },
            "https://showai.example",
          );
          await ui.fill(
            { role: "textbox", name: r("token") },
            "UI_LAB_DEMO_TOKEN",
          );
        }),
        step("starting", t("starting"), async ({ ui }) => {
          await ui.click(button(r("connect")));
          await ui.expect(button(r("cancel")));
        }),
        ready,
      ]),
      scene("funnel", "funnel", [start("funnel"), ready]),
      scene("chatgpt", "chatgpt", [
        start("funnel"),
        ready,
        step("server", t("form"), async ({ ui }) => {
          await ui.click(button(`ChatGPT ${r("chatgptHint")}`));
          await ui.expect(heading(r("chatgptServerTitle")));
        }),
        step("oauth", t("oauth"), async ({ ui }) => {
          await ui.click(button(r("next")));
          await ui.expect(heading(r("chatgptOAuthTitle")));
        }),
        step("create", t("create"), async ({ ui }) => {
          await ui.click(button(r("next")));
          await ui.expect(heading(r("chatgptConnectTitle")));
        }),
        step("verify", t("verify"), async ({ ui }) => {
          await ui.click(button(r("authPageReady")));
          await ui.expect(heading(r("verifyConnection")));
        }),
        authorize,
        allow,
        complete,
        step(
          "plugin",
          t("import"),
          async ({ ui }) => {
            await ui.click(button(r("addClient")));
            await ui.click(button(`ChatGPT ${r("chatgptHint")}`));
            await ui.click({ selector: "summary", name: r("optionalSkills") });
            await ui.click(button(r("exportPlugin")));
            await ui.expect(dialog(r("bindPluginTitle")));
          },
          dialog(r("bindPluginTitle")),
        ),
      ]),
      scene("permissions", "permissions", [
        step(
          "all",
          t("permissions"),
          async ({ ui }) => {
            await ui.click(button(r("accessRules")));
            await ui.expect(dialog(r("accessRules")));
          },
          dialog(r("accessRules")),
        ),
        step(
          "selected",
          t("save"),
          async ({ ui }) => {
            await ui.select(
              { role: "combobox", name: r("accessRange") },
              "selected",
            );
            await ui.select(
              {
                role: "combobox",
                name: r("permission", { name: t("research") }),
              },
              "read",
            );
            await ui.select(
              {
                role: "combobox",
                name: r("permission", { name: t("project") }),
              },
              "write",
            );
          },
          dialog(r("accessRules")),
        ),
        step("saved", t("save"), async (ctx) => {
          await ctx.ui.click(button(r("save"), dialog(r("accessRules"))));
          await ctx.ui.expect(dialog(r("accessRules")), "hidden");
          await ctx.ui.click(button(r("lan")));
          await ctx.ui.click(button(r("startLan")));
          const state = await ctx.inspect();
          ctx.assert(
            (state.config as { access: string }).access === "selected",
            "Selected permissions must reach the service",
          );
        }),
      ]),
      scene("recovery", "recovery", [
        start("tailnet"),
        step("error", t("failure"), async ({ ui, event }) => {
          await event("service.error");
          await ui.expect(button(r("details")));
        }),
        step(
          "diagnostics",
          t("diagnostics"),
          async ({ ui }) => {
            await ui.click(button(r("details")));
            await ui.expect(dialog(r("details")));
          },
          dialog(r("details")),
        ),
        step("retry", t("starting"), async ({ ui }) => {
          await ui.click({
            role: "button",
            name: t("closeDialog"),
            within: dialog(r("details")),
          });
          await ui.click(button(r("tailscaleCheck")));
          await ui.expect(button(r("cancel")));
        }),
        ready,
      ]),
      scene("deny", "denied", [
        start("tailnet"),
        ready,
        oauthClient,
        authorize,
        step("denied", t("denied"), async (ctx) => {
          await ctx.ui.click(
            button(r("approvalDeny"), dialog(r("approvalTitle"))),
          );
          await ctx.ui.expect(dialog(r("approvalTitle")), "hidden");
          const state = await ctx.inspect();
          ctx.assert(
            (state.clients as unknown[]).length === 0,
            "Deny must not authorize a client",
          );
          let rejected = false;
          try {
            await ctx.event("client.call");
          } catch {
            rejected = true;
          }
          ctx.assert(rejected, "Calls without authorization must fail");
        }),
      ]),
    ],
  };
}
