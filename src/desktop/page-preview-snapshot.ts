import { ContentLibrary } from "../core/content-library";
import {
  libraryReadSnapshot,
  withLibrarySnapshot,
} from "../core/library-runtime";
import { resourceForPath } from "../core/history-model";
import { CoreError } from "../core/model";
import type { SqliteTreeEntry } from "../core/sqlite-reader";
import { collectCustomComponentRefs } from "../components/custom/contract";
import type { CustomComponentRef } from "../components/custom/types";
import type { ShowDocument } from "../types";

/** Compile against immutable input bytes after releasing the library's writer lease. */
class PreviewLibrary extends ContentLibrary {
  constructor(
    root: string,
    private readonly revision: string,
    private readonly entries: SqliteTreeEntry[],
    private readonly files: Map<string, Buffer>,
    private readonly revisions: Map<string, string | null>,
  ) {
    super(root);
  }
  override async head() {
    return this.revision;
  }
  override async tree() {
    return this.entries;
  }
  override async readFiles(paths: string[]) {
    return new Map(
      paths.map((path) => {
        const bytes = this.files.get(path);
        if (!bytes)
          throw new CoreError(
            "NOT_FOUND",
            `File missing in the preview snapshot: ${path}`,
          );
        return [path, bytes] as const;
      }),
    );
  }
  override async readFile(path: string) {
    return (await this.readFiles([path])).get(path)!;
  }
  override async resourceRevisions(paths: string[]) {
    return new Map(
      paths.map((path) => [
        path,
        this.revisions.get(path) ??
          (this.entries.some(
            (entry) => entry.path === path || entry.path.startsWith(path + "/"),
          )
            ? this.revision
            : null),
      ]),
    );
  }
  override async resourceRevision(path: string) {
    return (await this.resourceRevisions([path])).get(path)!;
  }
}

/** Library paths that can hold a referenced component revision, in catalog lookup order. */
function componentPackagePrefixes(
  projectId: string,
  ref: CustomComponentRef,
): string[] {
  const version = `${ref.componentId}/${ref.version}/`;
  return [
    `projects/${projectId}/packages/components/${version}`,
    `packages/components/${version}`,
    `packages/published/components/${version}`,
    ...(ref.integrity
      ? [
          `projects/${projectId}/packages/historical/components/${ref.integrity}/`,
        ]
      : []),
  ];
}

export async function pagePreviewSnapshot(
  home: string,
  projectId: string,
  pageId: string,
) {
  return withLibrarySnapshot(home, async () => {
    const snapshot = libraryReadSnapshot.getStore();
    if (!snapshot?.revision) return;
    const tree = await snapshot.library.treeFiles(snapshot.revision);
    const page = `projects/${projectId}/pages/${pageId}`;
    const project = `projects/${projectId}/`;
    const paths = tree
      .map((entry) => entry.path)
      .filter(
        (path) =>
          path === `${page}.json` ||
          (path.startsWith(page + "/") && !path.includes("/nodes/")) ||
          path === `${project}project.json`,
      );
    const files = await snapshot.library.readFiles(paths, snapshot.revision);
    // Freeze only the component revisions this page names. Projects keep every
    // historical package version, and decoding all of them for each preview
    // exhausted the worker heap on large libraries.
    const stored = files.get(`${page}.json`);
    const prefixes = stored
      ? collectCustomComponentRefs(
          (JSON.parse(stored.toString("utf8")) as { document: ShowDocument })
            .document,
        ).flatMap((ref) => componentPackagePrefixes(projectId, ref))
      : [];
    const packages = tree
      .map((entry) => entry.path)
      .filter((path) => prefixes.some((prefix) => path.startsWith(prefix)));
    for (const [path, bytes] of await snapshot.library.readFiles(
      packages,
      snapshot.revision,
    ))
      files.set(path, bytes);
    paths.push(...packages);
    const resources = [
      ...new Set(paths.map((path) => resourceForPath(path).path)),
    ];
    const revisions = await snapshot.library.resourceRevisions(
      resources,
      snapshot.revision,
    );
    return {
      root: snapshot.root,
      revision: snapshot.revision,
      library: new PreviewLibrary(
        snapshot.root,
        snapshot.revision,
        tree,
        files,
        revisions,
      ),
    };
  });
}
