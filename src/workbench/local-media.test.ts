import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMediaGrants, localMediaPath, localMediaResponse } from "./local-media";

async function body(response: Awaited<ReturnType<typeof localMediaResponse>>) {
  const chunks: Buffer[] = [];
  for await (const chunk of response.body ?? []) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

describe("local media grants", () => {
  let root: string;
  let video: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-media-"));
    video = join(root, "宣传片 中文.mp4");
    await writeFile(video, "0123456789");
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("reads absolute paths, file URLs and paths under the home directory", () => {
    expect(localMediaPath("/a/b.mp4")).toBe("/a/b.mp4");
    expect(localMediaPath(pathToFileURL(video).href)).toBe(video);
    expect(localMediaPath("file:~/clip.mp4")).toBe(join(homedir(), "clip.mp4"));
    expect(localMediaPath("~/clip.mp4")).toBe(join(homedir(), "clip.mp4"));
    // Components encode each path segment, so spaces, CJK, # and ? survive.
    const segments = "~/RM 宣传/成片/a#1?.mp4".split("/").map(encodeURIComponent).join("/");
    expect(localMediaPath(`file:${segments}`)).toBe(join(homedir(), "RM 宣传/成片/a#1?.mp4"));
    for (const bad of ["clip.mp4", "file:clip.mp4", "", 3, "file:///a%ZZ"])
      expect(() => localMediaPath(bad)).toThrow();
  });

  it("grants existing files and recognises playable types", async () => {
    const grants = new LocalMediaGrants();
    const grant = await grants.grant(pathToFileURL(video).href);
    expect(grant).toMatchObject({ name: "宣传片 中文.mp4", kind: "video", mime: "video/mp4", size: 10 });
    expect(grants.resolve(grant.token)?.path).toBe(grant.path);
    const notes = join(root, "notes.md");
    await writeFile(notes, "# hi");
    const text = await grants.grant(notes);
    expect(text.kind).toBeUndefined();
    // Files the player cannot show are only revealed, never served.
    expect((await localMediaResponse(text.token, null, false, grants)).status).toBe(404);
    await expect(grants.grant(join(root, "missing.mp4"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await mkdir(join(root, "folder.mp4"));
    await expect(grants.grant(join(root, "folder.mp4"))).rejects.toMatchObject({ code: "INVALID_PATH" });
  });

  it("expires grants", async () => {
    let now = 0;
    const grants = new LocalMediaGrants(() => now);
    const grant = await grants.grant(video);
    now = 7 * 60 * 60 * 1000;
    expect(grants.resolve(grant.token)).toBeUndefined();
    expect(grants.resolve("unknown")).toBeUndefined();
  });

  it("streams whole files and byte ranges", async () => {
    const grants = new LocalMediaGrants();
    const { token } = await grants.grant(video);
    const whole = await localMediaResponse(token, null, false, grants);
    expect(whole.status).toBe(200);
    expect(whole.headers).toMatchObject({ "Content-Type": "video/mp4", "Content-Length": "10", "Accept-Ranges": "bytes" });
    expect(await body(whole)).toBe("0123456789");
    const part = await localMediaResponse(token, "bytes=2-5", false, grants);
    expect(part.status).toBe(206);
    expect(part.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(await body(part)).toBe("2345");
    expect(await body(await localMediaResponse(token, "bytes=7-", false, grants))).toBe("789");
    expect(await body(await localMediaResponse(token, "bytes=-3", false, grants))).toBe("789");
    expect(await body(await localMediaResponse(token, "bytes=8-99", false, grants))).toBe("89");
    for (const bad of ["bytes=10-", "bytes=5-2", "bytes=-", "items=0-1"]) {
      const refused = await localMediaResponse(token, bad, false, grants);
      expect(refused.status).toBe(416);
      expect(refused.headers["Content-Range"]).toBe("bytes */10");
    }
    const head = await localMediaResponse(token, null, true, grants);
    expect(head.body).toBeUndefined();
    expect(head.headers["Content-Length"]).toBe("10");
    await rm(video);
    expect((await localMediaResponse(token, null, false, grants)).status).toBe(404);
  });
});
