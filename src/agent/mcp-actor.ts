import type { ChangeContext } from "../core/history-model";

export function mcpChangeContext(
  inherited: ChangeContext,
  client: { name?: unknown; title?: unknown } | undefined,
): ChangeContext {
  const context: ChangeContext = { ...inherited, channel: "mcp" };
  if (inherited.actor.kind !== "unknown") return context;
  const raw =
    typeof client?.title === "string" && client.title.trim()
      ? client.title
      : client?.name;
  if (typeof raw !== "string") return context;
  const label = raw.replace(/[<>\r\n\x00]/g, " ").trim().slice(0, 100);
  return label ? { ...context, actor: { kind: "external", label } } : context;
}
