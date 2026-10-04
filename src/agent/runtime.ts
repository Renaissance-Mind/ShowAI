import { access, mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import { findViewerTemplate } from "./exporter";
import { GUIDE_TOPICS } from "./guides";
export interface RuntimeLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}
export async function registerRuntime(home: string, launch: RuntimeLaunch) {
  if (
    !launch.command ||
    !launch.args.length ||
    launch.args.some((arg) => typeof arg !== "string")
  )
    throw new Error("A runtime launch needs a command and CLI arguments.");
  await access(launch.args[0]);
  const path = join(resolve(home), "agent-runtime.json");
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.agent-runtime-${randomUUID()}.tmp`);
  await writeFile(
    temporary,
    JSON.stringify(
      {
        format: "showai-agent-runtime",
        protocol: 1,
        version,
        home: resolve(home),
        launch,
      },
      null,
      2,
    ) + "\n",
  );
  await rename(temporary, path);
  return { path, version, home: resolve(home), launch };
}
export async function runtimeInfo(home: string) {
  return {
    version,
    protocol: 1,
    home: resolve(home),
    viewer: await findViewerTemplate(),
    guideTopics: GUIDE_TOPICS,
    launch: {
      command: process.execPath,
      args: [
        process.env.SHOWAI_RUNTIME_ENTRY ?? fileURLToPath(import.meta.url),
      ],
      env: {
        SHOWAI_HOME: resolve(home),
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
    } satisfies RuntimeLaunch,
  };
}
