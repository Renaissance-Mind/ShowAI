import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import { SUPPORT_DOCS_URL, SUPPORT_REPORT_URL } from "../core/support-channels";

export { SUPPORT_DOCS_URL, SUPPORT_REPORT_URL };

async function sourceCommit() {
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../assets/build.json",
  );
  const build = await readFile(path, "utf8").then(
    (text) => JSON.parse(text) as { sourceCommit?: unknown },
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return typeof build?.sourceCommit === "string"
    ? build.sourceCommit
    : process.env.SHOWAI_SOURCE_COMMIT || "unknown";
}

export async function supportInfo() {
  return {
    reportUrl: SUPPORT_REPORT_URL,
    docsUrl: SUPPORT_DOCS_URL,
    version,
    sourceCommit: await sourceCommit(),
    appPath: "设置 → 关于与反馈",
    appPathEn: "Settings → About & feedback",
  };
}
