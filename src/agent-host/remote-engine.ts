import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readOptional, writeProtected } from "./storage";
import { AgentHost, type AgentHostOptions } from "./host";
import type { AgentHostStatus } from "./types";
import { RemoteTurns } from "./remote-turns";
import { FileStore } from "../core/store";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { ModelResourceClient } from "../sync/model-resources";
import { accountRequest } from "../sync/account-manager";
import type { ServerConnection, SyncProject } from "../sync/protocol";
import {
  invocation,
  remoteTaskActions,
  type AgentInvocation,
  type RemoteActor,
} from "./remote-protocol";

/** One cloud account per engine/container; desktop engines retain their configured host. */
export class RemoteAgentEngine {
  readonly host: AgentHost;
  readonly turns: RemoteTurns;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly options: {
      root: string;
      library: string;
      cli: AgentHostOptions["cli"];
      pluginRoot: AgentHostOptions["pluginRoot"];
      runtimeRoot?: string;
      oauthRedirectUrl?: string;
      afterAuthorization?: () => Promise<void>;
      host?: AgentHost;
      connectionId?: string;
      projectIds?: string[];
      deferTaskStart?: boolean;
    },
  ) {
    this.host =
      options.host ??
      new AgentHost({
        root: options.root,
        runtimeRoot: options.runtimeRoot,
        oauthRedirectUrl: options.oauthRedirectUrl,
        afterAuthorization: options.afterAuthorization,
        workspaceRoot: join(options.root, "workspaces"),
        library: () => new FileStore(options.library),
        cli: options.cli,
        pluginRoot: options.pluginRoot,
        resources: new ModelResourceClient(() => options.library),
        afterTurn: async (projectId) => {
          await this.publish(projectId);
        },
      });
    this.turns = new RemoteTurns(
      options.root,
      options.library,
      this.host,
      options.deferTaskStart,
    );
  }
  private async publish(projectId: string) {
    const manager = syncManager(this.options.library);
    const state = (await manager.run(projectId)).projects.find(
      (p) => p.projectId === projectId,
    );
    await manager.stop();
    if (state?.status !== "synced")
      throw new Error(
        `Agent changes are saved locally but not synchronized: ${state?.error ?? state?.status}`,
      );
  }
  async connection(actor?: RemoteActor): Promise<ServerConnection> {
    const manager = syncManager(this.options.library);
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    await openLibrary(this.options.library);
    let config = await manager.configuration();
    if (this.options.connectionId) {
      const connection = config.connections.find(
        (c) => c.id === this.options.connectionId && !c.signedOut,
      );
      if (!connection)
        throw new Error("Sign in to the shared server on this Mac first.");
      return connection;
    }
    if (!actor) throw new Error("An authenticated account is required.");
    let connection = config.connections.find(
      (c) =>
        c.url === actor.serverUrl &&
        c.user.id === actor.userId &&
        c.token === actor.token,
    );
    if (!connection) {
      const result = await manager.connect({
        url: actor.serverUrl,
        token: actor.token,
        restoreBindings: false,
      });
      await manager.stop();
      config = await manager.configuration();
      connection = config.connections.find((c) => c.id === result.id);
    }
    if (
      !connection ||
      connection.user.id !== actor.userId ||
      connection.serverId !== actor.serverId
    )
      throw new Error("Account identity changed.");
    return connection;
  }
  async invoke(raw: AgentInvocation, actor?: RemoteActor) {
    const request = invocation(raw);
    const next = this.queue.then(() => this.perform(request, actor));
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private async perform(
    request: AgentInvocation,
    actor?: RemoteActor,
  ): Promise<unknown> {
    const { action, requestId } = request;
    if (this.options.host && !remoteTaskActions.has(action))
      throw new Error("Configure this Mac's Agent on the Mac.");
    const connection = await this.connection(actor);
    await this.turns.ready();
    // Cloud requests have already passed the gateway's live session check.
    // A Mac also validates its own separate server session before executing.
    if (this.options.host) await accountRequest(connection, "/api/me");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          action,
          args: request.args,
          projectId: request.projectId,
        }),
      )
      .digest("hex");
    const receiptPath = join(
      this.options.root,
      "remote-requests",
      requestId + ".json",
    );
    const receipt = await readOptional<{
      fingerprint: string;
      state: string;
      value?: unknown;
    }>(receiptPath);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new Error("Request ID reused with different content.");
      if (receipt.state !== "completed")
        throw new Error(
          "This request was interrupted. Inspect the conversation before sending a new request.",
        );
      return receipt.value;
    }
    const args = { ...request.args };
    if (action === "agent:start" && args.test !== true)
      throw new Error(
        "Remote tasks must be sent through a project conversation.",
      );
    let localId: string | undefined;
    if (request.projectId) {
      if (
        this.options.projectIds &&
        !this.options.projectIds.includes(request.projectId)
      )
        throw new Error("This project is not shared by the Mac.");
      const project = await accountRequest<SyncProject>(
        connection,
        `/api/projects/${request.projectId}`,
      );
      if (project.role === "viewer" && !remoteReadActionsForEngine.has(action))
        throw new Error("This project is read only.");
      const manager = syncManager(this.options.library);
      if (action === "agent:undo") {
        await manager.subscribe(connection.id, request.projectId);
        await manager.stop();
      }
      const mapping = (await manager.configuration()).projects.find(
        (p) =>
          p.connectionId === connection.id &&
          p.remoteProjectId === request.projectId,
      );
      if (
        !mapping &&
        !(action === "agent:send" && !this.options.host) &&
        !this.turns.hasProject(request.projectId)
      )
        throw new Error(
          "Synchronize this project on the execution device first.",
        );
      localId = mapping?.projectId ?? request.projectId;
      args.projectId = localId;
      if (
        action === "agent:cancel" &&
        (await this.turns.cancel(localId, String(args.id)))
      )
        return null;
      // A remote task/file/approval must belong to the explicitly authorized project.
      if (
        ["agent:cancel", "agent:readFile", "agent:permission"].includes(action)
      ) {
        const conversations = await this.host.conversations.list(localId);
        const turns = (
          await Promise.all(
            conversations.map((c) =>
              this.host.conversations.get(localId!, c.id),
            ),
          )
        ).flatMap((c) => c.turns);
        if (
          !turns.some((turn) =>
            action === "agent:permission"
              ? turn.approvals?.some((p) => p.id === args.id)
              : turn.id === args.id,
          )
        )
          throw new Error("Task does not belong to this project.");
      }
    } else if (remoteTaskActions.has(action) && action !== "agent:status")
      throw new Error("A project is required.");
    if (!this.options.host && action === "agent:authorize")
      throw new Error(
        "Authorize ChatGPT on your Mac and publish it to your server, then select that server model source for Cloud execution. OpenAI requires a local callback.",
      );
    if (
      !this.options.host &&
      action === "agent:settings" &&
      (args.settings as { mode?: string })?.mode !== "api"
    )
      throw new Error(
        "Cloud execution uses the user's model API or ChatGPT authorization.",
      );
    if (!this.options.host && (await this.host.settings()).mode !== "api")
      await this.host.save({ ...(await this.host.settings()), mode: "api" });
    if (!remoteReadActionsForEngine.has(action))
      await writeProtected(receiptPath, { fingerprint, state: "started" });
    let value: unknown;
    if (action === "agent:send")
      value = await this.turns.send(
        localId!,
        request.projectId!,
        connection.id,
        args,
      );
    else if (action === "agent:conversations")
      value = await this.turns.list(localId!);
    else if (action === "agent:conversation")
      value = await this.turns.conversation(localId!, String(args.id));
    else if (action === "agent:turn") {
      const conversation = await this.turns.conversation(
        localId!,
        String(args.conversationId),
      );
      const turn = conversation.turns.find((t) => t.id === args.id);
      if (!turn) throw new Error("Task does not belong to this conversation.");
      value = { turn, threadId: conversation.threadId };
    } else if (action === "agent:deleteConversation")
      value = await this.turns.remove(localId!, String(args.id));
    else value = await this.host.action(action, args);
    if (action === "agent:undo" && localId) await this.publish(localId);
    if (
      action === "agent:status" ||
      action === "agent:scan" ||
      action === "agent:settings" ||
      action === "agent:source"
    ) {
      const status = value as AgentHostStatus;
      const mappings = (await syncManager(this.options.library).configuration())
        .projects;
      const allowed = new Set(
        mappings
          .filter(
            (p) =>
              !this.options.projectIds ||
              this.options.projectIds.includes(p.remoteProjectId),
          )
          .map((p) => p.projectId),
      );
      value = {
        ...status,
        workspaceRoot: "",
        credentialRoot: "",
        tasks: status.tasks.filter(
          (task) => !this.options.host || allowed.has(task.projectId),
        ),
      };
    }
    // Only successful replies are memoized; a timed-out caller retries with the same id.
    if (!remoteReadActionsForEngine.has(action))
      await writeProtected(receiptPath, {
        fingerprint,
        state: "completed",
        value,
      });
    return value;
  }
}
const remoteReadActionsForEngine = new Set([
  "agent:status",
  "agent:scan",
  "agent:conversations",
  "agent:conversation",
  "agent:turn",
  "agent:readFile",
  "agent:models",
  "agent:serverResources",
]);
