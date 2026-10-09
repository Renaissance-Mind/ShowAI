import {
  eventCredential,
  maximumEventBytes,
  maximumEventInput,
  maximumEventProjects,
  type EventIdentity,
  type ProjectEvent,
} from "../sync/events";
import {
  hash,
  identifier,
  SyncError,
  type SyncProject,
  type SnapshotRecord,
} from "../sync/protocol";
import type { MetadataStore, ObjectStore } from "./storage";
import type { RequestBudgets } from "./request-budget";
import type { Revisions } from "./revisions";

export interface EventPeer {
  identity(): EventIdentity;
  remember(identity: EventIdentity): void;
  send(message: string): void;
  close(code: number, reason: string): void;
  bufferedAmount?: number;
}
const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
};

/** Shared by Linux sockets and hibernating Cloudflare sockets. Permissions and
 * budgets are rechecked before every delivery; no token is persisted by peers. */
export class ProjectEvents {
  constructor(
    readonly db: MetadataStore,
    readonly objects: ObjectStore,
    readonly revisions: Revisions,
    readonly budgets: RequestBudgets,
    readonly serverId: () => Promise<string>,
    readonly peers: () => Iterable<EventPeer>,
  ) {}
  async authenticate(request: Request): Promise<EventIdentity> {
    const credential = eventCredential(request);
    if (!credential)
      throw new SyncError(
        401,
        "UNAUTHORIZED",
        "Sign in to receive project updates.",
      );
    const sessionDigest = await hash(credential);
    const user = (
      await this.db.all<{ id: string }>(
        "SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.revoked=0 AND s.auth_version=u.auth_version AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        [sessionDigest],
      )
    )[0];
    if (!user)
      throw new SyncError(
        401,
        "UNAUTHORIZED",
        "The device session has expired or was revoked.",
      );
    await this.budgets.consume();
    await this.budgets.consume(user.id);
    return { userId: user.id, sessionDigest, projects: [] };
  }
  private async projects(
    identity: EventIdentity,
  ): Promise<SyncProject[] | null> {
    const valid = (
      await this.db.all(
        "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.user_id=? AND s.revoked=0 AND s.auth_version=u.auth_version AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        [identity.sessionDigest, identity.userId],
      )
    ).length;
    if (!valid) return null;
    const projects: SyncProject[] = [];
    for (let offset = 0; offset < identity.projects.length; offset += 80) {
      const ids = identity.projects.slice(offset, offset + 80);
      const rows = await this.db.all<
        Omit<SyncProject, "archived"> & { archived: number }
      >(
        `SELECT p.id,p.name,p.head,p.archived,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? AND p.id IN(${ids.map(() => "?").join(",")})`,
        [identity.userId, ...ids],
      );
      projects.push(
        ...rows.map((row) => ({ ...row, archived: !!row.archived })),
      );
    }
    return projects;
  }
  private async deliver(peer: EventPeer, event: ProjectEvent) {
    // Permission changes can interleave with object reads and budget accounting.
    // Re-read authority immediately before constructing the delivered payload.
    const current = await this.projects(peer.identity());
    if (!current) {
      peer.close(4001, "The device session is no longer valid.");
      return;
    }
    if (event.type === "heads") event = { ...event, projects: current };
    if (event.type === "revision") {
      const id = event.project.id;
      const project = current.find((item) => item.id === id);
      if (!project)
        event = { type: "heads", serverId: event.serverId, projects: current };
      else if (project.head !== event.project.head)
        event = { type: "revision", serverId: event.serverId, project };
      else event = { ...event, project };
    }
    const frame = JSON.stringify(event);
    if (
      encoder.encode(frame).length > maximumEventBytes ||
      (peer.bufferedAmount ?? 0) > maximumEventBytes
    ) {
      peer.close(1013, "Catch up using project history.");
      return;
    }
    try {
      await this.budgets.consumeRead(
        peer.identity().userId,
        encoder.encode(frame).length,
      );
      peer.send(frame);
    } catch (error) {
      // A recipient's exhausted budget or failed transport must not turn an
      // already durable publication into a failed write for every other member.
      const code =
        error instanceof SyncError ? error.code : "EVENT_DELIVERY_FAILED";
      if (!(error instanceof SyncError))
        console.error("Project event delivery failed", error);
      peer.send(
        JSON.stringify({
          type: "error",
          code,
          message: "Reconnect after checking server status.",
        }),
      );
      peer.close(
        error instanceof SyncError ? 1008 : 1011,
        "Project update delivery paused.",
      );
    }
  }
  async receive(peer: EventPeer, message: string) {
    if (encoder.encode(message).length > maximumEventInput)
      throw new SyncError(
        413,
        "TOO_LARGE",
        "Project event request is too large.",
      );
    const input = JSON.parse(message);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new SyncError(
        400,
        "INVALID_EVENT",
        "A project event request is required.",
      );
    const identity = peer.identity();
    await this.budgets.consume();
    await this.budgets.consume(identity.userId);
    if (input.type === "subscribe") {
      if (!Array.isArray(input.ids) || input.ids.length > maximumEventProjects)
        throw new SyncError(
          400,
          "INVALID_PROJECTS",
          "Subscribe to at most 1000 projects.",
        );
      identity.projects = [...new Set<string>(input.ids.map(identifier))];
      peer.remember(identity);
    } else if (input.type !== "ping")
      throw new SyncError(
        400,
        "INVALID_EVENT",
        "Unknown project event request.",
      );
    const projects = await this.projects(identity);
    if (!projects) {
      peer.close(4001, "The device session is no longer valid.");
      return;
    }
    if (input.type === "ping") peer.send(JSON.stringify({ type: "pong" }));
    else
      await this.deliver(peer, {
        type: "heads",
        serverId: await this.serverId(),
        projects,
      });
  }
  async recheck() {
    for (const peer of this.peers()) {
      const projects = await this.projects(peer.identity());
      if (!projects) peer.close(4001, "The device session is no longer valid.");
      else
        await this.deliver(peer, {
          type: "heads",
          serverId: await this.serverId(),
          projects,
        });
    }
  }
  async published(projectId: string, previousHead?: string | null) {
    const targets = [...this.peers()].filter((peer) =>
      peer.identity().projects.includes(projectId),
    );
    if (!targets.length) return;
    const head = (
      await this.db.all<{ head: string | null }>(
        "SELECT head FROM projects WHERE id=?",
        [projectId],
      )
    )[0]?.head;
    if (!head) return this.recheck();
    const row = await this.revisions.row(projectId, head);
    if (!row)
      throw new Error("A published project head is missing its revision.");
    const record = await this.revisions.record(projectId, row);
    const inline: Record<string, string> = {};
    let size = encoder.encode(JSON.stringify(record)).length;
    let previous: SnapshotRecord | undefined;
    let previousSequence: number | undefined =
      previousHead === null ? 0 : undefined;
    if (previousHead && previousHead !== head) {
      const row = await this.revisions.row(projectId, previousHead);
      if (row) {
        previous = await this.revisions.record(projectId, row);
        previousSequence = row.sequence;
      }
    }
    if (size < maximumEventBytes / 2) {
      const seen = new Set<string>();
      for (const [path, digest] of Object.entries(record.snapshot.files)) {
        if (previous?.snapshot.files[path] === digest || seen.has(digest))
          continue;
        seen.add(digest);
        const key = `projects/${projectId}/objects/${digest}`;
        const info = await this.objects.stat(key);
        if (
          !info ||
          info.bytes > 64 * 1024 ||
          size + Math.ceil((info.bytes * 4) / 3) > maximumEventBytes / 2
        )
          continue;
        const bytes = await this.objects.get(key, 64 * 1024);
        if (!bytes) throw new Error("A published project object is missing.");
        inline[digest] = base64(bytes);
        size += inline[digest].length + digest.length + 8;
      }
    }
    for (const peer of targets) {
      const projects = await this.projects(peer.identity());
      if (!projects) {
        peer.close(4001, "The device session is no longer valid.");
        continue;
      }
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        await this.deliver(peer, {
          type: "heads",
          serverId: await this.serverId(),
          projects,
        });
        continue;
      }
      // The head can advance while objects are read. Never attach an older record
      // to a newer notification; the normal verified history path catches up.
      await this.deliver(peer, {
        type: "revision",
        serverId: await this.serverId(),
        project,
        ...(size < maximumEventBytes / 2 && project.head === head
          ? {
              record,
              objects: inline,
              previousHead,
              sequence: row.sequence,
              previousSequence,
            }
          : {}),
      });
    }
  }
}
