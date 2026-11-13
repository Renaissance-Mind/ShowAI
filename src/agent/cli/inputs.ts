import { CAPACITY, assertBytes } from "../../portable/capacity.mjs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ReadBaselines } from "../../core/read-baselines";
import type { ProjectBinding, ShowDocument } from "../../core/model";
import { parseArtifact, validateDocument } from "../../portable/validation.mjs";
import type { CatalogScope, CompiledComponent } from "../../contract/types";
import type { PublishedComponentLocator } from "../../core/publication";
import { CATALOG_VIEWS, type CatalogView } from "../disclosure";
import { assertExportDestination } from "../exporter";
import type { ResponseProfile } from "../mcp-response";
import type { AgentService } from "../service";
import { option, type Arguments } from "./command";

// Reading command inputs: JSON files (or stdin), documents and the option
// values several commands share.

export async function readJson(path: string): Promise<unknown> {
  let data: string;
  if (path === "-") {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      assertBytes("CLI authoring input", bytes, CAPACITY.authoringRequestBytes);
      chunks.push(buffer);
    }
    data = Buffer.concat(chunks).toString("utf8");
  } else {
    assertBytes(
      "CLI authoring input",
      (await stat(resolve(path))).size,
      CAPACITY.authoringRequestBytes,
    );
    data = await readFile(resolve(path), "utf8");
  }
  assertBytes(
    "CLI authoring input",
    Buffer.byteLength(data),
    CAPACITY.authoringRequestBytes,
  );
  return JSON.parse(data);
}

export async function readDocument(path: string): Promise<{
  document: ShowDocument;
  components?: CompiledComponent[];
  remoteComponents?: PublishedComponentLocator[];
}> {
  const input = await readJson(path);
  return input && typeof input === "object" && "format" in input
    ? parseArtifact(input)
    : { document: validateDocument(input) };
}

export function binding(
  args: Arguments,
  required = false,
): ProjectBinding | undefined {
  const harness = option(args, "harness", required);
  const sessionId = option(args, "session", required);
  if (!!harness !== !!sessionId)
    throw new Error("--harness and --session must be provided together.");
  return harness && sessionId
    ? {
        harness,
        sessionId,
        ...(option(args, "source-directory")
          ? { sourceDirectory: resolve(option(args, "source-directory")!) }
          : {}),
      }
    : undefined;
}

/** pages save/apply reply with a receipt unless --response asks for the document. */
export function responseProfile(args: Arguments): ResponseProfile {
  const value = option(args, "response") ?? "receipt";
  if (!["receipt", "source", "full"].includes(value))
    throw new Error("--response must be receipt, source or full.");
  return value as ResponseProfile;
}

export function objectInput(
  value: unknown,
  label = "input",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}
export function catalogScope(
  args: Arguments,
  allowAll = true,
): CatalogScope | "all" | undefined {
  const value = option(args, "scope");
  if (!value) return;
  const scope = value === "user" ? "global" : value;
  if (
    ![
      "builtin",
      "global",
      "published",
      "project",
      ...(allowAll ? ["all"] : []),
    ].includes(scope)
  )
    throw new Error("--scope must be builtin, global, published or project.");
  return scope as CatalogScope | "all";
}
export function catalogView(args: Arguments): CatalogView {
  const view = option(args, "view") ?? "summary";
  if (!CATALOG_VIEWS.includes(view as CatalogView))
    throw new Error(`--view must be one of ${CATALOG_VIEWS.join(", ")}.`);
  return view as CatalogView;
}
export function componentMode(args: Arguments): "bundled" | "remote" {
  const mode = option(args, "components") ?? "bundled";
  if (mode !== "bundled" && mode !== "remote")
    throw new Error("--components must be bundled or remote.");
  return mode;
}
export function readerMode(args: Arguments): "bundled" | "cdn" | undefined {
  const mode = option(args, "reader");
  if (mode !== undefined && mode !== "bundled" && mode !== "cdn")
    throw new Error("--reader must be bundled or cdn.");
  return mode;
}
export function resultLimit(args: Arguments): number | undefined {
  const text = option(args, "limit");
  if (text === undefined) return;
  if (!/^[0-9]+$/.test(text))
    throw new Error("--limit must be an integer from 1 to 50.");
  return Number(text);
}
export async function saveOutput(
  service: AgentService,
  args: Arguments,
  value: unknown,
) {
  const output = option(args, "out");
  if (!output) return;
  const path = resolve(output);
  const projectId =
    option(args, "project") ??
    (
      await service.currentProject({
        sourceDirectory: option(args, "source-directory"),
      })
    ).project.id;
  await assertExportDestination(
    service.store.root,
    service.requireProject(projectId),
    path,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    flag: args.options.overwrite ? "w" : "wx",
  });
  return path;
}

/**
 * The explicit --base-revision, or the revision the last `pages read` of this
 * page returned together with the given hash.
 */
export async function readRevision(
  service: AgentService,
  args: Arguments,
  projectId: string,
  pageId: string,
  baseHash: string,
) {
  return (
    option(args, "base-revision") ??
    new ReadBaselines(service.store.root).revision(projectId, pageId, baseHash)
  );
}
