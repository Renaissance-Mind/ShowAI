import type { ChangeAuthor } from "../core/external-changes";
import { translator } from "../i18n";
import pageSessionMessages from "../i18n/messages/pageSession";

const t = translator(pageSessionMessages);

const KNOWN: [RegExp, string][] = [
  [/^codex\b/i, "Codex"],
  [/^claude(?:[-\s]?code)?\b/i, "Claude Code"],
  [/^kimi\b/i, "Kimi"],
];
export function writerName(raw: string): string {
  for (const [pattern, name] of KNOWN) if (pattern.test(raw.trim())) return name;
  return raw.trim();
}

export function authorName(author: ChangeAuthor | undefined): string {
  if (!author) return t("author.otherTool");
  const named = author.label ?? author.harness;
  if (named) return writerName(named);
  if (author.kind === "human")
    return author.channel === "cli" ? t("author.cli") : t("author.otherWindow");
  if (author.kind === "agent" || author.channel === "mcp")
    return t("author.agent");
  if (author.channel === "cli") return t("author.cli");
  return t("author.otherTool");
}
