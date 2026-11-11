import type { AgentConversation } from "../../agent-host/types";

export interface ConversationMarkdownLabels {
  user: string;
  agent: string;
  /** Formats a turn's start time, e.g. with the person's locale. */
  time: (iso: string) => string;
}

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

/**
 * One conversation as Markdown: the title, then each request with what it
 * pointed at and the Agent's reply. Tool steps stay out; they are the Agent's
 * working notes, not part of the exchange.
 */
export function conversationMarkdown(
  conversation: Pick<AgentConversation, "title" | "turns">,
  labels: ConversationMarkdownLabels,
) {
  const sections = [`# ${conversation.title.replace(/\s+/g, " ").trim()}`];
  for (const turn of conversation.turns) {
    const request = [
      `## ${labels.user} · ${labels.time(turn.startedAt)}`,
      turn.prompt.trim(),
    ];
    if (turn.target.text) request.push(quote(turn.target.text));
    sections.push(request.join("\n\n"));
    const reply = turn.events
      .filter((event) => event.type === "message" && event.text.trim())
      .map((event) => event.text.trim());
    if (!reply.length && turn.error) reply.push(quote(turn.error));
    if (reply.length) sections.push([`## ${labels.agent}`, ...reply].join("\n\n"));
  }
  return sections.join("\n\n") + "\n";
}
