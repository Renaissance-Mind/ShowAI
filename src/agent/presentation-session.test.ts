import { expect, it } from "vitest";
import { blocksDocument } from "./page-authoring";
import { PresentationSession } from "./presentation-session";
import { builtinComponentCatalog } from "../contract/catalog";

function fixture() {
  const document = blocksDocument([
    {
      kind: "chart",
      data: {
        labels: ["A"],
        series: [{ name: "result", values: [1] }],
      },
    },
  ]);
  return {
    document,
    session: new PresentationSession(
      "view-one",
      JSON.stringify({
        format: "showai",
        version: 3,
        document,
      }),
    ),
  };
}

it.each(builtinComponentCatalog().filter((item) => !item.insertion))(
  "retains the complete input of builtin $kind through the live snapshot path",
  (component) => {
    const document = blocksDocument([
      { kind: component.kind, data: structuredClone(component.defaultData) },
    ]);
    const session = new PresentationSession(
      "builtin",
      JSON.stringify({ format: "showai", version: 3, document }),
    );
    const before = JSON.parse(session.snapshot().source);
    const after = session.apply({
      operationId: "complete",
      baseRevision: 0,
      operations: [],
      complete: true,
    });
    expect(JSON.parse(after.source)).toEqual(before);
  },
);

it("updates existing component data while preserving the view and node identity", () => {
  const { document, session } = fixture();
  const blockId = document.content.content![0].attrs!.id;
  const input = {
    operationId: "batch-one",
    baseRevision: 0,
    operations: [
      {
        type: "component.props.set" as const,
        blockId,
        props: {
          labels: ["A", "B"],
          series: [{ name: "result", values: [1, 2] }],
        },
      },
    ],
  };
  const updated = session.apply(input);
  const saved = JSON.parse(updated.source).document;
  expect(updated.viewId).toBe("view-one");
  expect(saved.id).toBe(document.id);
  expect(saved.content.content[0].attrs.id).toBe(blockId);
  expect(saved.content.content[0].attrs.data.labels).toEqual(["A", "B"]);
  expect(session.apply(input)).toBe(updated);
  expect(() => session.apply({ ...input, operationId: "stale" })).toThrow(
    "conflict",
  );
});

it("rolls back a failed batch and retains complete source after completion", () => {
  const { document, session } = fixture();
  const original = session.snapshot();
  expect(() =>
    session.apply({
      operationId: "bad",
      baseRevision: 0,
      operations: [
        { type: "page.set", fields: { title: "Must not persist" } },
        { type: "block.remove", blockId: "missing" },
      ],
    }),
  ).toThrow();
  expect(session.snapshot()).toBe(original);
  const done = session.apply({
    operationId: "done",
    baseRevision: 0,
    operations: [],
    complete: true,
  });
  expect(JSON.parse(done.source).document.title).toBe(document.title);
  expect(
    session.apply({
      operationId: "done",
      baseRevision: 0,
      operations: [],
      complete: true,
    }),
  ).toBe(done);
  expect(() =>
    session.apply({ operationId: "late", baseRevision: 1, operations: [] }),
  ).toThrow("complete");
});

it("rejects an incomplete chart batch and accepts the related fields together", () => {
  const { document, session } = fixture();
  const blockId = document.content.content![0].attrs!.id;
  const original = session.snapshot();
  expect(() =>
    session.apply({
      operationId: "partial",
      baseRevision: 0,
      operations: [
        { type: "component.props.set", blockId, props: { labels: ["A", "B"] } },
      ],
    }),
  ).toThrow("matching labels");
  expect(session.snapshot()).toBe(original);
  const complete = session.apply({
    operationId: "both",
    baseRevision: 0,
    operations: [
      {
        type: "component.props.set",
        blockId,
        props: {
          labels: ["A", "B"],
          series: [{ name: "result", values: [1, 2] }],
        },
      },
    ],
  });
  expect(complete.revision).toBe(1);
});

it("rejects project dataset bindings without changing temporary content", () => {
  const { document, session } = fixture();
  const blockId = document.content.content![0].attrs!.id;
  const original = session.snapshot();
  expect(() =>
    session.apply({
      operationId: "binding",
      baseRevision: 0,
      operations: [
        {
          type: "block.attrs.set",
          blockId,
          attrs: { data: { $binding: { dataset: "private", props: {} } } },
        },
      ],
    }),
  ).toThrow();
  expect(session.snapshot()).toBe(original);
});

it("prepares resources without publishing and rejects a commit after another writer", () => {
  const { session } = fixture();
  const first = session.snapshot();
  const prepared = session.prepare({ operationId: "prepared", baseRevision: 0, operations: [{ type: "page.set", fields: { title: "Prepared" } }] });
  expect(session.snapshot()).toBe(first);
  expect(() => prepared.commit("invalid JSON")).toThrow();
  expect(session.snapshot()).toBe(first);
  const other = session.apply({ operationId: "other", baseRevision: 0, operations: [{ type: "page.set", fields: { title: "Other" } }] });
  expect(() => prepared.commit()).toThrow("changed while preparing");
  expect(session.snapshot()).toBe(other);
});

it("does not publish pending resource work after its view is closed", () => {
  const { session } = fixture();
  const original = session.snapshot();
  const pending = session.prepare({ operationId: "pending", baseRevision: 0, operations: [] });
  session.close();
  expect(() => pending.commit()).toThrow("closed");
  expect(session.snapshot()).toBe(original);
});
