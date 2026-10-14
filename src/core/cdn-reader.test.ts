import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cdnReaderOrigins, cdnReaderUrls, chooseReader } from "./cdn-reader";

const manifest = {
  format: "showai-cdn-reader",
  name: "showai-reader",
  version: "0.9.0-reader.abc123",
  entry: "reader-ABC123.js",
};

describe("CDN reader resolution", () => {
  let directory: string;
  const saved = { ...process.env };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "showai-cdn-manifest-"));
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    process.env.SHOWAI_CDN_MANIFEST = join(directory, "manifest.json");
    delete process.env.SHOWAI_READER_CDN;
  });
  afterEach(async () => {
    process.env = { ...saved };
    await rm(directory, { recursive: true, force: true });
  });

  it("pins jsDelivr then unpkg to the exact build", async () => {
    const urls = await cdnReaderUrls();
    expect(urls).toEqual([
      "https://cdn.jsdelivr.net/npm/showai-reader@0.9.0-reader.abc123/reader-ABC123.js",
      "https://unpkg.com/showai-reader@0.9.0-reader.abc123/reader-ABC123.js",
    ]);
    expect(cdnReaderOrigins(urls)).toEqual([
      "https://cdn.jsdelivr.net",
      "https://unpkg.com",
    ]);
  });

  it("accepts mirrors with placeholders and can be switched off", async () => {
    process.env.SHOWAI_READER_CDN =
      "https://mirror.example.com/{name}/{version}, http://127.0.0.1:9000";
    expect(await cdnReaderUrls()).toEqual([
      "https://mirror.example.com/showai-reader/0.9.0-reader.abc123/reader-ABC123.js",
      "http://127.0.0.1:9000/reader-ABC123.js",
    ]);
    process.env.SHOWAI_READER_CDN = "off";
    expect(await cdnReaderUrls()).toBeUndefined();
  });

  it("starts conversation fragments and files offline unless CDN loading is requested", async () => {
    expect((await chooseReader("inline")).mode).toBe("bundled");
    expect((await chooseReader("html")).mode).toBe("bundled");
    expect((await chooseReader("html", "cdn")).mode).toBe("cdn");
    expect((await chooseReader("inline", "bundled")).mode).toBe("bundled");
    expect((await chooseReader("site")).mode).toBe("bundled");
    await expect(chooseReader("site", "cdn")).rejects.toThrow(/Site exports/);
  });

  it("falls back to the bundled reader when no CDN build is available", async () => {
    process.env.SHOWAI_READER_CDN = "off";
    expect((await chooseReader("inline")).mode).toBe("bundled");
    await expect(chooseReader("html", "cdn")).rejects.toThrow(
      /CDN reader is unavailable/,
    );
  });

  it.each(["../../evil.js", "reader.js?x", "chunks/../reader.js"])(
    "rejects a manifest entry that leaves the package: %s",
    async (entry) => {
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({ ...manifest, entry }),
      );
      await expect(cdnReaderUrls()).rejects.toThrow(
        /Invalid CDN reader manifest/,
      );
    },
  );
});
