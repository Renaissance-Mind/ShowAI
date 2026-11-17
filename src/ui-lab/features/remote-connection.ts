import type { Locale } from "../../i18n";
import labMessages from "../../i18n/messages/uiLab";
import { messages } from "../messages";
import { remoteConnectionFlow } from "../remote-flow";
import type { UiFeature } from "../types";
export function remoteConnectionFeature(locale: Locale): UiFeature {
  const t = messages(labMessages, locale),
    flow = remoteConnectionFlow(locale);
  const cases = [
    ["overview", "modes", "overview"],
    ["lan", "lan.connected", "lan"],
    ["tailnet", "tailnet.connected", "tailnet"],
    ["quick", "quick.connected", "quick"],
    ["domain", "domain.connected", "domain"],
    ["funnel", "funnel.connected", "funnel"],
    ["chatgpt", "funnel.chatgpt.authorized", "chatgpt"],
    ["permissions", "lan.permissions.selected", "permissions"],
    ["recovery", "tailnet.error", "recovery"],
    ["deny", "tailnet.denied", "denied"],
  ] as const;
  return {
    id: flow.feature,
    title: flow.title,
    scenes: cases.map(([id, nodeId, title]) => {
      const node = flow.nodes.find((node) => node.id === nodeId)!;
      return {
        id,
        title: t(title),
        description: t("fixtureDescription"),
        fixture: "remote-connection",
        prepare: node.enter,
        layout: { dialogPadding: 16, primaryContrast: 4.5 },
        steps: [
          {
            id: "result",
            title: node.title,
            run: async (ctx) => {
              for (const match of node.matches)
                await ctx.ui.expect(match.target, match.state);
              if (node.when)
                ctx.assert(
                  node.when(await ctx.inspect()),
                  "The requested connection state must be active.",
                );
            },
          },
        ],
      };
    }),
  };
}
