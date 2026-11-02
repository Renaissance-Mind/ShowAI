import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultLocalResourceDecisions,
  describeResources,
  withLocalResources,
} from "./local-resources";
import { CAPACITY } from "../portable/capacity.mjs";
import { localFileRef } from "../portable/local-files.mjs";
import { validateDocument } from "../portable/validation.mjs";
import type { ShowDocument } from "../types";

let files: string;
beforeEach(async () => {
  files = await mkdtemp(join(tmpdir(), "showai-local-resource-plan-"));
});
afterEach(() => rm(files, { recursive: true, force: true }));

const page = (content: unknown[]) =>
  validateDocument({
    id: "page",
    title: "Plan",
    content: { type: "doc", content },
  }) as ShowDocument;

describe("local resources of a page", () => {
  it("list files once with their uses, including custom component props", async () => {
    const photo = join(files, "photo.jpg");
    await writeFile(photo, "jpeg");
    const ref = localFileRef(photo);
    const document = page([
      { type: "image", attrs: { id: "hero", src: ref } },
      {
        type: "widget",
        attrs: {
          id: "custom",
          kind: "custom",
          data: {
            componentId: "viewer",
            version: "1.0.0",
            props: {
              shots: [{ src: ref }, { src: "file:~/missing-clip.mp4" }],
              note: "file:~/notes.txt",
            },
          },
        },
      },
    ]);
    const resources = await describeResources(document);
    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({
      id: ref,
      source: "file",
      kind: "image",
      bytes: 4,
      available: true,
      uses: [
        { blockId: "hero", field: "src" },
        { blockId: "custom", field: "props.shots[0].src" },
      ],
    });
    // Unsupported types such as notes.txt are not resources.
    expect(resources[1]).toMatchObject({
      id: "file:~/missing-clip.mp4",
      kind: "video",
      available: false,
    });
    const builtIn = await describeResources(document, { components: false });
    expect(builtIn.map((item) => item.uses.length)).toEqual([1]);
  });

  it("embed what fits the budget, keep names of the rest, and follow decisions", async () => {
    const small = join(files, "small.png");
    const large = join(files, "large.mp4");
    await writeFile(small, "png");
    await writeFile(large, "");
    await truncate(large, CAPACITY.resourceBytes + 1);
    const smallRef = localFileRef(small);
    const largeRef = localFileRef(large);
    const document = page([
      { type: "image", attrs: { id: "a", src: smallRef } },
      {
        type: "widget",
        attrs: { id: "v", kind: "video", data: { src: largeRef } },
      },
      {
        type: "widget",
        attrs: {
          id: "c",
          kind: "custom",
          data: { componentId: "x", version: "1.0.0", props: { src: smallRef } },
        },
      },
    ]);
    expect(
      defaultLocalResourceDecisions(document, await describeResources(document)),
    ).toEqual({ [smallRef]: "embed", [largeRef]: "skip" });
    const copy = await withLocalResources(document);
    const [image, video, custom] = copy.document.content.content as any[];
    expect(image.attrs.src).toBe(
      `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
    );
    expect(video.attrs.data.src).toBe("file:large.mp4");
    // Component props keep their references; the component shows them as unavailable.
    expect(custom.attrs.data.props.src).toBe(smallRef);
    expect(copy.resources.map((item) => [item.name, item.choice])).toEqual([
      ["small.png", "embed"],
      ["large.mp4", "skip"],
    ]);
    // The source document is unchanged.
    expect((document.content.content as any[])[0].attrs.src).toBe(smallRef);

    const skipped = await withLocalResources(document, { [smallRef]: "skip" });
    expect((skipped.document.content.content as any[])[0].attrs.src).toBe(
      "file:small.png",
    );
    await expect(
      withLocalResources(document, { [largeRef]: "embed" }),
    ).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
    await rm(small);
    await expect(
      withLocalResources(document, { [smallRef]: "embed" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
