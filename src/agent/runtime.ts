import { COMPONENT_PARAMETER_CAPABILITIES } from "../portable/component-parameters.mjs";
import { CAPACITY } from "../portable/capacity.mjs";
import { access, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";
import { versionedLibrary } from "../core/library-runtime";
import { findViewerTemplate } from "./exporter";
import { GUIDE_TOPICS } from "./guides";
import { TEMPLATE_WORKFLOW_CAPABILITIES } from "../portable/template-bundle.mjs";
import { supportInfo } from "./support";

/** Tool names and parameters the installed plugin skills describe. */
export const TOOL_SURFACE_PROTOCOL = "showai-mcp-tools-v2";

export interface RuntimeLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}
/** Which kind of build registered itself; a packaged App replaces a development build of the same version. */
export type RuntimeChannel = "packaged" | "development";
export interface RuntimeRegistration {
  format: "showai-agent-runtime";
  protocol: 1;
  version: string;
  home: string;
  launch: RuntimeLaunch;
  channel?: RuntimeChannel;
  registeredAt?: string;
}

function validLaunch(launch: RuntimeLaunch) {
  if (
    !launch.command ||
    !launch.args.length ||
    launch.args.some((arg) => typeof arg !== "string")
  )
    throw new Error("A runtime launch needs a command and CLI arguments.");
}

/** Explicit registration: `runtime register` and 修复登记 always replace the file. */
export function registerRuntime(
  home: string,
  launch: RuntimeLaunch,
  channel?: RuntimeChannel,
) {
  return writeRuntimeRecord(
    join(resolve(home), "agent-runtime.json"),
    home,
    launch,
    channel,
  );
}

/**
 * Writes a registration at any path. A plugin bound to one runtime passes this path as
 * SHOWAI_RUNTIME_CONFIG, so another App registering in the library cannot rebind it.
 */
export async function writeRuntimeRecord(
  path: string,
  home: string,
  launch: RuntimeLaunch,
  channel?: RuntimeChannel,
) {
  validLaunch(launch);
  await access(launch.args[0]);
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.agent-runtime-${randomUUID()}.tmp`);
  const registration: RuntimeRegistration = {
    format: "showai-agent-runtime",
    protocol: 1,
    version,
    home: resolve(home),
    launch,
    ...(channel ? { channel } : {}),
    registeredAt: new Date().toISOString(),
  };
  await writeFile(temporary, JSON.stringify(registration, null, 2) + "\n");
  await rename(temporary, path);
  return { path, version, home: resolve(home), launch };
}

/** Numeric x.y.z comparison; pre-release and build suffixes are ignored. */
export function compareVersions(left: string, right: string) {
  const parts = (value: string) =>
    value
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(left),
    b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

const reachable = (path: string) =>
  access(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
      throw error;
    },
  );

export type RegistrationState =
  /** This App's launch is registered. */
  | "current"
  /** Another App or build is registered. */
  | "other"
  | "missing"
  | "invalid";
export interface RuntimeRegistrationStatus {
  path: string;
  state: RegistrationState;
  /** How another registration compares with this App. */
  reason?: "newer" | "same-version" | "older" | "unreachable" | "other-library";
  registered?: {
    version: string;
    command: string;
    entry: string;
    protocol: number;
    home: string;
    channel?: RuntimeChannel;
    registeredAt?: string;
  };
  current: { version: string; entry: string };
}

/** Reads agent-runtime.json and compares it with this App's launch. */
export async function runtimeRegistrationStatus(
  home: string,
  launch: RuntimeLaunch,
  channel?: RuntimeChannel,
): Promise<RuntimeRegistrationStatus> {
  const path = join(resolve(home), "agent-runtime.json");
  const current = { version, entry: launch.args[0] };
  const text = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (text === undefined) return { path, state: "missing", current };
  let value: Partial<RuntimeRegistration> | undefined;
  try {
    value = JSON.parse(text);
  } catch {
    // A damaged registration is a state the person repairs, not a startup failure.
    return { path, state: "invalid", current };
  }
  if (
    value?.format !== "showai-agent-runtime" ||
    value.protocol !== 1 ||
    typeof value.version !== "string" ||
    typeof value.home !== "string" ||
    typeof value.launch?.command !== "string" ||
    !Array.isArray(value.launch.args) ||
    typeof value.launch.args[0] !== "string"
  )
    return { path, state: "invalid", current };
  const registered = {
    version: value.version,
    command: value.launch.command,
    entry: value.launch.args[0],
    protocol: value.protocol,
    home: value.home,
    ...(value.channel ? { channel: value.channel } : {}),
    ...(value.registeredAt ? { registeredAt: value.registeredAt } : {}),
  };
  if (
    registered.command === launch.command &&
    registered.entry === launch.args[0] &&
    resolve(registered.home) === resolve(home)
  )
    return { path, state: "current", registered, current };
  const order = compareVersions(registered.version, version);
  const reason =
    resolve(registered.home) !== resolve(home)
      ? "other-library"
      : !(await reachable(registered.command)) ||
          !(await reachable(registered.entry))
        ? "unreachable"
        : order > 0
          ? "newer"
          : order < 0 ||
              (registered.channel !== "packaged" && channel === "packaged")
            ? "older"
            : "same-version";
  return { path, state: "other", reason, registered, current };
}

/**
 * Startup registration. Replaces only a missing, invalid, unreachable or older
 * registration, or this App's own; another valid App or build is kept, so the last
 * started instance does not silently take over the library's plugin connection.
 */
export async function registerRuntimeOnStartup(
  home: string,
  launch: RuntimeLaunch,
  channel: RuntimeChannel,
) {
  validLaunch(launch);
  const status = await runtimeRegistrationStatus(home, launch, channel);
  if (
    status.state === "other" &&
    (status.reason === "newer" || status.reason === "same-version")
  ) {
    process.stderr.write(
      `ShowAI kept the registered runtime ${status.registered!.version} (${status.registered!.entry}). Use Settings → Plugins → Repair registration to register this App.\n`,
    );
    return { ...status, written: false };
  }
  await registerRuntime(home, launch, channel);
  return {
    ...(await runtimeRegistrationStatus(home, launch, channel)),
    written: true,
  };
}
export async function runtimeInfo(home: string) {
  const viewer = await findViewerTemplate();
  const archive = join(dirname(viewer), "reader-source.json");
  const hasArchive = await access(archive).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  const library = versionedLibrary(home);
  return {
    version,
    protocol: 1,
    capacities: { unit: "bytes", ...CAPACITY },
    capabilities: {
      componentParameters: COMPONENT_PARAMETER_CAPABILITIES,
      boardReading: {
        protocol: "showai-board-reading-v1",
        tool: "board_read",
        defaultView: "visual",
        snapshotMinutes: 30,
      },
      templateWorkflow: TEMPLATE_WORKFLOW_CAPABILITIES,
      presentation: {
        independentOfProject: true,
        publicCatalog: true,
        customization: true,
        outputs: ["inline", "html", "source", "mcp-app"],
      },
      collaboration: {
        localLibrary: true,
        projectSynchronization: true,
        displayRequired: false,
      },
      transports: ["cli", "stdio-mcp", "streamable-http-mcp"],
      agentOperations: {
        protocol: "showai-mcp-v1",
        entry: "mcp",
        libraryProjects: true,
        pagePresent: true,
        workspaceManagement: "showai-workspace-management-v1",
        toolSurface: TOOL_SURFACE_PROTOCOL,
      },
      remoteAuthentication: "oauth2-project-grants",
    },
    storage: library
      ? {
          mode: "versioned",
          version: 2,
          libraryId: (await library.manifest()).id,
        }
      : { mode: "legacy", version: 1 },
    projectResolution: { mode: "directory", command: "projects current" },
    home: resolve(home),
    viewer,
    readerCompilation: {
      mode: hasArchive ? "page-dependencies" : "prebuilt",
      sourceArchive: hasArchive ? archive : null,
    },
    guideTopics: GUIDE_TOPICS,
    support: await supportInfo(),
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
