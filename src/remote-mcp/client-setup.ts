import type { Locale } from "../i18n";
import type {
  PairingStatus,
  RemoteMcpConfig,
  RemoteMcpProvider,
} from "./types";

export const isTailscaleProvider = (provider: RemoteMcpProvider) =>
  provider === "tailscale" || provider === "tailscale-private";

export const isPublicProvider = (provider: RemoteMcpProvider) =>
  provider === "cloudflare" ||
  provider === "cloudflare-quick" ||
  provider === "tailscale";

export function oauthSetupValues(endpoint: string) {
  const url = new URL(endpoint);
  return {
    authorization: `${url.origin}/oauth/authorize`,
    token: `${url.origin}/oauth/token`,
    registration: `${url.origin}/oauth/register`,
    issuer: url.origin,
    resource: endpoint,
  };
}
export function pairingDisplay(
  receipt: { id?: string; expiresAt: string } | undefined,
  current: PairingStatus | undefined,
  now = Date.now(),
): "none" | "ready" | "used" | "expired" | "replaced" {
  if (!receipt) return "none";
  if (current?.id === receipt.id && current?.state === "used") return "used";
  if (
    current &&
    current.id !== receipt.id &&
    Date.parse(current.expiresAt) >= Date.parse(receipt.expiresAt)
  )
    return "replaced";
  return now >= Date.parse(receipt.expiresAt) ? "expired" : "ready";
}

export function agentSetupPrompt(
  address: string,
  config: RemoteMcpConfig,
  locale: Locale,
  invitation?: string,
) {
  const url = new URL(address);
  const endpoint = url.href;
  if (
    (config.provider === "tailscale-private" &&
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i.test(url.hostname)) ||
    url.pathname !== "/mcp" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (config.provider === "lan"
      ? url.protocol !== "http:"
      : url.protocol !== "https:")
  )
    throw new Error("Invalid MCP endpoint.");
  const zh = locale === "zh-CN";
  const bridge = "mcp-remote@0.16.6";
  let setup: string;
  if (
    config.provider === "tailscale-private" &&
    config.privateAuth === "device"
  ) {
    const command = `npx --prefer-offline -y ${bridge} ${endpoint} --transport http-only`;
    setup = zh
      ? `请在已接入我 Tailscale 私网的设备上配置。Grok Bot 请用「Add MCP server」选择 Command / stdio，连接名为「ShowAI 私网直连」，命令为 \`${command}\`。仅支持 stdio 的客户端也可使用此命令。其他远程 MCP 客户端选择 Streamable HTTP，认证字段留空。ShowAI 首次会在我的电脑上请求批准这台设备。`
      : `Configure this on your device on my Tailscale network. In Grok Bot, use Add MCP server, choose Command / stdio, name the connection “ShowAI Private”, and use the command \`${command}\`. Stdio-only clients can use the same command. Other remote MCP clients can use Streamable HTTP with empty authentication fields. ShowAI will ask me to approve a new device on my computer.`;
  } else if (config.provider === "lan") {
    if (!invitation || !/^[A-Za-z0-9_-]{24}$/.test(invitation))
      throw new Error("A current LAN invitation is required.");
    const register = url.origin + "/connect/request";
    setup = zh
      ? `在可信局域网内配置 Streamable HTTP。请用本机凭据存储安全生成并保存 32 字节随机 base64url 密钥，对密钥文本取 SHA-256 小写十六进制摘要。向 ${register} POST JSON {"invite":"${invitation}","name":"你的客户端名称","keyHash":"摘要"}。收到 202 后在客户端设置 Authorization: Bearer 加上该密钥，等待我在 ShowAI 允许。密钥只保存在客户端。`
      : `On the trusted LAN, configure Streamable HTTP. Securely generate and save a random 32-byte base64url key in your local credential store. POST JSON {"invite":"${invitation}","name":"your client name","keyHash":"lowercase SHA-256 hex of the key text"} to ${register}. After HTTP 202, set Authorization: Bearer with that key locally and wait for me to approve in ShowAI. Keep the key in the client's secret store.`;
  } else if (config.provider === "tailscale-private") {
    const scopes = [
      "projects.read",
      ...(config.access === "all" || config.projects.some((p) => p.write)
        ? ["projects.write"]
        : []),
      ...(config.access === "all" ? ["projects.create"] : []),
    ];
    const command = `npx -y ${bridge} ${endpoint} --transport http-only --resource ${endpoint} --auth-timeout 300 --static-oauth-client-metadata '${JSON.stringify({ scope: scopes.join(" "), client_name: "ShowAI Agent" })}'`;
    setup = zh
      ? `使用私网 OAuth。在同一 tailnet 的设备上将此命令添加为 stdio MCP：${command}。使用本机回环回调并等待我在 ShowAI 允许。`
      : `Use private OAuth. Register this stdio MCP command on your device on the same tailnet: ${command}. Use the local loopback callback and wait for my approval in ShowAI.`;
  } else {
    setup = zh
      ? "配置远程 Streamable HTTP 和 OAuth 自动发现及动态客户端注册，按服务声明完成授权。"
      : "Configure remote Streamable HTTP with OAuth discovery and dynamic client registration, then complete the advertised authorization flow.";
  }
  return zh
    ? `请为你自己接入 ShowAI：${endpoint} 。${setup}复用地址和传输方式都匹配的连接，保留其他连接。配置完成后实际调用 projects_list，等待批准时自动重试，只告诉我项目数量或具体失败原因。`
    : `Connect yourself to ShowAI at ${endpoint}. ${setup} Reuse a connection that matches both the endpoint and transport, and keep other connections. Call projects_list, retry while approval is pending, and report only the project count or the specific failure.`;
}
