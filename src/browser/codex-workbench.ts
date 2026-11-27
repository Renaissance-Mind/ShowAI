import type { AgentComponentContext } from "../agent-host/types";
import type { CodexPageTarget } from "../agent/codex-page-reference";
import type { PageReference } from "../core/page-reference";
import type { DesktopResponse } from "../host/protocol";
import type { WorkbenchChanges, WorkbenchRoute } from "../host/codex-workbench-transport";
import { translator } from "../i18n";
import messages from "../i18n/messages/codex-workbench";

export interface CodexWorkbenchConnection {
  key: string;
  instance: string;
  mode: "global" | "thread";
  remote?: boolean;
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
      openWorkbench?(projectId: string, pageId: string): Promise<unknown>;
      openPageTab?(target: CodexPageTarget): Promise<void>;
      ready(): void;
      canReference(): boolean;
      updatePage?(projectId: string | null, pageId?: string): void;
      createWorker?(kind: "source" | "cubic"): Worker;
      workbenchRequest?(route: WorkbenchRoute, args: Record<string, unknown>, client: string): Promise<DesktopResponse<unknown>>;
      workbenchChanges?(after: number, client: string): Promise<WorkbenchChanges>;
      readMedia?(grant: string): Promise<Blob>;
    };
    __SHOWAI_ANTIGRAVITY_HOST__?: {
      global?: boolean;
      attachReference(
        reference?: PageReference,
        text?: string,
        components?: AgentComponentContext[],
      ): Promise<unknown>;
      openLink?(url: string): Promise<unknown>;
      canReference(): boolean;
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

export function antigravityWorkbench() {
  return window.__SHOWAI_ANTIGRAVITY_HOST__;
}

/** The host already owns the surrounding page tabs in its conversation pane. */
export function isSinglePageWorkbench() {
  if (typeof window === "undefined") return false;
  const antigravity = antigravityWorkbench();
  return codexWorkbench()?.mode === "thread" ||
    window.__SHOWAI_LOCAL__?.t3Page === true ||
    window.__SHOWAI_LOCAL__?.dshWorkbench?.session === true ||
    (!!antigravity && !antigravity.global);
}

export function antigravityWorkbenchCanReference() {
  return window.__SHOWAI_ANTIGRAVITY_HOST__?.canReference() === true;
}

export function sendAntigravityWorkbenchReference(
  reference?: PageReference,
  text?: string,
  components?: AgentComponentContext[],
) {
  const host = window.__SHOWAI_ANTIGRAVITY_HOST__;
  if (!host) throw new Error(t("antigravityUnavailable"));
  return host.attachReference(reference, text, components);
}

export function reportCodexWorkbenchReady() {
  window.__SHOWAI_CODEX_HOST__?.ready();
}

export function rememberCodexWorkbenchPage(projectId: string | null, pageId?: string) {
  window.__SHOWAI_CODEX_HOST__?.updatePage?.(projectId, pageId);
}

export function codexWorkbenchPageOpener() {
  return window.__SHOWAI_CODEX_HOST__?.openWorkbench;
}

export function openT3PageTab(projectId: string, pageId: string, blockIds: string[] = []) {
  const host = window.__SHOWAI_LOCAL__;
  if (!host?.t3Page && !host?.t3Workbench) return false;
  const current = new URL(location.href);
  if (host.t3Page && current.searchParams.get("project") === projectId &&
    current.searchParams.get("page") === pageId) return false;
  const url = new URL("/", current);
  url.search = new URLSearchParams({ project: projectId, page: pageId, t3Page: "1" }).toString();
  if (blockIds.length) url.searchParams.set("blocks", blockIds.join(","));
  window.open(url.href, "_blank");
  return true;
}

export async function openCodexPageTab(target: CodexPageTarget) {
  const open = window.__SHOWAI_CODEX_HOST__?.openPageTab;
  if (!open) throw new Error(t("cannotOpenPageTab"));
  await open(target);
  return true;
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
