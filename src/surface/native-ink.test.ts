import { describe, it, expect } from "vitest";
import { validateNativeInk } from "./native-ink.mjs";
import { parseArtifact } from "../portable/validation.mjs";
import { reconcileSurface } from "./document.mjs";
import { transformObjects, duplicateObjects } from "./board-commands";
import { encodeFile, decodeFile } from "../core/history-codec";
import fixture from "./native-ink-fixture.json";

function artifact() {
  const document = reconcileSurface({
    id: "ink-page",
    title: "原生笔迹",
    icon: "",
    cover: "",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
    comments: [],
    content: {
      type: "surface",
      attrs: { id: "ink-board", kind: "board" },
      content: [structuredClone(fixture.node)],
    },
    layout: { "native-ink": structuredClone(fixture.frame) },
    surfaceViews: {},
  });
  return { format: "showai", version: 3, document };
}
describe("native PencilKit ink", () => {
  it("validates a genuine PencilKit archive and preserves all assets in storage", async () => {
    const input = artifact();
    expect(() => parseArtifact(input)).not.toThrow();
    const path = "projects/ink/pages/ink-page.json";
    const files = encodeFile(path, Buffer.from(JSON.stringify(input)));
    expect(
      [...files.keys()].filter((path) => path.startsWith("assets/")).length,
    ).toBe(2);
    const restored = JSON.parse(
      (await decodeFile(path, async (path) => files.get(path)!)).toString(),
    );
    expect(restored).toEqual(input);
    expect(
      restored.document.content.content[0].attrs.data.nativeInk.drawing,
    ).toBe(fixture.node.attrs.data.nativeInk.drawing);
  });
  it("keeps the editable archive unchanged when moving, rotating and duplicating the preview", () => {
    const source = artifact().document;
    const moved = transformObjects(source, {
      "native-ink": {
        ...fixture.frame,
        x: -150,
        y: 200,
        width: fixture.frame.width * 2,
        rotation: 35,
      },
    });
    expect(moved.content.content![0].attrs!.data.nativeInk).toEqual(
      fixture.node.attrs.data.nativeInk,
    );
    const copy = duplicateObjects(moved, ["native-ink"]);
    expect(copy.document.content.content).toHaveLength(2);
    expect(copy.document.content.content![1].attrs!.data.nativeInk).toEqual(
      fixture.node.attrs.data.nativeInk,
    );
    expect(() =>
      parseArtifact({ format: "showai", version: 3, document: copy.document }),
    ).not.toThrow();
  });
  it("rejects malformed archives, unsafe previews, unknown fields and inconsistent images", () => {
    const ink = fixture.node.attrs.data.nativeInk;
    for (const patch of [
      { drawing: "https://example.com/ink" },
      { preview: "data:image/svg+xml;base64,PHN2Zz4=" },
      { drawing: "data:application/vnd.showai.pencilkit;base64,%%%=" },
      { strokeCount: 0 },
      { unsupported: true },
      { extent: [0, 10] },
    ]) {
      expect(() => validateNativeInk({ ...ink, ...patch })).toThrow();
    }
    const input = artifact();
    input.document.content.content![0].attrs!.data.src = "";
    expect(() => parseArtifact(input)).toThrow(/matching preview/);
  });
});
