import { describe, it, expect } from "vitest";
import type { ShowDocument } from "../types";
import { ungroupRegion } from "./board-commands";
import { inkFramePose } from "./portable-ink.mjs";
import { blankDocument } from "../core/catalog";
import { normalizeDocument } from "../core/diff";
import { createResource } from "./containers.mjs";
import { addNode } from "./editing";
import { objectCapabilities } from "./geometry.mjs";
import { createPortableInk, isInkNode } from "./portable-ink.mjs";
import {
  validateInkArchiveGroup,
  inkArchiveGroupLayout,
} from "./ink-archive-group.mjs";
import {
  stampInkDocument,
  inkCheckpointFromDocument,
  inkWireDocumentFromCheckpoint,
} from "./ink-wire.mjs";
import {
  nativeBoardScenePatch,
  resolveNativeBoardScene,
} from "./native-board-scene.mjs";
// Actual PencilKit archive exported by the native-ink fixture, retained as provenance.
const sourceDrawing =
  "data:application/vnd.showai.pencilkit;base64,d3Jk8AEACAASEAAAAAAAAAAAAAAAAAAAAAASEHnHyyx7XUmOkvT2D5x8MC8aBggAEAAYABoGCAEQARgBIjQKFA0AAAAAFQAAAAAdAAAAACUAAIA/EhFjb20uYXBwbGUuaW5rLnBlbhgDQQAAAAAAAAAAKuUBChBY1UZfFIdJhbwHcOCl8NAyEgYIABABGAEaBggAEAEYACAAKoEBChCJq2t6zsFDd4vkkJ/O+GkvEQAAAEDkJ83BGAMg5wcomAgyBugDAAAAADpUAABAQQAAwEEAAAAAAAAAQMgAEoRtPP9/AAAAQAAAjEIAAHBCzczMPQAAAEGEAziMukz/fwAAAEEAAAxDAADwQc3MTD4AAIBAkAEliCEsZmYAAIBAMhQNAAAAABUAAAAAHQAABEMlAAAEQjoeDQAAgD8VAAAAAB0AAAAAJQAAgD8tAAAwwTUAALjBQMCKgICABDoGCAAQABgAQhA4C0A0XdJMb5gDlJSiV1/E";
const group = () => ({
  type: "region",
  attrs: {
    id: "archive",
    name: "旧手写",
    inkArchiveGroup: { version: 1, extent: [132, 33], sourceDrawing },
  },
  content: [stroke("red", "#ff0000", 1), stroke("blue", "#0000ff", 0.35)],
});
function stroke(id: string, color: string, opacity: number) {
  const ink = createPortableInk(
    [
      { x: 8, y: 10 },
      { x: 100, y: 20 },
    ],
    3,
    [132, 33],
  );
  ink.opacity = opacity;
  return {
    type: "drawing",
    attrs: {
      id,
      tool: "pen",
      color,
      strokeWidth: 3,
      extent: [132, 33],
      points: [
        { x: 8, y: 10 },
        { x: 100, y: 20 },
      ],
      ink,
    },
  };
}
function source() {
  let page: ShowDocument = createResource(blankDocument(), "board");
  page = addNode(
    page,
    group(),
    { x: 40, y: 50, width: 66, height: 99, rotation: 30, mode: "free", gap: 0 },
    page.content.attrs!.id,
  );
  page.layout!.red = { x: 0, y: 0, width: 132, height: 33 };
  page.layout!.blue = { x: 0, y: 0, width: 132, height: 33 };
  return normalizeDocument(page);
}
describe("lossless editable archive groups", () => {
  it("keeps mixed stroke colors/alpha and exact original archive through canonical normalization", () => {
    const page = source(),
      node = page.content.content![0];
    expect(node).toEqual(group());
    expect(isInkNode(node)).toBe(false);
    expect(objectCapabilities(node)).toMatchObject({
      rotate: true,
      resizeHeight: true,
      minWidth: 1,
      minHeight: 1,
    });
    expect(
      inkArchiveGroupLayout(
        validateInkArchiveGroup(node)!,
        page.layout!.archive,
      ),
    ).toEqual({ width: 132, height: 33, scaleX: 0.5, scaleY: 3 });
  });
  it("retains the transparent non-ink parent through real causal checkpoint projection", () => {
    const first = source(),
      page = stampInkDocument(first, undefined, { actor: "ipad", sequence: 1 }),
      boardId = page.content.attrs!.id;
    const checkpoint = inkCheckpointFromDocument(page, boardId);
    expect(checkpoint.strokes.map((s) => s.id).sort()).toEqual(["blue", "red"]);
    const projected = inkWireDocumentFromCheckpoint(page, boardId, checkpoint);
    expect(projected.content.content![0].attrs).toEqual(group().attrs);
    expect(
      projected.content.content![0].content!.map((n) => n.attrs!.id),
    ).toEqual(["red", "blue"]);
    expect(projected.layout!.archive).toEqual(page.layout!.archive);
    expect(
      resolveNativeBoardScene(nativeBoardScenePatch(projected, boardId)),
    ).toEqual(projected);
  });
  it("does not delete a same-ID non-ink group when projecting its old logical stroke tombstone", () => {
    const upgraded = source(), baseline = structuredClone(upgraded);
    baseline.content.content = [stroke("archive", "#ff0000", 1)];
    baseline.layout = {archive: {...upgraded.layout!.archive}};
    const old = stampInkDocument(baseline, undefined, {actor:"legacy",sequence:1});
    upgraded.content.attrs!.inkState = structuredClone(old.content.attrs!.inkState);
    const next = stampInkDocument(upgraded,old,{actor:"ipad",sequence:1});
    const projected = inkWireDocumentFromCheckpoint(next,next.content.attrs!.id,inkCheckpointFromDocument(next,next.content.attrs!.id));
    expect(projected.content.content![0].type).toBe("region");
    expect(projected.content.content![0].attrs!.id).toBe("archive");
    expect(projected.content.content![0].content!.map(n=>n.attrs!.id)).toEqual(["red","blue"]);
    expect(projected.layout!.archive).toEqual(upgraded.layout!.archive);
    expect(normalizeDocument(projected).content.content![0].attrs!.inkArchiveGroup.sourceDrawing).toBe(sourceDrawing);
  });
  it("edits a child independently and retains the other stroke plus group identity", () => {
    const page = source(),
      next = structuredClone(page);
    next.content.content![0].content![0].attrs!.color = "#00ff00";
    const stamped = stampInkDocument(next, page, {
      actor: "browser",
      sequence: 1,
    });
    expect(stamped.content.content![0].attrs).toEqual(
      page.content.content![0].attrs,
    );
    expect(stamped.content.content![0].content![1]).toEqual(
      page.content.content![0].content![1],
    );
    expect(
      normalizeDocument(stamped).content.content![0].content![0].attrs!.color,
    ).toBe("#00ff00");
  });
  it("ungroups rotated scaled archives without rewriting source samples or losing affine pose", () => {
    const page = source();
    page.layout!.red.rotation = 27;
    const before = page.content.content![0].content![0];
    const result = ungroupRegion(page, "archive", { x: 45, y: 27 })!;
    expect(result.ids).toEqual(["red", "blue"]);
    const after = result.document.content.content![0];
    expect(after.attrs!.ink.samples).toEqual(before.attrs!.ink.samples);
    const mul = (a: number[], b: number[]) => [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    const original = mul(
      mul(
        inkFramePose(
          { ...page.layout!.archive, height: page.layout!.archive.height! },
          [132, 33],
        ),
        inkFramePose(
          { ...page.layout!.red, height: page.layout!.red.height! },
          [132, 33],
        ),
      ),
      before.attrs!.ink.transform,
    );
    const flattened = mul(
      inkFramePose(
        {
          ...result.document.layout!.red,
          height: result.document.layout!.red.height!,
        },
        [132, 33],
      ),
      after.attrs!.ink.transform,
    );
    flattened.forEach((value, i) => expect(value).toBeCloseTo(original[i], 10));
    expect(() => normalizeDocument(result.document)).not.toThrow();
  });
  it("rejects malformed metadata, own-paint data and non-drawing descendants", () => {
    for (const alter of [
      (n: any) => (n.attrs.inkArchiveGroup.version = 2),
      (n: any) => (n.attrs.inkArchiveGroup.extent = [0, 33]),
      (n: any) =>
        (n.attrs.inkArchiveGroup.sourceDrawing = "data:image/png;base64,AAAA"),
      (n: any) => (n.attrs.nativeInk = {}),
      (n: any) => (n.content = [{ type: "image" }]),
    ]) {
      const n = group();
      alter(n);
      expect(() => validateInkArchiveGroup(n)).toThrow();
    }
    const nonRegion = group();
    nonRegion.type = "widget";
    expect(() => validateInkArchiveGroup(nonRegion)).toThrow();
  });
  it("requires a fixed free-layout frame but accepts a one-unit outer frame", () => {
    const page = source();
    page.layout!.archive = { x: 0, y: 0, width: 1, height: 1, mode: "free" };
    expect(() => normalizeDocument(page)).not.toThrow();
    page.layout!.archive.mode = "flow";
    expect(() => normalizeDocument(page)).toThrow("free-layout");
  });
});
