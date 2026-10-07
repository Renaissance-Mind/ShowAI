import { extname, join } from "node:path";
import { lstat, readdir, rm } from "node:fs/promises";
import { GitLibrary } from "./git-library";
import { WorkspaceProtection, workspaceHash } from "./workspace-conflicts";
import { withLibraryLock } from "./library-lock";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "./library-files";
import { EditorDrafts } from "./editor-drafts";
import {
  getComponent,
  readComponentSource,
  getTemplate,
  packageRevisionRef,
} from "./catalog";
import { CoreError } from "./model";
import type {
  ComponentManifest,
  ComponentSource,
  TemplateRecord,
} from "../components/custom/types";
const packagePath =
  /^(?:projects\/([^/]+)\/)?packages\/(?:published\/)?(components|templates)\/([a-z][a-z0-9-]*)\/([^/]+)\/(.+)$/;
const textFiles = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".md",
  ".txt",
  ".svg",
]);
const nextVersion = (value: string) => {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match)
    throw new CoreError("INVALID_DATA", "The package needs a valid version.");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
};
function parsed<T>(raw: string, fallback: T): { value: T; issue?: string } {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { value: fallback, issue: "Package metadata must be an object." };
    return { value: { ...fallback, ...value } as T };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { value: fallback, issue: error.message };
  }
}
const lines = (value: unknown, fallback: string[]) =>
  (Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback
  ).join("\n");
/** Discovers added source files as well as edits/deletions of immutable packages. */
async function inspectWorkspaceResources(
  library: GitLibrary,
  projectId?: string,
) {
  const head = await library.head();
  if (!head) return [];
  const paths = new Set(
    (await library.tree(head))
      .map((entry) => entry.path)
      .filter(
        (path) =>
          (packagePath.test(path) ||
            /^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)) &&
          (!projectId || path.startsWith(`projects/${projectId}/`)),
      ),
  );
  const roots = projectId
    ? [`projects/${projectId}/packages`]
    : [
        "packages",
        ...new Set(
          [...paths]
            .map((path) => path.match(/^projects\/[^/]+\/packages/)?.[0])
            .filter((path): path is string => !!path),
        ),
      ];
  async function visit(path: string) {
    const absolute = join(library.workspace, path);
    await safeLibraryPath(library.root, absolute);
    const info = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return;
    if (info.isDirectory())
      for (const name of await readdir(absolute)) {
        if (
          ["node_modules", ".git"].includes(name) ||
          name.startsWith(".source-")
        )
          continue;
        await visit(`${path}/${name}`);
      }
    else if (info.isFile() && packagePath.test(path)) paths.add(path);
  }
  for (const root of roots) await visit(root);
  const protection = new WorkspaceProtection(library),
    conflicts = [],
    all = [...paths];
  for (let offset = 0; offset < all.length; offset += 16)
    conflicts.push(
      ...(await protection.inspect(all.slice(offset, offset + 16), head)),
    );
  return conflicts;
}
export async function scanWorkspaceResources(
  library: GitLibrary,
  projectId?: string,
) {
  return withLibraryLock(library.root, () =>
    inspectWorkspaceResources(library, projectId),
  );
}
export async function recoverExternalPackage(
  library: GitLibrary,
  input: {
    id: string;
    clientId: string;
    targetProjectId?: string;
    boundProject?: string;
  },
) {
  const result = await withLibraryLock(library.root, async () => {
    const protection = new WorkspaceProtection(library),
      selected = await protection.input(input.id),
      match = selected.conflict.path.match(packagePath);
    if (!match || (input.boundProject && match[1] !== input.boundProject))
      throw new CoreError(
        "INVALID_PATH",
        "This conflict is not a package in the bound project.",
      );
    if (selected.conflict.state !== "unresolved")
      throw new CoreError(
        "CONFLICT",
        "This package modification has already been resolved.",
      );
    const prefix = selected.conflict.path.slice(0, -match[5].length),
      owner = match[1],
      kind = match[2],
      id = match[3],
      version = match[4],
      scope = owner
        ? "project"
        : prefix.startsWith("packages/published/")
          ? "published"
          : "global";
    const head = await library.head();
    if (!head)
      throw new CoreError(
        "NOT_FOUND",
        "The package has no committed baseline.",
      );
    await inspectWorkspaceResources(library, owner);
    const pending = (await protection.list()).filter(
      (item) => item.state === "unresolved" && item.path.startsWith(prefix),
    );
    const base = (await library.tree(head)).filter((item) =>
      item.path.startsWith(prefix),
    );
    const originals = await library.readFiles(
        base.map((item) => item.path),
        head,
      ),
      overlay = new Map(
        [...originals].map(([path, bytes]) => [
          path.slice(prefix.length),
          bytes,
        ]),
      );
    const attachments: Record<string, string | null> = {};
    for (const conflict of pending) {
      const retained = await protection.input(conflict.id),
        actual = await readLibraryBytes(
          library.root,
          join(library.workspace, conflict.path),
        );
      if (workspaceHash(conflict.path, actual) !== conflict.observedHash)
        throw new CoreError(
          "CONFLICT",
          "The package changed after its recovery preview. Latest bytes were retained.",
        );
      const path = conflict.path.slice(prefix.length);
      attachments[path] = retained.bytes ? `conflict:${conflict.id}` : null;
      if (retained.bytes === null) overlay.delete(path);
      else overlay.set(path, retained.bytes);
    }
    const targetProject = input.targetProjectId ?? owner;
    if (input.boundProject && targetProject !== input.boundProject)
      throw new CoreError(
        "INVALID_PATH",
        "Recovery cannot write another project's draft.",
      );
    let content: Record<string, unknown>, title: string;
    if (kind === "components") {
      const compiled = await getComponent(library.root, id, version, owner, {
        scope,
      });
      let source: ComponentSource;
      try {
        source = await readComponentSource(library.root, id, version, owner, {
          scope,
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("no editable source")
        )
          throw error;
        source = {
          manifest: {
            id,
            version,
            name: compiled.name,
            description: compiled.description,
            scenarios: compiled.scenarios,
            effects: compiled.effects,
            category: compiled.category,
            entry: "Component.tsx",
            defaultData: compiled.defaultData,
            examples: compiled.examples,
          },
          schema: compiled.schema,
          source: "",
          files: {},
          assets: {},
        };
      }
      const manifestJson = overlay.get("manifest.json")?.toString("utf8") ?? "",
        manifestResult = parsed<ComponentManifest>(
          manifestJson,
          source.manifest,
        ),
        manifest = manifestResult.value;
      const files: Record<string, string> = {},
        assets: Record<string, string> = {};
      for (const [name, bytes] of overlay) {
        if (["compiled.json", "component-ref.json"].includes(name)) continue;
        if (textFiles.has(extname(name))) files[name] = bytes.toString("utf8");
        else assets[name] = bytes.toString("base64");
      }
      const entry =
        typeof manifest.entry === "string"
          ? manifest.entry.replace(/^\.\//, "")
          : source.manifest.entry;
      const workingSource: ComponentSource = {
        ...source,
        manifest: { ...source.manifest, ...manifest },
        files,
        assets,
        source: files[entry] ?? "",
      };
      title = typeof manifest.name === "string" ? manifest.name : compiled.name;
      content = {
        code: workingSource.source,
        schema: files["props.schema.json"] ?? "",
        defaults: JSON.stringify(
          manifest.defaultData ?? compiled.defaultData,
          null,
          2,
        ),
        examplesJson: JSON.stringify(
          manifest.examples ?? compiled.examples,
          null,
          2,
        ),
        name: title,
        description:
          typeof manifest.description === "string"
            ? manifest.description
            : compiled.description,
        scenarios: lines(manifest.scenarios, compiled.scenarios),
        effects: lines(manifest.effects, compiled.effects ?? []),
        version: nextVersion(version),
        componentId: id,
        category: manifest.category ?? compiled.category ?? "other",
        source: workingSource,
        origin: {
          ...packageRevisionRef("component", compiled),
          ...(owner ? { projectId: owner } : {}),
        },
        manifestJson: manifestJson || JSON.stringify(source.manifest, null, 2),
        manifestIssue: manifestResult.issue,
        recoveryFiles: attachments,
      };
    } else {
      const template = await getTemplate(library.root, id, owner, {
          scope,
          version,
        }),
        rawTemplate = overlay.get("template.json")?.toString("utf8") ?? "",
        templateResult = parsed<TemplateRecord>(rawTemplate, template),
        value = templateResult.value;
      title = typeof value.name === "string" ? value.name : template.name;
      content = {
        name: title,
        description:
          typeof value.description === "string"
            ? value.description
            : template.description,
        version: nextVersion(version),
        document: value.document ?? template.document,
        scenarios: lines(value.scenarios, template.scenarios ?? []),
        contentGuide: value.contentGuide ?? [],
        related: value.related ?? [],
        examples: value.examples ?? [],
        parts: value.composition ?? [],
        origin: {
          ...packageRevisionRef("template", template),
          ...(owner ? { projectId: owner } : {}),
        },
        rawTemplate,
        templateIssue: templateResult.issue,
        recoveryFiles: attachments,
      };
    }
    const draft = await new EditorDrafts(library.root).save({
      kind: kind === "components" ? "component" : "template",
      clientId: input.clientId,
      resourceId: id,
      projectId: targetProject,
      title,
      baseRevision: head,
      content,
      actor: { kind: "external" },
    });
    for (const conflict of pending) {
      const actual = await readLibraryBytes(
        library.root,
        join(library.workspace, conflict.path),
      );
      if (workspaceHash(conflict.path, actual) !== conflict.observedHash) {
        const newer = await protection.capture(
          conflict.path,
          head,
          actual,
          originals.has(conflict.path),
        );
        throw new CoreError(
          "CONFLICT",
          "外部文件在草稿保存期间又有修改，草稿与最新外部版本都已保留。",
          { conflictId: newer.id },
        );
      }
    }
    // The full external input is durable. Return each immutable version projection
    // to committed bytes without assigning those bytes a new package identity.
    for (const conflict of pending) {
      const target = join(library.workspace, conflict.path),
        current = originals.get(conflict.path);
      if (current) await atomicLibraryFile(library.root, target, current);
      else await rm(target, { force: true });
      await protection.resolve(conflict.id, "import", head);
    }
    return {
      draft,
      package: {
        kind:
          kind === "components"
            ? ("component" as const)
            : ("template" as const),
        id,
        version,
        scope,
        ...(owner ? { projectId: owner } : {}),
      },
      conflicts: pending.map((item) => item.id),
    };
  });
  await library.recover();
  return result;
}
