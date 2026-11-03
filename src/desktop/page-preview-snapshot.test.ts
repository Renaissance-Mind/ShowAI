import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteLibrary } from "../core/sqlite-library";
import { libraryReadSnapshot, readLibraryFile } from "../core/library-runtime";
import { pagePreviewSnapshot } from "./page-preview-snapshot";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const context = {
  actor: { kind: "human" as const },
  channel: "desktop" as const,
};
const pageUsing = (componentId: string) =>
  Buffer.from(
    JSON.stringify({
      format: "showai",
      document: {
        content: {
          type: "doc",
          attrs: { id: "root" },
          content: [
            {
              type: "widget",
              attrs: {
                id: "block",
                kind: "custom",
                data: { componentId, version: "1.0.0", props: {} },
              },
            },
          ],
        },
      },
    }),
  );

it("releases the writer lease before compilation and keeps captured source bytes pinned", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-preview-snapshot-"));
  roots.push(root);
  const library = new SqliteLibrary(root);
  await library.initialize();
  const path = "projects/project-a/packages/components/chart/1.0.0/source.ts";
  await library.writeFiles(
    new Map([
      ["projects/project-a/pages/page-a.json", pageUsing("chart")],
      [path, Buffer.from("export const value = 1;")],
    ]),
    context,
  );
  const snapshot = await pagePreviewSnapshot(root, "project-a", "page-a");
  expect(snapshot).toBeDefined();
  await expect(access(join(root, "local/writer.lock"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await library.writeFiles(
    new Map([[path, Buffer.from("export const value = 2;")]]),
    context,
  );
  expect((await library.readFile(path)).toString()).toContain("value = 2");
  const frozen = await libraryReadSnapshot.run(snapshot!, () =>
    readLibraryFile(root, join(root, "workspace", path)),
  );
  expect(frozen?.toString()).toContain("value = 1");
});

it("freezes only the component revisions the page references", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-preview-scope-"));
  roots.push(root);
  const library = new SqliteLibrary(root);
  await library.initialize();
  const used = "packages/components/shared/1.0.0/index.ts",
    older = "packages/components/shared/0.9.0/index.ts",
    unused = "projects/project-a/packages/components/unused/1.0.0/index.ts",
    other = "projects/project-b/packages/components/shared/1.0.0/index.ts";
  await library.writeFiles(
    new Map([
      ["projects/project-a/pages/page-a.json", pageUsing("shared")],
      [used, Buffer.from("used source")],
      [older, Buffer.from("older source")],
      [unused, Buffer.from("unused source")],
      [other, Buffer.from("other source")],
    ]),
    context,
  );
  const snapshot = await pagePreviewSnapshot(root, "project-a", "page-a");
  expect((await snapshot!.library.readFile(used)).toString()).toBe(
    "used source",
  );
  for (const path of [older, unused, other])
    await expect(snapshot!.library.readFile(path)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
});
