import type { Page } from "playwright-core";

type CardToolCall = { name: string; arguments: Record<string, unknown>; _meta?: Record<string, unknown> };

export async function mountWorkbenchCards(
  page: Page,
  html: string,
  metadata: Record<string, unknown>,
  capabilities: Record<string, unknown>,
  hostName = "card-test",
  relay?: (params: CardToolCall) => Promise<unknown>,
) {
  await page.setContent('<iframe style="display:block;width:100%;height:650px;border:0"></iframe><output hidden></output>');
  if (relay) await page.exposeFunction("relayCardTool", relay);
  await page.evaluate(({ html, metadata, capabilities, hostName }) => {
    const frame = document.querySelector("iframe")!;
    const send = (message: object) => frame.contentWindow!.postMessage({ jsonrpc: "2.0", ...message }, "*");
    const relay = (window as unknown as { relayCardTool?: (params: CardToolCall) => Promise<unknown> }).relayCardTool;
    window.addEventListener("message", async ({ source, data }) => {
      if (source !== frame.contentWindow || data?.jsonrpc !== "2.0") return;
      if (data.method === "ui/initialize") send({ id: data.id, result: {
        protocolVersion: data.params.protocolVersion, hostInfo: { name: hostName, version: "1" },
        hostCapabilities: capabilities, hostContext: { displayMode: "inline", locale: "zh-CN" },
      } });
      if (data.method === "ui/notifications/initialized") send({ method: "ui/notifications/tool-result", params: { _meta: metadata } });
      if (data.method === "tools/call") {
        document.querySelector("output")!.value = JSON.stringify(data.params);
        if (relay) send({ id: data.id, result: await relay(data.params) });
      }
    });
    frame.srcdoc = html;
  }, { html, metadata, capabilities, hostName });
  const list = page.frameLocator("iframe").locator("#showai-page-card");
  await list.waitFor({ timeout: 5000 });
  return list;
}
