import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCachedPresentation } from "./presentation-cache";
import { renderPresentation } from "./presentation";
import {
  collectGeneratedCache,
  generatedCacheRecords,
  GENERATED_CACHE_MAX_AGE_MS,
} from "../core/generated-cache";
import { ContentLibrary } from "../core/content-library";
import { FileStore } from "../core/store";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
test("repeated presentations share files while explicit delivery directories survive cache collection", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-presentation-cache-"));
  roots.push(root);
  await new ContentLibrary(root).initialize();
  const store = new FileStore(root);
  const project = await store.createProject({ name: "Retained content" });
  const page = await store.createPage(project.id);
  const value = await renderPresentation({ document: { ...page.document } });
  const first = await writeCachedPresentation(root, value);
  const count = (await readdir(join(root, "local/agent-previews"))).length;
  const second = await writeCachedPresentation(root, value);
  expect(second.delivery).toEqual(first.delivery);
  expect(await readdir(join(root, "local/agent-previews"))).toHaveLength(count);
  const regenerated = await writeCachedPresentation(
    root,
    await renderPresentation({ document: { ...page.document } }),
  );
  expect(regenerated.delivery.html).toBe(first.delivery.html);
  expect(regenerated.delivery.source).toBe(first.delivery.source);
  expect(await readFile(first.delivery.source, "utf8")).toBe(value.source);
  expect((await generatedCacheRecords(root)).length).toBeGreaterThanOrEqual(2);
  const explicit = await writeCachedPresentation(
    root,
    value,
    join(root, "exports"),
  );
  await collectGeneratedCache(
    root,
    Date.now() + GENERATED_CACHE_MAX_AGE_MS + 1000,
  );
  expect(await readFile(explicit.delivery.html, "utf8")).toBe(value.html);
  expect(await readFile(explicit.delivery.source, "utf8")).toBe(value.source);
});
