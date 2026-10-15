import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readdir, rm } from "node:fs/promises";
import type { AgentHost } from "./host";
import type { AgentConversation, AgentTurn } from "./types";
import { parseTarget, summary } from "./conversations";
import { readOptional, writeProtected } from "./storage";
import { syncManager } from "../sync/manager";
import { FileStore } from "../core/store";

interface RemoteTurn {
  id: string;
  remoteProjectId: string;
  connectionId: string;
  conversation: AgentConversation;
  turn: AgentTurn;
  phase: "preparing" | "active" | "finished";
  expectedHash?: string;
}
/** Admission is durable and quick; project download and model execution run independently of HTTP. */
export class RemoteTurns {
  private jobs = new Map<string, RemoteTurn>();
  private queues = new Map<string, Promise<unknown>>();
  private loaded?: Promise<void>;
  constructor(
    readonly root: string,
    readonly library: string,
    readonly host: AgentHost,
  ) {}
  get running() {
    return [...this.jobs.values()].some((job) => job.turn.state === "running");
  }
  private file(id: string) {
    return join(this.root, "remote-turns", id + ".json");
  }
  private save(job: RemoteTurn) {
    return writeProtected(this.file(job.id), job);
  }
  ready() {
    return (this.loaded ??= (async () => {
      const files = await readdir(join(this.root, "remote-turns")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const file of files.filter((name) =>
        /^[a-f0-9-]{36}\.json$/.test(name),
      )) {
        const job = await readOptional<RemoteTurn>(
          join(this.root, "remote-turns", file),
        );
        if (!job) continue;
        if (job.turn.state === "running") {
          job.turn.state = "failed";
          job.turn.error =
            "The execution service restarted. Review the saved conversation before sending again.";
          job.turn.finishedAt = new Date().toISOString();
          job.phase = "finished";
          await this.save(job);
        }
        this.jobs.set(job.id, job);
      }
    })());
  }
  hasProject(remoteId: string) {
    return [...this.jobs.values()].some(
      (job) => job.remoteProjectId === remoteId,
    );
  }
  async send(
    projectId: string,
    remoteProjectId: string,
    connectionId: string,
    args: Record<string, unknown>,
  ) {
    await this.ready();
    if (
      typeof args.prompt !== "string" ||
      !args.prompt.trim() ||
      args.prompt.length > 24000
    )
      throw new Error("Enter an Agent request of at most 24000 characters.");
    const target = parseTarget(args.target),
      now = new Date().toISOString(),
      settings = await this.host.settings();
    let conversation: AgentConversation;
    if (args.conversationId) {
      conversation = await this.conversation(
        projectId,
        String(args.conversationId),
      );
      if (conversation.turns.some((turn) => turn.state === "running"))
        throw new Error("This conversation already has a running task.");
      conversation = { ...conversation, turns: [...conversation.turns] };
    } else {
      if (
        settings.mode === "api" &&
        !settings.sources.some((source) => source.id === settings.sourceId)
      )
        throw new Error(
          "Choose your model API or ChatGPT authorization in Agent settings first.",
        );
      const id = randomUUID();
      conversation = {
        id,
        projectId,
        title: args.prompt.trim().replace(/\s+/g, " ").slice(0, 60),
        mode: settings.mode,
        sourceId: settings.mode === "api" ? settings.sourceId : undefined,
        localAgent: settings.mode === "local" ? settings.localAgent : undefined,
        workspace: join(this.host.workspaceRoot, projectId, id),
        createdAt: now,
        updatedAt: now,
        turns: [],
      };
    }
    const id = randomUUID();
    const turn: AgentTurn = {
      id,
      conversationId: conversation.id,
      projectId,
      pageId: target.pageId,
      label: args.prompt.slice(0, 100),
      mode: conversation.mode,
      sourceId: conversation.sourceId,
      localAgent: conversation.localAgent,
      state: "running",
      startedAt: now,
      workspace: conversation.workspace,
      events: [
        {
          sequence: 1,
          type: "status",
          text: "Synchronizing the project before execution…",
        },
      ],
      prompt: args.prompt.trim(),
      target,
    };
    const job: RemoteTurn = {
      id,
      remoteProjectId,
      connectionId,
      conversation,
      turn,
      phase: "preparing",
      expectedHash:
        typeof args.expectedHash === "string" ? args.expectedHash : undefined,
    };
    this.jobs.set(id, job);
    await this.save(job);
    const previous = this.queues.get(remoteProjectId) ?? Promise.resolve();
    const next = previous.then(() => this.run(job));
    this.queues.set(
      remoteProjectId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    void next.catch((error) =>
      console.error("Remote Agent task persistence:", error.message),
    );
    return { ...conversation, turns: [...conversation.turns, turn] };
  }
  private async run(job: RemoteTurn) {
    try {
      if (job.turn.state !== "running") return;
      const manager = syncManager(this.library);
      await manager.subscribe(job.connectionId, job.remoteProjectId);
      await manager.stop();
      const mapping = (await manager.configuration()).projects.find(
        (p) =>
          p.connectionId === job.connectionId &&
          p.remoteProjectId === job.remoteProjectId,
      );
      const state = (await manager.status()).projects.find(
        (p) => p.projectId === mapping?.projectId,
      );
      if (!mapping || state?.status !== "synced")
        throw new Error(
          state?.error ?? "Project synchronization has not completed.",
        );
      if (job.turn.state !== "running") return;
      if (mapping.projectId !== job.conversation.projectId)
        throw new Error(
          "The project's local identity changed. Refresh before sending again.",
        );
      if (
        job.expectedHash &&
        job.turn.pageId &&
        (
          await new FileStore(this.library).readPage(
            mapping.projectId,
            job.turn.pageId,
          )
        ).hash !== job.expectedHash
      )
        throw new Error(
          "The page changed after synchronization. Refresh the page before sending again.",
        );
      if (
        !(await this.host.conversations.list(mapping.projectId)).some(
          (c) => c.id === job.conversation.id,
        )
      ) {
        this.host.conversations.add(job.conversation);
        await this.host.conversations.save(job.conversation);
      }
      const result = await this.host.send(
        {
          projectId: mapping.projectId,
          conversationId: job.conversation.id,
          prompt: job.turn.prompt,
          target: job.turn.target,
        },
        { turnId: job.id },
      );
      job.turn = result.turns.find((turn) => turn.id === job.id)!;
      job.phase = "active";
      await this.save(job);
      while (job.turn.state === "running")
        await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      if (job.turn.state === "running") {
        job.turn.state = "failed";
        job.turn.error = (error as Error).message;
        job.turn.finishedAt = new Date().toISOString();
        job.turn.events.push({
          sequence: job.turn.events.length + 1,
          type: "error",
          text: job.turn.error,
        });
      }
    } finally {
      job.phase = "finished";
      await this.save(job);
    }
  }
  async conversation(
    projectId: string,
    id: string,
  ): Promise<AgentConversation> {
    await this.ready();
    const jobs = [...this.jobs.values()].filter(
      (job) =>
        job.conversation.projectId === projectId && job.conversation.id === id,
    );
    let conversation: AgentConversation;
    if (
      (await this.host.conversations.list(projectId)).some(
        (item) => item.id === id,
      )
    )
      conversation = await this.host.conversations.get(projectId, id);
    else if (jobs.length) conversation = jobs[0].conversation;
    else throw new Error("Conversation not found.");
    const turns = [...conversation.turns];
    for (const job of jobs)
      if (!turns.some((turn) => turn.id === job.id)) turns.push(job.turn);
    return {
      ...conversation,
      turns,
      updatedAt:
        turns.at(-1)?.finishedAt ??
        turns.at(-1)?.startedAt ??
        conversation.updatedAt,
    };
  }
  async list(projectId: string) {
    await this.ready();
    const ids = new Set([
      ...(await this.host.conversations.list(projectId)).map((c) => c.id),
      ...[...this.jobs.values()]
        .filter((job) => job.conversation.projectId === projectId)
        .map((job) => job.conversation.id),
    ]);
    return (
      await Promise.all([...ids].map((id) => this.conversation(projectId, id)))
    )
      .map(summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async cancel(projectId: string, id: string) {
    await this.ready();
    const job = this.jobs.get(id);
    if (!job || job.conversation.projectId !== projectId) return false;
    if (job.phase === "active") this.host.cancel(id);
    else if (job.turn.state === "running") {
      job.turn.state = "cancelled";
      job.turn.finishedAt = new Date().toISOString();
      job.turn.error = "Stopped before model execution.";
      await this.save(job);
    }
    return true;
  }
  async remove(projectId: string, id: string) {
    const jobs = [...this.jobs.values()].filter(
      (job) =>
        job.conversation.projectId === projectId && job.conversation.id === id,
    );
    if (jobs.some((job) => job.turn.state === "running"))
      throw new Error(
        "Stop the running task before deleting this conversation.",
      );
    for (const job of jobs) {
      await rm(this.file(job.id), { force: true });
      this.jobs.delete(job.id);
    }
    if (
      (await this.host.conversations.list(projectId)).some((c) => c.id === id)
    )
      await this.host.conversations.remove(projectId, id);
    return null;
  }
  stopAll() {
    const changed: RemoteTurn[] = [];
    for (const job of this.jobs.values())
      if (job.turn.state === "running") {
        this.host.cancel(job.id);
        if (job.phase === "active") continue;
        job.turn.state = "cancelled";
        job.turn.finishedAt = new Date().toISOString();
        job.turn.error = "Remote execution was disabled.";
        changed.push(job);
      }
    return Promise.all(changed.map((job) => this.save(job)));
  }
  async settled() {
    await Promise.all([...this.queues.values()]);
  }
}
