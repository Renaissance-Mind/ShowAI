import { createHash } from "node:crypto";
import { universalPluginArchive } from "../plugin/universal-package.mjs";

export function chatgptAppId(value: string) {
  const text = value.trim();
  if (/^asdk_app_[A-Za-z0-9]+$/.test(text)) return text;
  if (/^plugin_asdk_app_[A-Za-z0-9]+$/.test(text)) return text.slice(7);
  const url = new URL(text);
  const match = url.pathname.match(
    /^\/plugins\/plugin_(asdk_app_[A-Za-z0-9]+)\/?$/,
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "chatgpt.com" ||
    url.username ||
    url.password ||
    !match
  )
    throw new Error(
      "Use the ChatGPT page link of your registered custom MCP connection.",
    );
  return match[1];
}

export async function remotePluginPackage(
  source: string,
  endpoint?: string,
  connection?: string,
) {
  let url: URL | undefined;
  if (endpoint !== undefined) {
    url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/mcp"
    )
      throw new Error("A public HTTPS MCP endpoint is required.");
  }
  if ((url === undefined) !== (connection === undefined))
    throw new Error(
      "Provide both the endpoint and the registered ChatGPT connection, or neither.",
    );
  const linked =
    url && connection !== undefined
      ? {
          name: `showai-personal-${createHash("sha256").update(url.href).digest("hex").slice(0, 12)}`,
          displayName: "ShowAI Personal",
          appId: chatgptAppId(connection),
          appAlias: "showai",
        }
      : undefined;
  return {
    ...(await universalPluginArchive(source, linked)),
    ...(url && { endpoint: url.href }),
  };
}
