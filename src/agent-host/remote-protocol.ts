/** Wire contract shared by iOS, Cloudflare and the outbound desktop connector. */
export const defaultAgentGateway = "https://run.showai.renaissancemind.ai";
export interface RemoteActor {
  serverUrl: string;
  token: string;
  serverId: string;
  userId: string;
}
export interface AgentDestination {
  id: string;
  name: string;
  kind: "cloud" | "mac";
  online: boolean;
  projectIds?: string[];
}
export interface AgentInvocation {
  action: string;
  args: Record<string, unknown>;
  requestId: string;
  destination: string;
  projectId?: string;
  clientId?: string;
  clientName?: string;
}
export const remoteReadActions = new Set([
  "agent:status",
  "agent:conversations",
  "agent:conversation",
  "agent:turn",
  "agent:readFile",
]);
export const remoteTaskActions = new Set([
  ...remoteReadActions,
  "agent:send",
  "agent:undo",
  "agent:deleteConversation",
  "agent:cancel",
  "agent:permission",
]);
export const remoteCloudActions = new Set([
  ...remoteTaskActions,
  "agent:settings",
  "agent:source",
  "agent:removeSource",
  "agent:models",
  "agent:authorize",
  "agent:cancelAuth",
  "agent:disconnect",
  "agent:install",
  "agent:scan",
  "agent:serverResources",
  "agent:addServerResource",
  "agent:publishSource",
  "agent:start",
]);
export function invocation(input: unknown): AgentInvocation {
  const value = input as AgentInvocation;
  if (
    !value ||
    !remoteCloudActions.has(value.action) ||
    !value.args ||
    typeof value.args !== "object" ||
    Array.isArray(value.args) ||
    !/^[a-f0-9-]{36}$/.test(value.requestId) ||
    !/^(cloud|[a-f0-9-]{36})$/.test(value.destination)
  )
    throw new Error("Invalid Agent request.");
  if (value.projectId && !/^[\w-]{1,200}$/.test(value.projectId))
    throw new Error("Invalid project.");
  if (value.clientId && !/^[\w-]{1,200}$/.test(value.clientId))
    throw new Error("Invalid client device.");
  return {
    action: value.action,
    args: value.args,
    requestId: value.requestId,
    destination: value.destination,
    ...(value.projectId ? { projectId: value.projectId } : {}),
    ...(value.clientId
      ? {
          clientId: value.clientId,
          clientName: String(value.clientName ?? "ShowAI device").slice(0, 100),
        }
      : {}),
  };
}
export function secureGateway(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      ))
  )
    throw new Error("Agent gateway requires HTTPS.");
  return url.origin;
}
