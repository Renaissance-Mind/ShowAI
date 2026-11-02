import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  detachedRef,
  isDetachedRef,
  isLocalResourceRef,
  localFileRef,
  localRefName,
  localRefType,
} from "./local-files.mjs";
import { localFilePath } from "../core/local-resources";
import { validateDocument } from "./validation.mjs";
import { validateResearchData } from "../components/blocks/research-contract.mjs";
import { validateRichTextData } from "../components/rich-text/model.mjs";
import {
  componentSandboxPolicy,
  componentSandboxPolicyFor,
  withoutPackagePolicies,
} from "../components/custom/sandbox-policy.mjs";

const page = (content: unknown[]) => ({
  id: "page",
  title: "Linked",
  content: { type: "doc", content },
});

describe("local file references", () => {
  it("encode absolute paths so names with spaces, CJK, # and ? survive", () => {
    const path = "/Users/me/RM 宣传/成片 #1?.mp4";
    const ref = localFileRef(path);
    expect(ref).toBe(
      "file:///Users/me/RM%20%E5%AE%A3%E4%BC%A0/%E6%88%90%E7%89%87%20%231%3F.mp4",
    );
    expect(localFilePath(ref)).toBe(path);
    expect(localRefName(ref)).toBe("成片 #1?.mp4");
    expect(localRefType(ref)).toEqual({ mime: "video/mp4", kind: "video" });
    expect(localFilePath("file:~/Pictures/a.png")).toBe(
      join(homedir(), "Pictures/a.png"),
    );
    expect(localFileRef("C:\\Users\\me\\a.png")).toBe("file:///C%3A/Users/me/a.png");
    expect(() => localFileRef("relative/a.png")).toThrow();
  });

  it("know which field kinds a reference fits", () => {
    expect(isLocalResourceRef("file:~/a.PNG", "image")).toBe(true);
    expect(isLocalResourceRef("file:~/a.avif", "image")).toBe(true);
    // SVG documents are not served; raster images only.
    expect(isLocalResourceRef("file:~/a.svg", "image")).toBe(false);
    expect(isLocalResourceRef("file:~/a.png", "video")).toBe(false);
    expect(isLocalResourceRef("file:~/a.pdf", "pdf")).toBe(true);
    expect(isLocalResourceRef("file:~/a.m4a", "audio")).toBe(true);
    expect(isLocalResourceRef("https://x.test/a.png", "image")).toBe(false);
    expect(isLocalResourceRef("file:///a%ZZ.png", "image")).toBe(false);
  });

  it("keep only the file name for copies without the file", () => {
    const ref = localFileRef("/Users/me/私人/截图 1.png");
    const detached = detachedRef(ref);
    expect(detached).toBe("file:%E6%88%AA%E5%9B%BE%201.png");
    expect(isDetachedRef(detached)).toBe(true);
    expect(isDetachedRef(ref)).toBe(false);
    expect(isDetachedRef("file:~/a.png")).toBe(false);
    expect(localRefName(detached)).toBe("截图 1.png");
    expect(isLocalResourceRef(detached, "image")).toBe(true);
    expect(() => localFilePath(detached)).toThrow();
  });

  it("are accepted by every built-in resource field of their kind", () => {
    const image = "file:~/Pictures/plot.png";
    const video = "file:///Users/me/clip.mov";
    expect(() =>
      validateDocument(
        page([
          { type: "image", attrs: { src: image } },
          { type: "widget", attrs: { kind: "image", data: { src: image } } },
          {
            type: "widget",
            attrs: {
              kind: "gallery",
              data: { images: [{ id: "a", src: image, alt: "", caption: "" }] },
            },
          },
          {
            type: "widget",
            attrs: {
              kind: "bookmark",
              data: { url: "https://example.com", image },
            },
          },
          {
            type: "widget",
            attrs: { kind: "video", data: { src: video, poster: image } },
          },
          {
            type: "widget",
            attrs: { kind: "audio", data: { src: "file:~/a.flac" } },
          },
          {
            type: "widget",
            attrs: { kind: "pdf", data: { src: "file:~/paper.pdf" } },
          },
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      validateRichTextData({
        format: "richtext",
        content: {
          type: "doc",
          content: [{ type: "image", attrs: { src: image } }],
        },
      }),
    ).not.toThrow();
    expect(() => validateResearchData("video", { src: image })).toThrow();
    expect(() => validateResearchData("pdf", { src: video })).toThrow();
    expect(() =>
      validateDocument(page([{ type: "image", attrs: { src: video } }])),
    ).toThrow(/src/);
    expect(() =>
      validateDocument(
        page([{ type: "image", attrs: { src: "file:~/drawing.svg" } }]),
      ),
    ).toThrow(/src/);
  });
});

describe("component sandbox policy", () => {
  it("shows online images and media but keeps requests and frames closed", () => {
    expect(componentSandboxPolicy).toContain("img-src data: blob: https:;");
    expect(componentSandboxPolicy).toContain("media-src data: blob: https:;");
    expect(componentSandboxPolicy).toContain("connect-src 'none'");
    expect(componentSandboxPolicy).toContain("frame-src about:;");
    expect(componentSandboxPolicy).not.toContain("http:");
  });

  it("adds the host's local media source for granted files", () => {
    expect(componentSandboxPolicyFor()).toBe(componentSandboxPolicy);
    const desktop = componentSandboxPolicyFor("showai-media:");
    expect(desktop).toContain("img-src data: blob: https: showai-media:;");
    expect(desktop).toContain("media-src data: blob: https: showai-media:;");
    expect(desktop).toContain("connect-src 'none'");
    expect(() => componentSandboxPolicyFor("http://127.0.0.1:5199")).toThrow();
    expect(() => componentSandboxPolicyFor("https://evil.test")).toThrow();
    expect(() => componentSandboxPolicyFor("*")).toThrow();
  });

  it("lets the host policy replace the one a package was compiled with", () => {
    const compiled = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:"><META HTTP-EQUIV=content-security-policy CONTENT="img-src data:"></head><body></body></html>`;
    expect(withoutPackagePolicies(compiled)).toBe(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
    );
  });
});
