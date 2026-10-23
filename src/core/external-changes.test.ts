import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXTERNAL_CHANGE_LIMIT,
  EXTERNAL_CHANGE_TTL_MS,
  dismissExternalChange,
  listExternalChanges,
  recordExternalChange,
  summarizeChange,
} from "./external-changes";
import type { ShowDocument } from "./model";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-external-changes-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function page(texts: string[], title = "Page"): ShowDocument {
  return {
    id: "page-1",
    title,
    icon: "",
    cover: "none",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    comments: [],
    content: {
      type: "doc",
      content: texts.map((text, index) => ({
        type: "paragraph",
        attrs: { id: `p${index + 1}` },
        content: [{ type: "text", text }],
      })),
    },
  } as ShowDocument;
}

it("counts changed places in document order and ignores timestamp-only writes", async () => {
  const before = page(["a", "b", "c"]);
  expect(
    summarizeChange(before, page(["a", "B", "C"])),
  ).toEqual({ blockIds: ["p2", "p3"], count: 2 });
  const removed = page(["a"], "Renamed");
  expect(summarizeChange(before, removed)).toEqual({ blockIds: [], count: 3 });
  expect(
    await recordExternalChange(root, {
      projectId: "project-1",
      pageId: "page-1",
      before,
      after: { ...before, updatedAt: "2026-10-23T01:00:00.000Z" },
      hash: "h",
    }),
  ).toBeNull();
  expect(await listExternalChanges(root, "project-1", "page-1")).toEqual([]);
});

it("keeps the newest five snapshots per page and drops them after a day", async () => {
  const now = Date.parse("2026-10-23T08:00:00.000Z");
  for (let index = 0; index < EXTERNAL_CHANGE_LIMIT + 2; index++)
    await recordExternalChange(
      root,
      {
        projectId: "project-1",
        pageId: "page-1",
        before: page([`v${index}`]),
        after: page([`v${index + 1}`]),
        hash: `hash-${index}`,
        revision: `revision-${index}`,
        author: { kind: "external", label: "codex-mcp-client", channel: "mcp", at: "x" },
      },
      now + index,
    );
  const entries = await listExternalChanges(root, "project-1", "page-1", now + 10);
  expect(entries.map((entry) => entry.hash)).toEqual(
    [6, 5, 4, 3, 2].map((index) => `hash-${index}`),
  );
  expect(entries[0].before.content.content?.[0].content?.[0].text).toBe("v6");
  expect(entries[0].after.content.content?.[0].content?.[0].text).toBe("v7");
  expect(entries[0].author?.label).toBe("codex-mcp-client");

  await dismissExternalChange(root, "project-1", "page-1", entries[0].id);
  expect(
    (await listExternalChanges(root, "project-1", "page-1", now + 10)).map(
      (entry) => entry.hash,
    ),
  ).toEqual([5, 4, 3, 2].map((index) => `hash-${index}`));

  expect(
    await listExternalChanges(
      root,
      "project-1",
      "page-1",
      now + EXTERNAL_CHANGE_TTL_MS + 100,
    ),
  ).toEqual([]);
  // Expired snapshots leave no file behind.
  expect(await readdir(join(root, "local", "external-changes", "project-1"))).toEqual([]);
});
