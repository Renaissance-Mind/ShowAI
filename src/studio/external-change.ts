import type { ChangeAuthor } from "../core/external-changes";
import { translator } from "../i18n";
import pageSessionMessages from "../i18n/messages/pageSession";

const t = translator(pageSessionMessages);

/** Product names for the harnesses and MCP clients ShowAI ships plugins for. */
const KNOWN: [RegExp, string][] = [
  [/^codex\b/i, "Codex"],
  [/^claude(?:[-\s]?code)?\b/i, "Claude Code"],
  [/^kimi\b/i, "Kimi"],
];
export function writerName(raw: string): string {
  for (const [pattern, name] of KNOWN) if (pattern.test(raw.trim())) return name;
  return raw.trim();
}

/** The name shown in 「<名称> 刚更新了这个页面」 and in conflict messages. */
export function authorName(author: ChangeAuthor | undefined): string {
  if (!author) return t("author.otherTool");
  const named = author.label ?? author.harness;
  // A person's label is the synced account name of another device.
  if (named) return writerName(named);
  if (author.kind === "human")
    return author.channel === "cli" ? t("author.cli") : t("author.otherWindow");
  if (author.kind === "agent" || author.channel === "mcp")
    return t("author.agent");
  if (author.channel === "cli") return t("author.cli");
  return t("author.otherTool");
}
