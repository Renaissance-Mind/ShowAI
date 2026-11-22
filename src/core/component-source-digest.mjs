import { createHash } from "node:crypto";

export const SOURCE_EXTENSIONS = new Set([
  ".html",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".woff2",
]);

export function sourceDigest(files) {
  const hash = createHash("sha256");
  for (const [name, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    hash.update(name).update("\0").update(content).update("\0");
  return `sha256-${hash.digest("hex")}`;
}
