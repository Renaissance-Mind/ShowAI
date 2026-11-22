import { createHmac, randomUUID } from "node:crypto";
import type { CodexPageTarget } from "./codex-page-reference";

type Pending = {
  id: string;
  target: CodexPageTarget;
  sent: boolean;
  finish: (status: "accepted" | "superseded" | "unavailable") => void;
};
type PageIdentity = Pick<CodexPageTarget, "projectId" | "pageId">;
type PanelReport = { visible: boolean; page?: PageIdentity; acknowledged?: string };
type Panel = { scope: string; page?: PageIdentity; seen: number; pending?: Pending };

const samePage = (left: PageIdentity | undefined, right: PageIdentity) =>
  left?.projectId === right.projectId && left.pageId === right.pageId;

export class CodexWorkbenchNavigation {
  private readonly panels = new Map<string, Panel>();
  constructor(private readonly key: string, private readonly reuseSidePanel = false) {}

  scope(meta: Record<string, unknown> | undefined) {
    const context = meta?.["com.qoder/turnContext"];
    const qoderSession = context && typeof context === "object" && "sessionId" in context ? context.sessionId : undefined;
    const thread = meta?.threadId ?? meta?.["openai/session"] ?? qoderSession;
    if (typeof thread === "string" && thread.length)
      return createHmac("sha256", this.key).update(thread).digest("hex");
  }

  poll(scope: string, client: string, { visible, page, acknowledged }: PanelReport) {
    const now = Date.now();
    for (const [id, panel] of this.panels) {
      if (now - panel.seen > 5000) {
        panel.pending?.finish("unavailable");
        this.panels.delete(id);
      }
    }
    const id = `${scope}:${client}`;
    let panel = this.panels.get(id);
    if (!visible || (!page && !this.reuseSidePanel)) {
      panel?.pending?.finish("unavailable");
      this.panels.delete(id);
      return;
    }
    if (!panel || (!this.reuseSidePanel && page && !samePage(panel.page, page))) {
      panel?.pending?.finish("unavailable");
      panel = { scope, page, seen: now };
      this.panels.set(id, panel);
    }
    panel.page = page;
    panel.seen = now;
    const pending = panel.pending;
    if (!pending) return;
    if (pending.sent && pending.id === acknowledged) {
      pending.finish("accepted");
    } else if (!pending.sent) {
      pending.sent = true;
      return { id: pending.id, target: pending.target };
    }
  }

  async navigate(scope: string | undefined, target: CodexPageTarget) {
    const cutoff = Date.now() - 5000;
    let panel: Panel | undefined;
    for (const candidate of this.panels.values()) {
      if (candidate.scope !== scope || candidate.seen < cutoff) continue;
      if (!this.reuseSidePanel && !samePage(candidate.page, target)) continue;
      if (!panel || candidate.seen > panel.seen) panel = candidate;
    }
    if (!panel) return "unavailable";
    const selected = panel;
    panel.pending?.finish("superseded");
    return new Promise<"accepted" | "superseded" | "unavailable">((resolve) => {
      const timer = setTimeout(() => finish("unavailable"), 3500);
      const finish: Pending["finish"] = (status) => {
        clearTimeout(timer);
        selected.pending = undefined;
        resolve(status);
      };
      selected.pending = { id: randomUUID(), target, sent: false, finish };
    });
  }
}
