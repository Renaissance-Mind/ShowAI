import { expect, test } from "vitest";
import { conversationMarkdown } from "./conversation-markdown";
import type { AgentConversation, AgentTurn } from "../../agent-host/types";

const turn = (value: Partial<AgentTurn>) =>
  ({
    target: { kind: "page" },
    events: [],
    state: "completed",
    startedAt: "2026-11-11T09:00:00.000Z",
    ...value,
  }) as AgentTurn;

const labels = {
  user: "You",
  agent: "Codex",
  time: (iso: string) => iso.slice(0, 16).replace("T", " "),
};

test("a conversation exports as headed requests and replies", () => {
  const conversation = {
    title: "Budget\n review",
    turns: [
      turn({
        prompt: "Shorten this\n",
        target: { kind: "text", text: "Line one\n\nLine two" },
        events: [
          { sequence: 1, type: "message", text: "Here is a shorter version." },
          { sequence: 2, type: "tool", text: "showai · page_apply" },
          { sequence: 3, type: "message", text: "Done." },
        ],
      }),
      turn({
        prompt: "Again",
        startedAt: "2026-11-11T09:05:00.000Z",
        state: "failed",
        error: "The Agent stopped.\nTry again.",
      }),
      turn({
        prompt: "Still running",
        startedAt: "2026-11-11T09:06:00.000Z",
        state: "running",
      }),
    ],
  } as Pick<AgentConversation, "title" | "turns">;
  expect(conversationMarkdown(conversation, labels)).toBe(
    [
      "# Budget review",
      "## You · 2026-11-11 09:00",
      "Shorten this",
      "> Line one\n>\n> Line two",
      "## Codex",
      "Here is a shorter version.",
      "Done.",
      "## You · 2026-11-11 09:05",
      "Again",
      "## Codex",
      "> The Agent stopped.\n> Try again.",
      "## You · 2026-11-11 09:06",
      "Still running",
    ].join("\n\n") + "\n",
  );
});
