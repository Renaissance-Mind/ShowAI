import { expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { parseArtifact } from "../portable/validation.mjs";
import { CAPACITY } from "../portable/capacity.mjs";
import { createResource } from "./containers.mjs";
import { createPortableInk } from "./portable-ink.mjs";
import {
  SourceRuntimeOwner,
  normalizeSourceDocument,
  freezeOwnedSource,
  type SourceSnapshotDelta,
  type SourceSnapshotRef,
} from "./source-runtime";
import type { ShowDocument } from "../types";

const timestamp = "2026-10-22T00:00:00.000Z";
function rawSource() {
  const document = createResource(blankDocument(), "board") as ShowDocument;
  document.createdAt = timestamp;
  document.updatedAt = timestamp;
  document.content.content = [
    {
      type: "drawing",
      attrs: {
        id: "actual-ink",
        tool: "pen",
        color: "#111111",
        strokeWidth: 2,
        extent: [40, 30],
        points: [
          { x: 1, y: 2 },
          { x: 20, y: 12 },
        ],
        ink: createPortableInk(
          [
            { x: 1, y: 2, pressure: 0.5 },
            { x: 20, y: 12, pressure: 0.8 },
          ],
          2,
          [40, 30],
        ),
      },
    },
    {
      type: "surface",
      attrs: { id: "embedded-page", kind: "page", name: "Page" },
      content: [
        {
          type: "richText",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Actual rich text" }],
            },
          ],
        },
      ],
    },
  ];
  // Deliberately need canonical missing-ID, layout and view cleanup. These
  // changes must path-copy frozen descendants instead of changing captured P.
  document.layout = {
    stale: { x: 0, y: 0, width: 40 },
    "actual-ink": {
      x: 0,
      y: 0,
      width: 40,
      height: 30,
      contentSize: { width: 40, height: 30 },
    },
  } as any;
  document.surfaceViews = {
    [document.content.attrs!.id as string]: {
      initial: "missing-view",
      saved: [{ id: "empty", name: "Empty", targets: ["absent"] }],
      readingOrder: ["absent", "embedded-page", "actual-ink"],
    },
  } as any;
  (document as any).futureRoot = {
    literal: JSON.parse('{"é":1,"é":2}'),
    resources: ["data:image/png;base64,AAEC", "data:image/png;base64,AAEC"],
  };
  document.comments = [
    {
      id: "real-comment",
      text: "批注",
      createdAt: timestamp,
      resolved: false,
      futureComment: { keep: ["é", "é"] },
    } as any,
  ];
  return document;
}
function setup() {
  const raw = rawSource(),
    owner = new SourceRuntimeOwner(),
    scope = {
      homeId: "owned-normalization",
      projectId: "actual-project",
      pageId: raw.id,
    };
  const seed = owner.execute({
    kind: "seed",
    scope,
    document: normalizeSourceDocument(raw),
    proof: "normalized",
    leaseId: "base",
  }) as SourceSnapshotDelta;
  const incoming = structuredClone(raw);
  incoming.content.content![0].attrs!.color = "#ff0000";
  return {
    owner,
    raw,
    seed,
    request: {
      current: seed.next,
      publicationId: "actual-owned-normalization",
      sourceVersion: 1,
      packet: {
        pageId: raw.id,
        boardId: raw.content.attrs!.id as string,
        token: "actual-token",
        document: incoming,
        baseDocument: raw,
        operationIds: [],
      },
      leaseId: "output",
    },
  };
}
const resolve = (owner: SourceRuntimeOwner, ref: SourceSnapshotRef) =>
  (owner.execute({ kind: "resolve", ref }) as { document: ShowDocument })
    .document;
it("matches the complete public normalizer on actual frozen captured trees requiring structural repairs", () => {
  const { owner, raw, seed, request } = setup(),
    before = JSON.stringify(request),
    base = resolve(owner, seed.next),
    baseBytes = JSON.stringify(base),
    expected = normalizeSourceDocument(request.packet.document);
  const result = owner.registerActualNativeJSONIfUnchanged(
    JSON.stringify(request),
  )!;
  expect(result).not.toBeNull();
  expect(resolve(owner, result.next)).toEqual(expected);
  expect(JSON.stringify(request)).toBe(before);
  expect(JSON.stringify(base)).toBe(baseBytes);
  expect(raw.layout).toHaveProperty("stale");
  expect(raw.content.content![1].content![0].attrs).toBeUndefined();
  expect((resolve(owner, result.next) as any).futureRoot).toEqual(
    (raw as any).futureRoot,
  );
  expect(resolve(owner, result.next).comments).toEqual(raw.comments);
  // Retry compares against the original complete P, not its normalized result.
  const repeated = owner.registerActualNativePublicationIfUnchanged({
    ...request,
    current: result.next,
  })!;
  expect(resolve(owner, repeated.next)).toEqual(expected);
  expect(() =>
    owner.registerActualNativePublicationIfUnchanged({
      ...request,
      current: result.next,
      packet: { ...request.packet, document: expected },
    }),
  ).toThrow(/different complete packet/);
  expect(
    parseArtifact({
      format: "showai",
      version: 3,
      document: resolve(owner, result.next),
    }).document,
  ).toEqual(expected);
});
it("retains independent mutable public captures and refuses shallow-frozen input as ownership authority", () => {
  const { owner, request } = setup(),
    original = structuredClone(request),
    shallow = Object.freeze({ ...request.packet.document });
  request.packet.document = shallow;
  const result = owner.registerActualNativePublicationIfUnchanged(request)!;
  expect(resolve(owner, result.next)).toEqual(
    normalizeSourceDocument(original.packet.document),
  );
  expect(Object.isFrozen(original.packet.document.content)).toBe(false);
  (original.packet.document as any).futureRoot.literal["é"] = 99;
  expect((resolve(owner, result.next) as any).futureRoot.literal["é"]).toBe(1);
  const publicResult = normalizeSourceDocument(original.packet.document);
  expect(Object.isFrozen(publicResult)).toBe(false);
  publicResult.title = "Still mutable";
  expect(publicResult.title).toBe("Still mutable");
});
it("still rejects schema, numeric, date, resource and depth faults without modifying the actual source baseline", () => {
  const { owner, seed, request } = setup(),
    baseline = resolve(owner, seed.next),
    before = JSON.stringify(baseline);
  const cases = [
    (d: ShowDocument) => {
      d.createdAt = "not-a-date";
    },
    (d: ShowDocument) => {
      d.content.content![0].attrs!.ink = {
        ...(d.content.content![0].attrs!.ink as any),
        samples: [[NaN, 0]],
      };
    },
    (d: ShowDocument) => {
      d.content.content!.push({
        type: "image",
        attrs: {
          id: "unsafe-image",
          src: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      });
    },
    (d: ShowDocument) => {
      let child: any = null;
      for (let i = 0; i < 50; i++) child = { child };
      (d as any).futureDepth = child;
    },
    (d: ShowDocument) => {
      (d as any).futureRoot.reserved = JSON.parse('{"constructor":{}}');
    },
  ];
  cases.forEach((mutate, index) => {
    const document = structuredClone(request.packet.document);
    mutate(document);
    expect(
      () => normalizeSourceDocument(document),
      "public case " + index,
    ).toThrow();
    expect(() =>
      owner.registerActualNativePublicationIfUnchanged({
        ...request,
        publicationId: "invalid-" + index,
        packet: { ...request.packet, document },
      }),
    ).toThrow();
    expect(JSON.stringify(baseline)).toBe(before);
  });
  const valid = owner.registerActualNativeJSONIfUnchanged(
    JSON.stringify({ ...request, publicationId: "valid-after-errors" }),
  )!;
  expect(resolve(owner, valid.next)).toEqual(
    normalizeSourceDocument(request.packet.document),
  );
});
it("keeps the official full capacity gate and actual owner/epoch boundary on frozen-publication normalization", () => {
  const { owner, seed, request } = setup(),
    document = structuredClone(request.packet.document);
  (document as any).futurePadding = "x".repeat(CAPACITY.pageStructureBytes + 1);
  expect(() =>
    owner.registerActualNativePublicationIfUnchanged({
      ...request,
      publicationId: "too-large",
      packet: { ...request.packet, document },
    }),
  ).toThrow(/Page structure/);
  for (const ref of [
    { ...seed.next, epoch: "forged" },
    { ...seed.next, kind: "draft" as const },
    { ...seed.next, scope: { ...seed.next.scope, homeId: "other" } },
  ])
    expect(() =>
      owner.registerActualNativePublicationIfUnchanged({
        ...request,
        current: ref,
      }),
    ).toThrow(/epoch|scope|proof|expired/);
  owner.execute({ kind: "dispose", scope: seed.next.scope });
  expect(() =>
    owner.registerActualNativePublicationIfUnchanged(request),
  ).toThrow(/expired/);
}, 60000);

it("does not turn a caller-frozen accessor graph into consuming input authority", () => {
  const { owner, request } = setup();
  let lastRead: { note: string } | undefined;
  const document = structuredClone(request.packet.document);
  Object.defineProperty(document, "futureAccessor", {
    enumerable: true,
    get() {
      return (lastRead = { note: "Actual externally supplied value" });
    },
  });
  freezeOwnedSource(document);
  const result = owner.registerActualMergedPublication({
    current: request.current,
    publicationId: "external-owned-accessor",
    packet: request.packet,
    result: { document, conflicts: [] },
    leaseId: "accessor-output",
  });
  expect(lastRead).toBeDefined();
  expect(Object.isFrozen(lastRead)).toBe(false);
  lastRead!.note = "External later mutation";
  expect((resolve(owner, result.next) as any).futureAccessor.note).toBe(
    "Actual externally supplied value",
  );
});
