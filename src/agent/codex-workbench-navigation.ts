import { createHmac, randomUUID } from "node:crypto";
import type { CodexPageTarget } from "./codex-page-reference";

type Pending = {
  id: string;
  target: CodexPageTarget;
  sent: boolean;
  finish: (status: "accepted" | "superseded" | "unavailable") => void;
};
type Panel = { client: string; seen: number; pending?: Pending };

export class CodexWorkbenchNavigation {
  private readonly panels = new Map<string, Panel>();
  constructor(private readonly key: string) {}

  scope(meta: Record<string, unknown> | undefined) {
    const thread = meta?.threadId ?? meta?.["openai/session"];
    if (typeof thread === "string" && thread.length)
      return createHmac("sha256", this.key).update(thread).digest("hex");
  }

  poll(scope: string, client: string, visible: boolean, acknowledged?: string) {
    const now = Date.now();
    for (const [id, panel] of this.panels) {
      if (now - panel.seen > 5000) {
        panel.pending?.finish("unavailable");
        this.panels.delete(id);
      }
    }
    let panel = this.panels.get(scope);
    if (!visible) {
      if (panel?.client === client) {
        panel.pending?.finish("unavailable");
        this.panels.delete(scope);
      }
      return;
    }
    if (panel?.client !== client) {
      if (panel?.pending) return;
      panel = { client, seen: now };
      this.panels.set(scope, panel);
    }
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
    const panel = scope && this.panels.get(scope);
    if (!panel || Date.now() - panel.seen > 5000) return "unavailable";
    panel.pending?.finish("superseded");
    return new Promise<"accepted" | "superseded" | "unavailable">((resolve) => {
      const timer = setTimeout(() => finish("unavailable"), 3500);
      const finish: Pending["finish"] = (status) => {
        clearTimeout(timer);
        panel.pending = undefined;
        resolve(status);
      };
      panel.pending = { id: randomUUID(), target, sent: false, finish };
    });
  }
}
