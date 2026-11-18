import type { AgentComponentContext } from "../agent-host/types";
import type { PageReference } from "../core/page-reference";
import { translator } from "../i18n";
import messages from "../i18n/messages/codex-workbench";

export interface CodexWorkbenchConnection {
  key: string;
  instance: string;
  mode: "global" | "thread";
}

declare global {
  interface Window {
    __SHOWAI_CODEX_HOST__?: {
      attachReference(
        reference?: PageReference,
        text?: string,
        components?: AgentComponentContext[],
      ): Promise<unknown>;
      openLink(url: string): Promise<unknown>;
      ready(): void;
      canReference(): boolean;
      updatePage?(projectId: string, pageId: string): void;
      createWorker?(kind: "source" | "cubic"): Worker;
    };
  }
}

const t = translator(messages);

export function codexWorkbench() {
  return window.__SHOWAI_CODEX_HOST__ && window.__SHOWAI_LOCAL__?.codexWorkbench;
}

export function codexWorkbenchCanReference() {
  return window.__SHOWAI_CODEX_HOST__?.canReference() === true;
}

export function reportCodexWorkbenchReady() {
  window.__SHOWAI_CODEX_HOST__?.ready();
}

export function rememberCodexWorkbenchPage(projectId: string | null, pageId?: string) {
  if (projectId && pageId) window.__SHOWAI_CODEX_HOST__?.updatePage?.(projectId, pageId);
}

export function sendCodexWorkbenchReference(
  reference?: PageReference,
  text?: string,
  components?: AgentComponentContext[],
) {
  const host = window.__SHOWAI_CODEX_HOST__;
  if (!host) throw new Error(t("unavailable"));
  return host.attachReference(reference, text, components);
}

export function openCodexWorkbenchLink(url: string) {
  const host = window.__SHOWAI_CODEX_HOST__;
  if (!host) throw new Error(t("unavailable"));
  return host.openLink(browserUrl(url));
}

export function browserUrl(path: string) {
  return new URL(path, window.__SHOWAI_LOCAL__?.apiOrigin ?? location.href).href;
}

export function browserSearch() {
  return new URLSearchParams(window.__SHOWAI_LOCAL__?.search ?? location.search);
}
