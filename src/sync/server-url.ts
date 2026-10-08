import { SyncError, digestId, identifier } from "./protocol";

/** A server base includes its deployment prefix, never /api or a resource. */
export function serverBaseUrl(input: string): string {
  const invalid = () =>
    new SyncError(
      400,
      "INVALID_SERVER_URL",
      "填写服务器基址，例如 https://showai.example.com/cloud。",
    );
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalid();
  }
  // Inspect the source too: URL normalizes dot segments and backslashes.
  const rawPath = input.match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? "";
  if (
    input !== input.trim() ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\\\s%?#]/.test(input) ||
    (rawPath &&
      !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/.test(rawPath)) ||
    rawPath.replace(/\/$/, "") !== url.pathname.replace(/\/$/, "") ||
    /\/(?:api|join|health)$/.test(url.pathname.replace(/\/$/, ""))
  )
    throw invalid();
  return url.origin + url.pathname.replace(/\/$/, "");
}

export function serverEndpoint(base: string, path: string): string {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\#]/.test(path) ||
    path
      .split("?")[0]
      .split("/")
      .some((part) => part === "." || part === "..")
  )
    throw new SyncError(400, "INVALID_SERVER_PATH", "Invalid server endpoint.");
  return serverBaseUrl(base) + path;
}

export function invitationUrl(
  base: string,
  invite: string,
  serverId?: string,
): URL {
  const url = new URL(serverEndpoint(base, "/join"));
  url.hash = new URLSearchParams({
    invite: digestId(invite),
    ...(serverId ? { server: identifier(serverId) } : {}),
  }).toString();
  return url;
}

export function invitationBaseUrl(link: string): string {
  const url = new URL(link);
  if (link.includes("?") || !url.pathname.endsWith("/join"))
    throw new SyncError(400, "INVALID_INVITE", "Invalid invitation URL.");
  return serverBaseUrl(link.split("#")[0].slice(0, -5));
}

export function deepLinkInvitation(source: string): URL {
  const url = new URL(source);
  if (
    url.protocol !== "showai:" ||
    url.hostname !== "join" ||
    url.pathname ||
    url.hash
  )
    throw new SyncError(400, "INVALID_INVITE", "Invalid invitation deep link.");
  return invitationUrl(
    serverBaseUrl(url.searchParams.get("server") ?? ""),
    digestId(url.searchParams.get("invite")),
    url.searchParams.get("serverId") ?? undefined,
  );
}
