import { serverBaseUrl } from "../sync/server-url";

export function serverPrefixes(publicUrl?: string, aliases: string[] = []) {
  if (!Array.isArray(aliases) || aliases.length > 8)
    throw new Error(
      "Server path aliases must be an array of at most eight prefixes.",
    );
  const preferred = publicUrl
    ? new URL(serverBaseUrl(publicUrl)).pathname.replace(/\/$/, "")
    : "";
  for (const prefix of aliases)
    if (
      typeof prefix !== "string" ||
      new URL(serverBaseUrl("http://localhost" + prefix)).pathname.replace(
        /\/$/,
        "",
      ) !== prefix
    )
      throw new Error(
        "Server path aliases must be normalized deployment prefixes.",
      );
  return [...new Set([preferred, ...aliases])].sort(
    (a, b) => b.length - a.length,
  );
}

export function matchedPrefix(prefixes: string[], pathname: string) {
  return prefixes.find(
    (prefix) =>
      !prefix || pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}
