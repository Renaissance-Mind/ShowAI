import { translator } from "../i18n";
import messages from "../i18n/messages/codex-workbench";

const t = translator(messages);

export function dshWorkbenchCanReference() {
  return window.__SHOWAI_LOCAL__?.dshWorkbench?.session === true && window.parent !== window;
}

export function sendDshWorkbenchReference(text: string) {
  const host = window.__SHOWAI_LOCAL__?.dshWorkbench;
  if (!host?.session || window.parent === window) throw new Error(t("dshReferenceFailed"));
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      if (ok) resolve();
      else reject(new Error(t("dshReferenceFailed")));
    };
    const timer = setTimeout(() => finish(false), 5000);
    channel.port1.onmessage = event => finish(event.data?.ok === true);
    window.parent.postMessage({ type: "showai:reference", text }, host.parentOrigin, [channel.port2]);
  });
}
