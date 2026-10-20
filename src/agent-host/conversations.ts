import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertId } from "../core/store";
import { readOptional, writeProtected } from "./storage";
import type {
  AgentConversation,
  AgentConversationSummary,
  AgentTarget,
  AgentTurn,
} from "./types";
import type { ShowDocument } from "../types";
import { referenceInstructions } from "../surface/agent-reference";
import {
  componentContextIssue,
  componentContextLimits,
} from "../components/custom/component-context.mjs";
import { translator } from "../i18n";
import agentHostMessages from "../i18n/messages/agentHost";

const t = translator(agentHostMessages);

const blockId = z
  .string()
  .regex(/^[\w-]+$/)
  .max(200);
export const targetSchema = z.object({
  kind: z.enum(["page", "text", "blocks", "board"]),
  pageId: z.string().optional(),
  surfaceId: blockId.optional(),
  blockIds: z.array(blockId).max(100).optional(),
  text: z.string().max(20000).optional(),
  reference: z
    .object({
      surfaceId: blockId,
      kind: z.enum(["point", "region"]),
      x: z.number().finite().min(-1000000).max(1000000),
      y: z.number().finite().min(-1000000).max(1000000),
      width: z.number().finite().min(0).max(2000000).optional(),
      height: z.number().finite().min(0).max(2000000).optional(),
    })
    .optional(),
  components: z
    .array(
      z
        .object({
          blockId,
          componentId: z.string().min(1).max(200).optional(),
          name: z.string().min(1).max(200),
          label: z
            .string()
            .min(1)
            .max(componentContextLimits.labelChars)
            .optional(),
          model: z.unknown(),
        })
        .superRefine((item, context) => {
          const issue = componentContextIssue({
            model: item.model,
            ...(item.label ? { label: item.label } : {}),
          });
          if (issue) context.addIssue({ code: "custom", message: issue });
        }),
    )
    .max(componentContextLimits.perMessage)
    .optional(),
});

export function parseTarget(value: unknown): AgentTarget {
  const target = targetSchema.parse(value ?? { kind: "page" });
  if (target.pageId) assertId(target.pageId);
  const blockIds = [...new Set(target.blockIds ?? [])];
  return {
    kind: target.kind,
    ...(target.pageId ? { pageId: target.pageId } : {}),
    ...(target.surfaceId ? { surfaceId: target.surfaceId } : {}),
    ...(blockIds.length ? { blockIds } : {}),
    ...(target.text?.trim() ? { text: target.text.slice(0, 4000) } : {}),
    ...(target.reference ? { reference: target.reference } : {}),
    ...(target.components?.length
      ? {
          components: target.components.map((item) => ({
            blockId: item.blockId,
            ...(item.componentId ? { componentId: item.componentId } : {}),
            name: item.name,
            ...(item.label ? { label: item.label } : {}),
            model: item.model,
          })),
        }
      : {}),
  };
}

/** Component state the person handed over; it describes the live view only. */
export function componentInstructions(components?: AgentTarget["components"]) {
  if (!components?.length) return "";
  return (
    "\nThe person handed over the current exploration state of these components. It is local to their view, not saved to the page; use it to understand the request and do not write it into component data unless asked:\n" +
    components
      .map(
        (item) =>
          `- block ${item.blockId} (${JSON.stringify(item.name)}${item.componentId ? `, ${item.componentId}` : ""})${item.label ? ` ${JSON.stringify(item.label)}` : ""}: ${JSON.stringify(item.model)}`,
      )
      .join("\n")
  );
}

/** Tell the Agent exactly which objects the user pointed at and how far it may write. */
export function targetInstructions(target: AgentTarget, pageTitle?: string) {
  if (!target.pageId)
    return "The user did not focus a page; work at project level and ask before broad changes.";
  const page = `pageId=${target.pageId}${pageTitle ? ` (${JSON.stringify(pageTitle)})` : ""}`;
  const ids = target.blockIds?.length
    ? ` blockIds=${JSON.stringify(target.blockIds)}`
    : "";
  const surface = target.surfaceId ? ` surfaceId=${target.surfaceId}` : "";
  const scope =
    target.kind === "page"
      ? `The request concerns the whole focused page ${page}.`
      : target.kind === "board"
        ? `The user selected these whiteboard objects on ${page}:${surface}${ids}.`
        : target.kind === "text"
          ? `The user selected text inside these blocks on ${page}:${surface}${ids}.`
          : `The user pointed at these blocks on ${page}:${surface}${ids}.`;
  const quote = target.text ? `\nSelected text:\n<<<\n${target.text}\n>>>` : "";
  const limits =
    target.kind === "page"
      ? ""
      : " Read them with page_read using blockIds before editing. Change only those objects (and their children) with page_apply unless the user asks for wider changes; if a wider change is needed, explain it in the reply first. For explanations or questions, reply in text without writing the page.";
  return (
    scope +
    limits +
    quote +
    referenceInstructions(target.reference) +
    componentInstructions(target.components)
  );
}

/** Backends without native session resume receive the previous turns as context. */
export function recap(conversation: AgentConversation, beforeTurnId: string) {
  const turns = conversation.turns
    .filter((turn) => turn.id !== beforeTurnId && turn.state !== "running")
    .slice(-6);
  if (!turns.length) return "";
  return (
    "Earlier turns of this conversation (summarised by the host):\n" +
    turns
      .map((turn) => {
        const reply = turn.events
          .filter((event) => event.type === "message")
          .map((event) => event.text)
          .join("\n")
          .slice(-1500);
        return `User: ${turn.prompt.slice(0, 1500)}\nAssistant: ${reply || turn.error || "(no reply)"}`;
      })
      .join("\n\n") +
    "\n\n"
  );
}

export function summary(
  conversation: AgentConversation,
): AgentConversationSummary {
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    title: conversation.title,
    mode: conversation.mode,
    sourceId: conversation.sourceId,
    localAgent: conversation.localAgent,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    turnCount: conversation.turns.length,
    running: conversation.turns.some((turn) => turn.state === "running"),
  };
}

/**
 * Conversations live per project under the host root. Writes for one
 * conversation are serialised; running turns persist at most once a second.
 */
export class ConversationStore {
  private cache = new Map<string, AgentConversation>();
  private listed = new Set<string>();
  private writes = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly root: string) {}
  private directory(projectId: string) {
    return join(this.root, "conversations", assertId(projectId));
  }
  private file(projectId: string, id: string) {
    return join(this.directory(projectId), assertId(id) + ".json");
  }
  basePath(projectId: string, conversationId: string, turnId: string) {
    return join(
      this.directory(projectId),
      assertId(conversationId) + ".bases",
      assertId(turnId) + ".json",
    );
  }
  writesPath(turn: Pick<AgentTurn, "projectId" | "conversationId" | "id">) {
    return join(
      this.directory(turn.projectId),
      assertId(turn.conversationId) + ".bases",
      assertId(turn.id) + ".writes",
    );
  }
  private recover(conversation: AgentConversation): AgentConversation {
    for (const turn of conversation.turns)
      if (turn.state === "running") {
        turn.state = "failed";
        turn.error = t("task.interrupted");
        turn.approvals = [];
      }
    return conversation;
  }
  async list(projectId: string): Promise<AgentConversation[]> {
    if (!this.listed.has(projectId)) {
      const files = await readdir(this.directory(projectId)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const name of files) {
        const match = /^([a-f0-9-]+)\.json$/.exec(name);
        if (!match || this.cache.has(match[1])) continue;
        const value = await readOptional<AgentConversation>(
          join(this.directory(projectId), name),
        );
        if (value?.projectId === projectId)
          this.cache.set(value.id, this.recover(value));
      }
      this.listed.add(projectId);
    }
    return [...this.cache.values()]
      .filter((item) => item.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(projectId: string, id: string): Promise<AgentConversation> {
    await this.list(projectId);
    const conversation = this.cache.get(id);
    if (!conversation || conversation.projectId !== projectId)
      throw new Error(t("conversation.notFound"));
    return conversation;
  }
  running(): AgentConversation[] {
    return [...this.cache.values()].filter((item) =>
      item.turns.some((turn) => turn.state === "running"),
    );
  }
  findTurn(id: string): AgentTurn | undefined {
    for (const conversation of this.cache.values()) {
      const turn = conversation.turns.find((item) => item.id === id);
      if (turn) return turn;
    }
  }
  owner(turn: AgentTurn): AgentConversation | undefined {
    return this.cache.get(turn.conversationId);
  }
  add(conversation: AgentConversation) {
    this.cache.set(conversation.id, conversation);
  }
  save(conversation: AgentConversation): Promise<void> {
    const pending = this.timers.get(conversation.id);
    if (pending) {
      clearTimeout(pending);
      this.timers.delete(conversation.id);
    }
    const previous = this.writes.get(conversation.id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() =>
        writeProtected(
          this.file(conversation.projectId, conversation.id),
          conversation,
        ),
      );
    this.writes.set(conversation.id, next);
    return next;
  }
  /** Coalesce frequent event updates during a run. */
  schedule(conversation: AgentConversation) {
    if (this.timers.has(conversation.id)) return;
    this.timers.set(
      conversation.id,
      setTimeout(() => {
        this.timers.delete(conversation.id);
        void this.save(conversation).catch((error: Error) =>
          console.error(
            "ShowAI Agent conversation persistence:",
            error.message,
          ),
        );
      }, 1000),
    );
  }
  async saveBase(turn: AgentTurn, projectId: string, document: ShowDocument) {
    await writeProtected(
      this.basePath(projectId, turn.conversationId, turn.id),
      document,
    );
  }
  readBase(projectId: string, conversationId: string, turnId: string) {
    return readOptional<ShowDocument>(
      this.basePath(projectId, conversationId, turnId),
    );
  }
  async remove(projectId: string, id: string) {
    const conversation = await this.get(projectId, id);
    if (conversation.turns.some((turn) => turn.state === "running"))
      throw new Error(t("conversation.stopFirst"));
    const pending = this.timers.get(id);
    if (pending) clearTimeout(pending);
    this.timers.delete(id);
    await (this.writes.get(id) ?? Promise.resolve()).catch(() => {});
    this.cache.delete(id);
    await rm(this.file(projectId, id), { force: true });
    await rm(join(this.directory(projectId), id + ".bases"), {
      recursive: true,
      force: true,
    });
  }
}
