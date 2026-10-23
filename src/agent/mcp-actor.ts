import type { ChangeContext } from "../core/history-model";

/**
 * A stdio MCP connection without real Agent attribution (no --harness and
 * --session, no CODEX_THREAD_ID) still knows which client it serves from
 * `initialize`. Its writes are attributed to that client as an external
 * actor, so the workbench can name the writer. Real Agent attribution wins.
 */
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
  // History labels reject markup and line breaks.
  const label = raw.replace(/[<>\r\n\x00]/g, " ").trim().slice(0, 100);
  return label ? { ...context, actor: { kind: "external", label } } : context;
}
