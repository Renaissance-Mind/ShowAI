import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { create } from "tar";
import {
  handle,
  readerPath,
} from "../../deployments/cloudflare/reader-worker.mjs";

const dist = resolve("dist-cdn");

class MemoryBucket {
  objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  async put(
    key: string,
    body: Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    this.objects.set(key, {
      body: typeof body === "string" ? new TextEncoder().encode(body) : body,
      contentType: options?.httpMetadata?.contentType,
    });
  }
  async head(key: string) {
    return this.objects.has(key) ? {} : null;
  }
  async get(key: string) {
    const object = this.objects.get(key);
    return object
      ? {
          body: object.body,
          httpEtag: `"${key}"`,
          httpMetadata: { contentType: object.contentType },
        }
      : null;
  }
}

async function packedRelease() {
  const manifest = JSON.parse(
    await readFile(join(dist, "manifest.json"), "utf8"),
  );
  const directory = await mkdtemp(join(tmpdir(), "showai-reader-pack-"));
  await cp(dist, join(directory, "package"), { recursive: true });
  const file = join(directory, "release.tgz");
  await create({ gzip: true, file, cwd: directory, portable: true }, [
    "package",
  ]);
  const tarball = await readFile(file);
  await rm(directory, { recursive: true, force: true });
  return {
    manifest,
    tarball,
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
  };
}

function registry(
  version: string,
  tarball: Buffer,
  integrity: string,
  calls: string[],
) {
  return async (url: string) => {
    calls.push(url);
    if (url === `https://registry.npmjs.org/showai-reader/${version}`)
      return Response.json({
        version,
        dist: {
          tarball: `https://registry.npmjs.org/showai-reader/-/showai-reader-${version}.tgz`,
          integrity,
        },
      });
    if (url.endsWith(`/showai-reader-${version}.tgz`))
      return new Response(new Uint8Array(tarball));
    return new Response("missing", { status: 404 });
  };
}

test("reader paths only address files of one immutable showai-reader version", () => {
  expect(readerPath("/showai-reader@1.2.3-reader.abc/chunks/a-B.js")).toEqual({
    version: "1.2.3-reader.abc",
    file: "chunks/a-B.js",
  });
  for (const path of [
    "/other@1.0.0/x.js",
    "/showai-reader@latest/x.js",
    "/showai-reader@1.0.0/../secret",
    "/showai-reader@1.0.0/a/%2e%2e/b.js",
    "/showai-reader@1.0.0/",
    "/showai-reader@1.0.0/.complete",
  ])
    expect(readerPath(path)).toBeNull();
});

describe.skipIf(!existsSync(join(dist, "manifest.json")))(
  "reader source worker",
  () => {
    test("imports a verified npm release once and serves its modules", async () => {
      const { manifest, tarball, integrity } = await packedRelease();
      const bucket = new MemoryBucket(),
        calls: string[] = [];
      const fetcher = registry(manifest.version, tarball, integrity, calls);
      const env = { READER: bucket };
      const base = `https://reader.example/showai-reader@${manifest.version}/`;
      const entry = await handle(new Request(base + manifest.entry), env, fetcher);
      expect(entry.status).toBe(200);
      expect(entry.headers.get("content-type")).toContain("text/javascript");
      expect(entry.headers.get("access-control-allow-origin")).toBe("*");
      expect(entry.headers.get("cache-control")).toContain("immutable");
      expect(Buffer.from(await entry.arrayBuffer())).toEqual(
        await readFile(join(dist, manifest.entry)),
      );
      const chunk = (await readdir(join(dist, "chunks")))[0];
      const second = await handle(
        new Request(base + "chunks/" + chunk),
        env,
        fetcher,
      );
      expect(second.status).toBe(200);
      expect(calls).toHaveLength(2);
      const missing = await handle(
        new Request(base + "chunks/none.js"),
        env,
        fetcher,
      );
      expect(missing.status).toBe(404);
      expect(calls).toHaveLength(2);
    });

    test("refuses a tarball that does not match the registry integrity", async () => {
      const { manifest, tarball } = await packedRelease();
      const fetcher = registry(manifest.version, tarball, "sha512-AAAA", []);
      await expect(
        handle(
          new Request(
            `https://reader.example/showai-reader@${manifest.version}/${manifest.entry}`,
          ),
          { READER: new MemoryBucket() },
          fetcher,
        ),
      ).rejects.toThrow("integrity");
    });

    test("answers 404 for a version npm does not have", async () => {
      const response = await handle(
        new Request("https://reader.example/showai-reader@9.9.9/reader.js"),
        { READER: new MemoryBucket() },
        async () => new Response("missing", { status: 404 }),
      );
      expect(response.status).toBe(404);
    });
  },
);
