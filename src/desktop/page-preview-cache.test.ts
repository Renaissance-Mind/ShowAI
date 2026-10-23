import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PagePreviewCache, pagePreviewSize } from "./page-preview-cache";

const directories: string[] = [];
const reference = {
  home: "/library/one",
  projectId: "project",
  pageId: "page",
  theme: "light",
};
const picture = async () =>
  `data:image/png;base64,${(await readFile(new URL("./assets/icon.png", import.meta.url))).toString("base64")}`;
async function setup(maxBytes?: number) {
  const directory = await mkdtemp(join(tmpdir(), "showai-page-cache-"));
  directories.push(directory);
  return new PagePreviewCache(directory, maxBytes);
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("persists a latest image across application restarts and renderer versions", async () => {
  const cache = await setup();
  const image = await picture();
  await cache.publish(reference, "old-renderer", image);
  expect(await new PagePreviewCache(cache.directory).latest(reference)).toEqual(
    { image, fingerprint: "old-renderer" },
  );
  expect(pagePreviewSize).toEqual({ width: 640, height: 440, padding: 8 });
});

it("invalidates freshness without clearing the image, including on restart", async () => {
  const cache = await setup();
  const image = await picture();
  await cache.publish(reference, "first", image);
  await cache.invalidate((entry) => entry.pageId === reference.pageId);
  expect(await new PagePreviewCache(cache.directory).latest(reference)).toEqual(
    { image, fingerprint: "" },
  );
  await cache.publish(reference, "new", image);
  expect((await cache.latest(reference))?.fingerprint).toBe("new");
});

it("keeps homes, pages and appearances isolated", async () => {
  const cache = await setup();
  const image = await picture();
  await cache.publish(reference, "one", image);
  await cache.publish({ ...reference, home: "/library/two" }, "two", image);
  expect(await cache.latest({ ...reference, theme: "dark" })).toBeUndefined();
  await cache.invalidate((entry) => entry.home === reference.home);
  expect(
    (await cache.latest({ ...reference, home: "/library/two" }))?.fingerprint,
  ).toBe("two");
});

it("does not publish a capture invalidated during disk I/O", async () => {
  const cache = await setup();
  const image = await picture();
  await cache.publish(reference, "original", image);
  let checks = 0;
  expect(
    await cache.publish(reference, "obsolete", image, () => ++checks < 2),
  ).toBe(false);
  expect((await cache.latest(reference))?.fingerprint).toBe("original");
});

it("bounds disk usage and removes metadata for evicted images", async () => {
  const image = await picture();
  const bytes = Buffer.from(image.split(",")[1], "base64").length;
  const cache = await setup(bytes + 16);
  await cache.publish(reference, "one", image);
  await cache.publish({ ...reference, pageId: "another" }, "two", image);
  await cache.prune();
  const images = (await readdir(cache.directory)).filter((name) =>
    name.endsWith(".png"),
  );
  expect(
    (
      await Promise.all(images.map((name) => stat(join(cache.directory, name))))
    ).reduce((total, file) => total + file.size, 0),
  ).toBeLessThanOrEqual(bytes + 16);
  expect(
    (await readdir(cache.directory)).filter((name) => name.endsWith(".json")),
  ).toHaveLength(1);
});
