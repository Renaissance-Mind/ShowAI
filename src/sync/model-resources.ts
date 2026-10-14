import { syncManager } from "./manager";
import { accountRequest } from "./account-manager";
import { CoreError } from "../core/model";
import type { AccountResource, ResolvedResource } from "./accounts";
import type { ModelSource } from "../agent-host/types";
import type { HostedCredentialBroker } from "../agent-host/storage";
import { translator } from "../i18n";
import syncEngineMessages from "../i18n/messages/syncEngine";

const t = translator(syncEngineMessages);
export interface HostedSource {
  connectionId: string;
  resourceId: string;
  serverName: string;
  url: string;
}
export interface ModelResources extends HostedCredentialBroker {
  list(): Promise<ResolvedResource[]>;
  resolve(source: HostedSource): Promise<AccountResource>;
  token(
    source: HostedSource,
    expected: ModelSource,
    force?: boolean,
  ): Promise<{ token: string; expiresAt: number }>;
  publish(
    connectionId: string,
    input: Record<string, unknown>,
  ): Promise<AccountResource>;
}
export class ModelResourceClient implements ModelResources {
  constructor(readonly home: () => string) {}
  async list() {
    return syncManager(this.home()).accounts.resources();
  }
  private async connection(id: string) {
    const connection = (
      await syncManager(this.home()).configuration()
    ).connections.find((item) => item.id === id);
    if (!connection)
      throw new CoreError("NOT_FOUND", t("resources.serverSignedOut"));
    return connection;
  }
  async resolve(source: HostedSource) {
    const connection = await this.connection(source.connectionId);
    const resource = (
      await accountRequest<AccountResource[]>(
        connection,
        "/api/account/resources",
      )
    ).find((item) => item.id === source.resourceId);
    if (!resource) throw new CoreError("NOT_FOUND", t("resources.removed"));
    return resource;
  }
  async token(source: HostedSource, expected: ModelSource, force = false) {
    const resource = await this.resolve(source);
    if (
      resource.baseUrl !== expected.baseUrl ||
      resource.provider !== expected.provider ||
      resource.protocol !== expected.protocol ||
      resource.credential !== expected.credential
    )
      throw new CoreError("CONFLICT", t("resources.configChanged"));
    return accountRequest<{ token: string; expiresAt: number }>(
      await this.connection(source.connectionId),
      `/api/account/resources/${source.resourceId}/access`,
      "POST",
      { forceRefresh: force },
    );
  }
  async publish(connectionId: string, input: Record<string, unknown>) {
    return accountRequest<AccountResource>(
      await this.connection(connectionId),
      "/api/account/resources",
      "PUT",
      input,
    );
  }
  async accessToken(qualifiedId: string, forceRefresh = false) {
    const [connectionId, resourceId, extra] = qualifiedId.split("/");
    if (!connectionId || !resourceId || extra)
      throw new Error("Invalid hosted resource reference.");
    return accountRequest<{ token: string; expiresAt: number }>(
      await this.connection(connectionId),
      `/api/account/resources/${resourceId}/access`,
      "POST",
      { forceRefresh },
    );
  }
  async disconnect(qualifiedId: string) {
    const [connectionId, resourceId, extra] = qualifiedId.split("/");
    if (!connectionId || !resourceId || extra)
      throw new Error("Invalid hosted resource reference.");
    await accountRequest(
      await this.connection(connectionId),
      `/api/account/resources/${resourceId}`,
      "DELETE",
    );
  }
}
