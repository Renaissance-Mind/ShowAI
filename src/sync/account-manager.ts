import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { atomicLibraryFile } from "../core/library-files";
import { withLibraryLock } from "../core/library-lock";
import { CoreError } from "../core/model";
import { serverEndpoint, serverBaseUrl } from "./server-url";
import {
  identifier,
  canonical,
  SyncError,
  type ServerConnection,
  type SyncConfiguration,
} from "./protocol";
import {
  accountCapability,
  type AccountBinding,
  type AccountProfile,
  type SignedIdentity,
  type SignedGrant,
  type ResolvedResource,
  type AccountResource,
} from "./accounts";
import { verify } from "../server/account-crypto";

interface Adapter {
  home: string;
  configuration(): Promise<SyncConfiguration>;
  connect(input: {
    url: string;
    token: string;
    restoreBindings: false;
  }): Promise<{ id: string }>;
}
interface PendingBinding {
  id: string;
  connectionId: string;
  target?: { serverId: string; userId: string };
  descriptor: SignedIdentity;
  state: "active" | "removed";
}
interface FederationState {
  version: 1;
  pending: PendingBinding[];
  errors: Record<string, string>;
}
const label = () => `ShowAI · ${hostname().slice(0, 180)}`;
export async function accountRequest<T>(
  connection: Pick<ServerConnection, "url" | "token">,
  path: string,
  method = "GET",
  input?: unknown,
): Promise<T> {
  const response = await fetch(serverEndpoint(connection.url, path), {
    method,
    headers: {
      authorization: `Bearer ${connection.token}`,
      ...(input === undefined ? {} : { "content-type": "application/json" }),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new SyncError(
      response.status,
      value.error?.code ?? "SERVER_ERROR",
      value.error?.message ?? `服务器返回 ${response.status}`,
    );
  return value as T;
}
export class AccountManager {
  private work?: Promise<unknown>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  constructor(readonly adapter: Adapter) {}
  private get path() {
    return join(this.adapter.home, "local", "sync", "federation.json");
  }
  private async state(): Promise<FederationState> {
    const bytes = await readFile(this.path, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!bytes) return { version: 1, pending: [], errors: {} };
    const state = JSON.parse(bytes) as FederationState;
    if (state.version !== 1 || !Array.isArray(state.pending) || !state.errors)
      throw new Error("Invalid account federation journal.");
    return state;
  }
  private async update(action: (state: FederationState) => void) {
    return withLibraryLock(
      this.adapter.home,
      async () => {
        const state = await this.state();
        action(state);
        await atomicLibraryFile(
          this.adapter.home,
          this.path,
          Buffer.from(JSON.stringify(state)),
        );
        return state;
      },
      "account-federation",
    );
  }
  async status() {
    const state = await this.state();
    return {
      pending: state.pending.map(({ descriptor, connectionId, state }) => ({
        connectionId,
        serverId: descriptor.identity.serverId,
        state,
      })),
      errors: state.errors,
    };
  }
  private async connection(id: string) {
    const connection = (await this.adapter.configuration()).connections.find(
      (item) => item.id === id,
    );
    if (!connection) throw new CoreError("NOT_FOUND", "服务器账号连接不存在。");
    if (!connection.capabilities?.includes(accountCapability))
      throw new CoreError("INVALID_DATA", "此服务器尚未启用账号绑定。");
    return connection;
  }
  private async own(connection: ServerConnection) {
    const descriptor = await accountRequest<SignedIdentity>(
      connection,
      "/api/account/identity",
      "POST",
      {},
    );
    if (
      descriptor.identity.serverId !== connection.serverId ||
      descriptor.identity.user.id !== connection.user.id ||
      !(await verify(
        descriptor.identity.publicKey,
        descriptor.identity,
        descriptor.signature,
      ))
    )
      throw new CoreError("INVALID_DATA", "服务器返回的账号身份不匹配。");
    return descriptor;
  }
  async profile(connectionId: string) {
    const connection = await this.connection(connectionId);
    const profile = await accountRequest<AccountProfile>(
      connection,
      "/api/account/federation",
    );
    if (
      profile.own &&
      (profile.own.identity.serverId !== connection.serverId ||
        profile.own.identity.user.id !== connection.user.id)
    )
      throw new CoreError("INVALID_DATA", "服务器返回的账号身份不匹配。");
    return profile;
  }
  private async exclusive<T>(action: () => Promise<T>) {
    return withLibraryLock(
      this.adapter.home,
      action,
      "account-federation-work",
    );
  }
  private async flush() {
    const pending = (await this.state()).pending;
    for (let index = 0; index < pending.length;) {
      const first = pending[index++],
        batch = [first];
      // Remove all consecutive peers of a target in one transaction. A restored
      // session can itself originate from the first removed peer; revoking it
      // before the remaining removals would strand an incomplete unlink.
      while (
        first.state === "removed" &&
        index < pending.length &&
        pending[index].state === "removed" &&
        pending[index].connectionId === first.connectionId
      )
        batch.push(pending[index++]);
      try {
        const restored = first.target
          ? (await this.adapter.configuration()).connections.find(
              (item) =>
                item.serverId === first.target!.serverId &&
                item.user.id === first.target!.userId,
            )
          : undefined;
        const connection = await this.connection(
          restored?.id ?? first.connectionId,
        );
        if (first.state === "removed") {
          const unique = new Map(
            batch.map((item) => [item.descriptor.identity.serverId, item]),
          );
          await accountRequest(connection, "/api/account/bindings", "PUT", {
            bindings: [...unique.values()].map((item) => ({
              descriptor: item.descriptor,
              state: "removed",
              updatedAt: Date.now(),
              changeId: crypto.randomUUID(),
            })),
          });
        } else {
          await accountRequest(connection, "/api/account/bindings", "POST", {
            descriptor: first.descriptor,
          });
        }
        const completed = new Set(batch.map((item) => item.id));
        await this.update((state) => {
          state.pending = state.pending.filter(
            (item) => !completed.has(item.id),
          );
          delete state.errors[first.connectionId];
        });
      } catch (error) {
        await this.update((state) => {
          state.errors[first.connectionId] =
            error instanceof Error ? error.message : String(error);
        });
      }
    }
  }
  async bind(firstId: string, secondId: string) {
    return this.exclusive(() => this.bindGroup(firstId, secondId));
  }
  private async bindGroup(firstId: string, secondId: string) {
    if (firstId === secondId)
      throw new CoreError("INVALID_DATA", "请选择两个不同服务的账号。");
    const first = await this.connection(firstId),
      second = await this.connection(secondId);
    if (first.serverId === second.serverId)
      throw new CoreError(
        "CONFLICT",
        "同一服务器上的不同账号不能绑定为同一个账号。",
      );
    const [a, b] = await Promise.all([this.own(first), this.own(second)]);
    const profiles = await Promise.all([
      this.profile(first.id),
      this.profile(second.id),
    ]);
    const identities = new Map<string, SignedIdentity>();
    for (const descriptor of [
      a,
      b,
      ...profiles.flatMap((profile) =>
        profile.peers
          .filter((peer) => peer.state === "active")
          .map((peer) => peer.descriptor),
      ),
    ]) {
      const identity = descriptor.identity;
      const previous = identities.get(identity.serverId)?.identity;
      if (
        previous &&
        (previous.user.id !== identity.user.id ||
          previous.generation !== identity.generation ||
          canonical(previous.publicKey) !== canonical(identity.publicKey))
      )
        throw new CoreError(
          "CONFLICT",
          "两组绑定包含同一服务器的不同账号或身份，请先解除冲突的绑定。",
        );
      identities.set(identity.serverId, descriptor);
    }
    await this.update((state) => {
      state.pending.push(
        {
          id: crypto.randomUUID(),
          connectionId: first.id,
          descriptor: b,
          state: "active",
        },
        {
          id: crypto.randomUUID(),
          connectionId: second.id,
          descriptor: a,
          state: "active",
        },
      );
    });
    await this.flush();
    await this.restoreLogin(first.id);
    await this.reconcileGroup();
    return this.status();
  }
  async restore(connectionId: string) {
    return this.exclusive(() => this.restoreLogin(connectionId));
  }
  private async restoreLogin(
    connectionId: string,
    visited = new Set<string>(),
  ) {
    const initial = await this.connection(connectionId),
      config = await this.adapter.configuration();
    const queue = [initial],
      restored: string[] = [],
      maximum = visited.size + 32;
    while (queue.length && visited.size < maximum) {
      const source = queue.shift()!,
        sourceKey = `${source.serverId}:${source.user.id}`;
      if (visited.has(sourceKey)) continue;
      visited.add(sourceKey);
      let profile: AccountProfile;
      try {
        profile = await this.profile(source.id);
        await this.update((state) => {
          delete state.errors[source.id];
        });
      } catch (error) {
        await this.update((state) => {
          state.errors[source.id] =
            error instanceof Error ? error.message : String(error);
        });
        continue;
      }
      for (const binding of profile.peers.filter(
        (item) => item.state === "active",
      )) {
        const identity = binding.descriptor.identity,
          peerKey = `${identity.serverId}:${identity.user.id}`;
        identifier(identity.serverId);
        identifier(identity.user.id);
        serverBaseUrl(identity.url);
        if (visited.has(peerKey)) continue;
        try {
          let existing = (await this.adapter.configuration()).connections.find(
            (item) =>
              item.serverId === identity.serverId &&
              item.user.id === identity.user.id,
          );
          if (existing) {
            const me = await accountRequest<{
              serverId: string;
              user: { id: string };
            }>(existing, "/api/me").catch((error: unknown) => {
              if (error instanceof SyncError && error.status === 401)
                return undefined;
              throw error;
            });
            if (
              me &&
              (me.serverId !== identity.serverId ||
                me.user.id !== identity.user.id)
            )
              throw new Error("绑定服务器的身份发生变化。");
            if (!me) existing = undefined;
          }
          if (!existing) {
            const info = await accountRequest<{ serverId: string }>(
              { url: identity.url, token: "" },
              "/api/info",
            );
            if (info.serverId !== identity.serverId)
              throw new Error("绑定服务器的身份发生变化。");
            const grant = await accountRequest<SignedGrant>(
              source,
              "/api/account/grants",
              "POST",
              {
                serverId: identity.serverId,
                deviceId: config.deviceId,
                device: label(),
              },
            );
            const session = await accountRequest<{
              token: string;
              serverId: string;
              user: { id: string };
            }>(
              { url: identity.url, token: "" },
              "/api/auth/exchange",
              "POST",
              grant,
            );
            if (
              session.serverId !== identity.serverId ||
              session.user.id !== identity.user.id
            )
              throw new Error("恢复的账号与绑定身份不一致。");
            const result = await this.adapter.connect({
              url: identity.url,
              token: session.token,
              restoreBindings: false,
            });
            existing = await this.connection(result.id);
            restored.push(existing.id);
          }
          queue.push(existing);
          await this.update((state) => {
            delete state.errors[`${identity.serverId}:${identity.user.id}`];
          });
        } catch (error) {
          await this.update((state) => {
            state.errors[peerKey] =
              error instanceof Error ? error.message : String(error);
          });
        }
      }
    }
    return { restored, ...(await this.status()) };
  }
  async reconcile() {
    return this.exclusive(() => this.reconcileGroup());
  }
  async refresh() {
    return this.exclusive(async () => {
      await this.flush();
      const visited = new Set<string>();
      for (const connection of (
        await this.adapter.configuration()
      ).connections.filter((item) =>
        item.capabilities?.includes(accountCapability),
      )) {
        if (!visited.has(`${connection.serverId}:${connection.user.id}`))
          await this.restoreLogin(connection.id, visited);
      }
      return this.reconcileGroup();
    });
  }
  private async reconcileGroup() {
    await this.flush();
    const connections = (await this.adapter.configuration()).connections.filter(
      (item) => item.capabilities?.includes(accountCapability),
    );
    const profiles = new Map<string, AccountProfile>();
    for (const connection of connections) {
      try {
        profiles.set(connection.id, await this.profile(connection.id));
      } catch (error) {
        await this.update((state) => {
          state.errors[connection.id] =
            error instanceof Error ? error.message : String(error);
        });
      }
    }
    // Propagate only within the account's existing connected component. Merely
    // logging into unrelated accounts does not consent to binding them.
    for (const connection of connections) {
      const profile = profiles.get(connection.id);
      if (!profile?.own) continue;
      const reachable = new Set([connection.id]),
        records = new Map<string, AccountBinding>();
      const queue = [connection.id];
      while (queue.length) {
        const current = profiles.get(queue.shift()!);
        if (!current?.own) continue;
        for (const binding of current.peers) {
          const key = binding.descriptor.identity.serverId,
            previous = records.get(key);
          if (
            !previous ||
            binding.updatedAt > previous.updatedAt ||
            (binding.updatedAt === previous.updatedAt &&
              binding.changeId > previous.changeId)
          )
            records.set(key, binding);
          if (binding.state !== "active") continue;
          const target = connections.find(
            (item) =>
              item.serverId === key &&
              item.user.id === binding.descriptor.identity.user.id,
          );
          if (target && !reachable.has(target.id)) {
            reachable.add(target.id);
            queue.push(target.id);
          }
        }
      }
      const ownServer = connection.serverId;
      records.delete(ownServer);
      if (!records.size) continue;
      try {
        await accountRequest(connection, "/api/account/bindings", "PUT", {
          bindings: [...records.values()],
        });
      } catch (error) {
        await this.update((state) => {
          state.errors[connection.id] =
            error instanceof Error ? error.message : String(error);
        });
      }
    }
    return this.status();
  }
  async unbind(connectionId: string, peerServerId: string) {
    return this.exclusive(() => this.unbindGroup(connectionId, peerServerId));
  }
  private async unbindGroup(connectionId: string, peerServerId: string) {
    const profile = await this.profile(connectionId),
      target = profile.peers.find(
        (item) =>
          item.descriptor.identity.serverId === peerServerId &&
          item.state === "active",
      );
    if (!target || !profile.own)
      throw new CoreError("NOT_FOUND", "绑定不存在。");
    const connections = (await this.adapter.configuration()).connections;
    const members = [
      profile.own,
      ...profile.peers
        .filter((item) => item.state === "active")
        .map((item) => item.descriptor),
    ];
    await this.update((state) => {
      for (const member of members) {
        const connection = connections.find(
          (item) =>
            item.serverId === member.identity.serverId &&
            item.user.id === member.identity.user.id,
        );
        const removed =
          member.identity.serverId === peerServerId
            ? members.filter((item) => item.identity.serverId !== peerServerId)
            : [target.descriptor];
        for (const descriptor of removed) {
          state.pending.push({
            id: crypto.randomUUID(),
            connectionId:
              connection?.id ??
              `${member.identity.serverId}:${member.identity.user.id}`,
            target: {
              serverId: member.identity.serverId,
              userId: member.identity.user.id,
            },
            descriptor,
            state: "removed",
          });
        }
      }
    });
    await this.flush();
    await this.reconcileGroup();
    return this.status();
  }
  async resources(): Promise<ResolvedResource[]> {
    const cachePath = join(
      this.adapter.home,
      "local",
      "sync",
      "resources.json",
    );
    const cached = await readFile(cachePath, "utf8").then(
      (bytes) => JSON.parse(bytes) as ResolvedResource[],
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const result: ResolvedResource[] = [];
    for (const connection of (
      await this.adapter.configuration()
    ).connections.filter((item) =>
      item.capabilities?.includes(accountCapability),
    )) {
      try {
        for (const resource of await accountRequest<AccountResource[]>(
          connection,
          "/api/account/resources",
        )) {
          if (
            resource.source.serverId !== connection.serverId ||
            resource.source.user.id !== connection.user.id
          )
            throw new CoreError(
              "INVALID_DATA",
              "资源的服务器或账号来源不匹配。",
            );
          result.push({
            ...resource,
            connectionId: connection.id,
            resourceId: resource.id,
            id: `${connection.serverId}:${connection.user.id}:${resource.id}`,
            available: true,
          });
        }
        await this.update((state) => {
          delete state.errors[connection.id];
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const resource of cached.filter(
          (item) =>
            item.source.serverId === connection.serverId &&
            item.source.user.id === connection.user.id,
        ))
          result.push({
            ...resource,
            connectionId: connection.id,
            available: false,
            error: message,
          });
        await this.update((state) => {
          state.errors[connection.id] = message;
        });
      }
    }
    await withLibraryLock(
      this.adapter.home,
      () =>
        atomicLibraryFile(
          this.adapter.home,
          cachePath,
          Buffer.from(JSON.stringify(result)),
        ),
      "resource-catalog",
    );
    return result;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      if (this.stopped) return;
      this.work = this.refresh().finally(() => {
        this.work = undefined;
        if (!this.stopped) {
          this.timer = setTimeout(tick, 60_000);
          this.timer.unref();
        }
      });
      void this.work.catch((error) => {
        console.error(
          "Account federation reconciliation failed",
          error instanceof Error ? error.message : String(error),
        );
      });
    };
    this.timer = setTimeout(tick, 5000);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.work;
  }
}
