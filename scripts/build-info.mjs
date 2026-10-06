import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
export function buildIdentity() {
  const { version } = JSON.parse(
    readFileSync(join(repository, "package.json"), "utf8"),
  );
  let sourceCommit = process.env.SHOWAI_SOURCE_COMMIT || "unknown",
    sourceDirty = null;
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    sourceDirty = !!execFileSync("git", ["status", "--porcelain"], {
      cwd: repository,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* Source archives may supply SHOWAI_SOURCE_COMMIT; absence stays explicit. */
  }
  return {
    version,
    pageModelVersion: 2,
    supportedArtifactVersions: [1, 2],
    sourceCommit,
    sourceDirty,
  };
}
export function frontendManifest(directory = join(repository, "dist")) {
  const files = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".css") ||
        entry.name === "index.html"
      )
        files[relative(directory, path).replaceAll("\\", "/")] = createHash(
          "sha256",
        )
          .update(readFileSync(path))
          .digest("hex");
    }
  };
  walk(directory);
  return { ...buildIdentity(), frontendFiles: files };
}
export function buildIdentityPlugin() {
  const identity = buildIdentity();
  return {
    name: "showai-build-identity",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { name: "showai-version", content: identity.version },
        injectTo: "head",
      },
      {
        tag: "meta",
        attrs: {
          name: "showai-model",
          content: String(identity.pageModelVersion),
        },
        injectTo: "head",
      },
      {
        tag: "meta",
        attrs: { name: "showai-source", content: identity.sourceCommit },
        injectTo: "head",
      },
    ],
  };
}
