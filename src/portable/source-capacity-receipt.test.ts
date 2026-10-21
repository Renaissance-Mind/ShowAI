import { expect, it } from "vitest";
import {
  CAPACITY,
  measureContent,
  contentMeasurementDepth,
} from "./capacity.mjs";
import {
  parseArtifact,
  validateDocument,
  parseArtifactForSourceSnapshot,
  parseArtifactConsumingForSourceSnapshot,
  parseArtifactWithValidatedDocument,
  shareSourceSnapshotDocument,
  inheritSourceSnapshotTimestampCapacity,
  assertOwnedSourceDocumentCapacity,
  hasSourceSnapshotCapacity,
} from "./validation.mjs";
import {
  SourceRuntimeOwner,
  freezeOwnedSource,
  cloneSourceValue,
  type SourceSnapshotDelta,
  type SourceSnapshotRef,
} from "../surface/source-runtime";
import { blankDocument } from "../core/catalog";
import type { ShowDocument } from "../types";
const fixed = "2026-10-21T00:00:00.000Z";
function source() {
  return {
    ...blankDocument(),
    id: "receipt-real-page",
    createdAt: fixed,
    updatedAt: fixed,
    future: {
      comments: ['中文\n"escaped"', "é", "e\u0301", "\ud800"],
      resources: ["data:image/png;base64,AAEC", "data:image/png;base64,AAEC"],
    },
  } as ShowDocument;
}
const scope = {
  homeId: "capacity-owner",
  projectId: "real-project",
  pageId: "receipt-real-page",
};
const delta = (v: unknown) => v as SourceSnapshotDelta;
function held(owner: SourceRuntimeOwner, ref: SourceSnapshotRef) {
  return (owner.execute({ kind: "resolve", ref }) as { document: ShowDocument })
    .document;
}
function owned(document = source()) {
  return parseArtifactForSourceSnapshot({
    format: "showai",
    version: 1,
    document,
  }).document;
}
it("mints proof only in the actual closed canonical ownership factory, preserving ordinary mutable imports", () => {
  const publicBody = validateDocument(source());
  expect(Object.isFrozen(publicBody)).toBe(false);
  expect(hasSourceSnapshotCapacity(publicBody)).toBe(false);
  (publicBody as any).future.comments.push("caller changed after validation");
  Object.freeze(publicBody);
  expect(hasSourceSnapshotCapacity(publicBody)).toBe(false);
  freezeOwnedSource(publicBody);
  expect(hasSourceSnapshotCapacity(publicBody)).toBe(false);
  const input = source(),
    body = owned(input);
  expect(hasSourceSnapshotCapacity(body)).toBe(true);
  expect(Object.isFrozen((body as any).future.comments)).toBe(true);
  (input as any).future.comments.push("external input still mutable");
  expect((body as any).future.comments).not.toContain(
    "external input still mutable",
  );
  const forged = freezeOwnedSource({
    ...cloneSourceValue(body),
    capacityReceipt: { format: "proved", jsonBytes: 1 },
    kind: "normalized",
  });
  expect(hasSourceSnapshotCapacity(forged)).toBe(false);
  expect(() =>
    inheritSourceSnapshotTimestampCapacity(forged, body),
  ).not.toThrow();
  expect(inheritSourceSnapshotTimestampCapacity(forged, body)).toBe(false);
  expect(
    parseArtifact({ format: "showai", version: 1, document: input }).document,
  ).toBeDefined();
});
it("retains official receipt only after exact COW sharing into an actual recursively owned final body", () => {
  const base = owned(),
    incoming = owned({ ...source(), title: "New title" }),
    shared = shareSourceSnapshotDocument(base, incoming);
  expect(shared).not.toBe(base);
  expect(shared.content).toBe(base.content);
  expect((shared as any).future).toBe((base as any).future);
  expect(shared.title).toBe("New title");
  expect(hasSourceSnapshotCapacity(shared)).toBe(true);
  expect(
    parseArtifactWithValidatedDocument(
      { format: "showai", version: 1, document: shared },
      shared,
    ),
  ).toEqual(parseArtifact({ format: "showai", version: 1, document: shared }));
  expect(() =>
    shareSourceSnapshotDocument(Object.freeze({ ...source() }), incoming),
  ).toThrow(/actual owned/);
  expect(
    hasSourceSnapshotCapacity(freezeOwnedSource(cloneSourceValue(shared))),
  ).toBe(false);
});
it("source registry preserves receipt through normalized sharing, exact date COW, growth gates and ref retirement", () => {
  const owner = new SourceRuntimeOwner({
      maximumUnleased: 0,
      maximumResidentBytes: 1024,
    }),
    initial = delta(
      owner.execute({
        kind: "seed",
        scope,
        document: source(),
        proof: "normalized",
        leaseId: "base",
      }),
    ),
    base = held(owner, initial.next);
  expect(hasSourceSnapshotCapacity(base)).toBe(true);
  const draft = delta(
      owner.execute({
        kind: "draft",
        base: initial.next,
        edits: [{ op: "set", path: ["updatedAt"], value: "2026-10-21" }],
        transactionId: "actual-date",
        leaseId: "date",
      }),
    ),
    date = held(owner, draft.next);
  expect(draft.next.kind).toBe("draft");
  expect(hasSourceSnapshotCapacity(date)).toBe(true);
  expect(date.content).toBe(base.content);
  expect(
    owner.normalizedDocumentMatching({
      ref: draft.next,
      document: cloneSourceValue(date),
    }),
  ).toBe(date);
  const invalid = delta(
    owner.execute({
      kind: "draft",
      base: draft.next,
      edits: [{ op: "set", path: ["updatedAt"], value: "invalid-date" }],
      transactionId: "bad-date",
      leaseId: "bad",
    }),
  );
  expect(hasSourceSnapshotCapacity(held(owner, invalid.next))).toBe(false);
  expect(() => owner.execute({ kind: "normalize", ref: invalid.next })).toThrow(
    /ISO/,
  );
  const changed = delta(
    owner.execute({
      kind: "draft",
      base: draft.next,
      edits: [
        {
          op: "set",
          path: ["future", "comments", 0],
          value: "new actual unknown field",
        },
      ],
      transactionId: "changed-body",
      leaseId: "changed",
    }),
  );
  expect(hasSourceSnapshotCapacity(held(owner, changed.next))).toBe(false);
  const normalized = delta(
    owner.execute({
      kind: "normalize",
      ref: changed.next,
      leaseId: "normalized",
    }),
  );
  expect(hasSourceSnapshotCapacity(held(owner, normalized.next))).toBe(true);
  owner.execute({ kind: "dispose", scope });
  expect(() =>
    owner.normalizedDocumentMatching({ ref: initial.next, document: base }),
  ).toThrow(/expired/);
});
it("date growth past an actual canonical page limit leaves a recoverable draft without capacity authority", () => {
  const originalOwner = new SourceRuntimeOwner(),
    original = delta(
      originalOwner.execute({
        kind: "seed",
        scope,
        document: { ...source(), updatedAt: "2026-10-21" },
        proof: "normalized",
        leaseId: "baseline",
      }),
    ),
    document = held(originalOwner, original.next),
    mutable = cloneSourceValue(document) as ShowDocument & { padding: string };
  mutable.padding = "";
  mutable.padding = "x".repeat(
    CAPACITY.pageStructureBytes - measureContent(mutable).structureBytes,
  );
  const owner = new SourceRuntimeOwner(),
    seed = delta(
      owner.execute({
        kind: "seed",
        scope,
        document: mutable,
        proof: "normalized",
        leaseId: "limit",
      }),
    ),
    before = held(owner, seed.next);
  expect(measureContent(before).structureBytes).toBe(
    CAPACITY.pageStructureBytes,
  );
  const next = delta(
      owner.execute({
        kind: "draft",
        base: seed.next,
        edits: [{ op: "set", path: ["updatedAt"], value: fixed }],
        transactionId: "growing-date",
        leaseId: "oversize",
      }),
    ),
    after = held(owner, next.next);
  expect(after.updatedAt).toBe(fixed);
  expect(next.next.kind).toBe("draft");
  expect(hasSourceSnapshotCapacity(after)).toBe(false);
  expect(
    owner.normalizedDocumentMatching({ ref: next.next, document: after }),
  ).toBeNull();
  expect(() =>
    parseArtifact({ format: "showai", version: 1, document: after }),
  ).toThrow(/Page structure/);
}, 60000);
it("fresh wrappers preserve complete unknown metadata, resource JSON counts, validation and depth semantics", () => {
  const body = owned(),
    artifact = {
      format: "showai",
      version: 1,
      document: body,
      futureWrapper: {
        text: '中文\n"\\',
        duplicate: ["data:image/png;base64,AAEC", "data:image/png;base64,AAEC"],
      },
    };
  expect(parseArtifactWithValidatedDocument(artifact, body)).toEqual(
    parseArtifact(artifact),
  );
  const consume = (value: unknown) =>
    parseArtifactConsumingForSourceSnapshot(cloneSourceValue(value));
  expect(consume(artifact)).toEqual(parseArtifact(artifact));
  for (const patch of [
    { version: 99 },
    { presentation: "invalid" },
    { components: [{}] },
    { remoteComponents: [{}] },
    { selection: { blockIds: ["missing"] } },
  ]) {
    expect(() =>
      parseArtifactWithValidatedDocument({ ...artifact, ...patch }, body),
    ).toThrow();
    expect(() => parseArtifact({ ...artifact, ...patch })).toThrow();
    expect(() => consume({ ...artifact, ...patch })).toThrow();
  }
  let deep: any = 0;
  for (let i = 0; i < 64; i++) deep = { child: deep };
  expect(() =>
    parseArtifactWithValidatedDocument(
      { ...artifact, futureWrapper: deep },
      body,
    ),
  ).toThrow(/deeply/);
  expect(() => consume({ ...artifact, futureWrapper: deep })).toThrow(/deeply/);
  const detached = cloneSourceValue(body);
  expect(() =>
    parseArtifactWithValidatedDocument(
      { ...artifact, document: detached },
      body,
    ),
  ).toThrow(/actual registered/);
  // Even a trusted capacity-only actual-save measurement of a 64-deep body
  // cannot prove that embedding it at artifact.document stays within64.
  const capacityOnly = cloneSourceValue(body) as any;
  deep = 0;
  for (let i = 0; i < 63; i++) deep = { child: deep };
  capacityOnly.futureDeep = deep;
  freezeOwnedSource(capacityOnly);
  assertOwnedSourceDocumentCapacity(capacityOnly);
  expect(() =>
    parseArtifactWithValidatedDocument(
      { format: "showai", version: 1, document: capacityOnly },
      capacityOnly,
    ),
  ).toThrow(/deeply/);
  expect(contentMeasurementDepth(measureContent({ a: [1, "中"] }))).toBe(2);
  expect(contentMeasurementDepth({ ...measureContent(1) })).toBeNull();
});
it("consuming factory owns its actual parsed graph without changing the public consuming parser contract", () => {
  const artifact = JSON.parse(
      JSON.stringify({ format: "showai", version: 1, document: source() }),
    ),
    result = parseArtifactConsumingForSourceSnapshot(artifact);
  expect(hasSourceSnapshotCapacity(result.document)).toBe(true);
  expect(Object.isFrozen(result.document.content)).toBe(true);
  expect(
    parseArtifactWithValidatedDocument({ ...result }, result.document),
  ).toEqual(parseArtifact(result));
});
it("actual consuming measurements cannot be asserted through JSON fields or hide invalid content", () => {
  const input = {
    format: "showai",
    version: 1,
    document: source(),
    inputCapacity: {
      document: {},
      sizes: { structureBytes: 0, jsonBytes: 0, resourceBytes: 0 },
    },
  };
  expect(
    parseArtifactConsumingForSourceSnapshot(cloneSourceValue(input)),
  ).toEqual(parseArtifact(input));
  const oversized = {
    ...input,
    document: { ...source(), future: "x".repeat(CAPACITY.pageStructureBytes) },
  };
  expect(() => parseArtifactConsumingForSourceSnapshot(oversized)).toThrow(
    /Page structure/,
  );
  const badDate = { ...input, document: { ...source(), updatedAt: "invalid" } };
  expect(() => parseArtifactConsumingForSourceSnapshot(badDate)).toThrow(
    /ISO date/,
  );
});
it("honors the actual 256MiB wrapper boundary and falls back rather than rejecting a safe conservative date bound", () => {
  const body = owned(),
    artifact = {
      format: "showai",
      version: 1,
      document: body,
      futurePadding: "",
    };
  let padding = CAPACITY.artifactBytes - measureContent(artifact).jsonBytes;
  artifact.futurePadding = "x".repeat(padding);
  expect(parseArtifactWithValidatedDocument(artifact, body).document).toBe(
    body,
  );
  expect(
    parseArtifactConsumingForSourceSnapshot({
      ...artifact,
      document: cloneSourceValue(body),
    }).document,
  ).toEqual(body);
  expect(() =>
    parseArtifactWithValidatedDocument(
      { ...artifact, futurePadding: artifact.futurePadding + "x" },
      body,
    ),
  ).toThrow(/Artifact JSON/);
  expect(() =>
    parseArtifactConsumingForSourceSnapshot({
      ...artifact,
      document: cloneSourceValue(body),
      futurePadding: artifact.futurePadding + "x",
    }),
  ).toThrow(/Artifact JSON/);
  const shorter = freezeOwnedSource({ ...body, updatedAt: "2026-10-21" });
  expect(inheritSourceSnapshotTimestampCapacity(body, shorter)).toBe(true);
  const small = {
    format: "showai",
    version: 1,
    document: shorter,
    futurePadding: "",
  };
  padding = CAPACITY.artifactBytes - measureContent(small).jsonBytes;
  small.futurePadding = "x".repeat(padding);
  // The inherited upper still includes the longer timestamp. The fast upper
  // exceeds the cap, while the true full artifact is exactly valid.
  expect(parseArtifactWithValidatedDocument(small, shorter).document).toBe(
    shorter,
  );
}, 60000);
it("registers a real FileStore CAS result and rejects altered or retired actual references", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { FileStore } = await import("../core/store");
  const directory = await mkdtemp(join(tmpdir(), "source-capacity-store-"));
  try {
    const store = new FileStore(directory),
      project = await store.createProject({ name: "Capacity receipt" }),
      page = await store.createPage(project.id, { kind: "board" }),
      actualScope = {
        homeId: directory,
        projectId: project.id,
        pageId: page.document.id,
      },
      owner = new SourceRuntimeOwner();
    const initial = delta(
        owner.execute({
          kind: "seed",
          scope: actualScope,
          document: page.document,
          proof: "normalized",
          leaseId: "view",
        }),
      ),
      draft = delta(
        owner.execute({
          kind: "draft",
          base: initial.next,
          edits: [{ op: "set", path: ["title"], value: "Actual saved edit" }],
          transactionId: "real-title",
          leaseId: "edit",
        }),
      ),
      document = held(owner, draft.next);
    expect(hasSourceSnapshotCapacity(document)).toBe(false);
    const saved = await store.savePage(
        project.id,
        document.id,
        document,
        page.hash,
        page.revision,
      ),
      snapshot = owner.registerActualSavedSnapshot({
        scope: actualScope,
        document: saved.document,
        base: draft.next,
        leaseId: "saved",
      }),
      body = held(owner, snapshot.next);
    expect(hasSourceSnapshotCapacity(body)).toBe(true);
    expect(
      (await new FileStore(directory).readPage(project.id, document.id))
        .document,
    ).toEqual(saved.document);
    expect(
      parseArtifactWithValidatedDocument(
        { format: "showai", version: 3, document: body },
        body,
      ),
    ).toEqual(parseArtifact({ format: "showai", version: 3, document: body }));
    const changed = cloneSourceValue(body);
    (changed as any).futureInjected = { bytes: "not captured" };
    expect(
      owner.normalizedDocumentMatching({
        ref: snapshot.next,
        document: changed,
      }),
    ).toBeNull();
    expect(() =>
      owner.normalizedDocumentMatching({
        ref: { ...snapshot.next, epoch: "forged" },
        document: body,
      }),
    ).toThrow(/epoch/);
    owner.execute({ kind: "dispose", scope: actualScope });
    expect(() =>
      owner.normalizedDocumentMatching({ ref: snapshot.next, document: body }),
    ).toThrow(/expired/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("captures wrapper accessors before measuring its independent document", () => {
  const document = source();
  const expected = structuredClone(document);
  const input = { format: "showai", version: 1, document };
  Object.defineProperty(input, "unknownWrapper", {
    enumerable: true,
    get() {
      (document as any).future = "x".repeat(CAPACITY.pageStructureBytes);
      return { actual: true };
    },
  });
  const result = parseArtifactConsumingForSourceSnapshot(input).document;
  expect(result).toEqual(
    parseArtifact({ format: "showai", version: 1, document: expected })
      .document,
  );
  expect(measureContent(result).structureBytes).toBeLessThan(
    CAPACITY.pageStructureBytes,
  );
  expect(hasSourceSnapshotCapacity(result)).toBe(true);
  expect(() => parseArtifact(input)).toThrow(/limit|large|exceed/i);
});

it("observers cannot mutate measured aliases or obtain authority from a generic frozen getter graph", () => {
  for (const stage of [
    "input.capacity",
    "json",
    "capacity",
    "capacityPreimage",
    "canonicalCapacity",
  ]) {
    const document = source(),
      expected = structuredClone(document);
    const result = parseArtifactConsumingForSourceSnapshot(
      { format: "showai", version: 1, document },
      (name: string) => {
        if (name === stage)
          (document as any).future = "x".repeat(CAPACITY.pageStructureBytes);
      },
    ).document;
    expect(result).toEqual(
      parseArtifact({ format: "showai", version: 1, document: expected })
        .document,
    );
    expect(hasSourceSnapshotCapacity(result)).toBe(true);
  }
  let actual = source();
  const getter = Object.defineProperty({}, "document", {
    enumerable: true,
    get: () => actual,
  });
  freezeOwnedSource(getter);
  actual = {
    ...source(),
    future: "x".repeat(CAPACITY.pageStructureBytes),
  } as ShowDocument;
  expect(() =>
    parseArtifactConsumingForSourceSnapshot({
      format: "showai",
      version: 1,
      document: (getter as any).document,
    }),
  ).toThrow(/limit|large|exceed/i);
});
