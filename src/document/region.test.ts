import { expect, test } from "vitest";
import { validateRegionData, regionGridStyle } from "./region.mjs";
import { createResource } from "./containers.mjs";
import { blankDocument } from "../core/catalog";
import {
  insertComponent,
  nativeComponentDocument,
} from "../surface/component-insertion";
import { findSurfaceNode } from "./document.mjs";
import { applyOperations } from "../core/diff";
import { validateDocument } from "../portable/validation.mjs";

test("catalog layout insertion creates native regions and retains editable child identities", () => {
  const input = {
    columns: 2,
    minColumnWidth: 320,
    blocks: [
      {
        kind: "region",
        data: {
          mode: "flow",
          blocks: [
            {
              kind: "text",
              data: { content: "Figure explanation", format: "plain" },
            },
          ],
        },
      },
      {
        kind: "chart",
        data: {
          labels: ["A", "B"],
          series: [{ name: "Score", values: [4, 6] }],
        },
      },
    ],
  };
  const added = insertComponent(
    createResource(blankDocument()),
    null,
    "region",
    input,
  );
  const node = findSurfaceNode(added.document, added.nodeId)!.node;
  expect(node.type).toBe("region");
  expect(node.content!.map((n) => n.type)).toEqual(["region", "widget"]);
  const ids = node.content!.map((n) => n.attrs!.id);
  expect(added.document.layout[added.nodeId]).toMatchObject({
    mode: "grid",
    columns: 2,
    minColumnWidth: 320,
    gap: 24,
  });
  const changed = applyOperations(added.document, [
    {
      type: "component.props.set",
      blockId: added.nodeId,
      props: { columns: 3, gap: 16, name: "comparison" },
    },
  ]);
  expect(changed.layout![added.nodeId]).toMatchObject({
    columns: 3,
    gap: 16,
    minColumnWidth: 320,
  });
  expect(
    findSurfaceNode(changed, added.nodeId)!.node.content!.map(
      (n) => n.attrs!.id,
    ),
  ).toEqual(ids);
  expect(() => validateDocument(changed)).not.toThrow();
  expect(nativeComponentDocument("region", input).content.type).toBe("surface");
});

test("old regions gain defaults without migration and reject invalid layout values", () => {
  const added = insertComponent(
    createResource(blankDocument()),
    null,
    "region",
    { mode: "flow" },
  );
  delete added.document.layout[added.nodeId].minColumnWidth;
  const changed = applyOperations(added.document, [
    {
      type: "component.props.set",
      blockId: added.nodeId,
      props: { mode: "grid" },
    },
  ]);
  expect(
    regionGridStyle(changed.layout![added.nodeId]).gridTemplateColumns,
  ).toContain("320px");
  for (const data of [
    { columns: 0 },
    { columns: 1.5 },
    { minColumnWidth: 50 },
    { gap: -1 },
    { title: "Visible title" },
    { blocks: [{ kind: "text" }] },
  ])
    expect(() => validateRegionData(data)).toThrow();
  expect(() =>
    applyOperations(changed, [
      {
        type: "component.props.set",
        blockId: added.nodeId,
        props: { blocks: [] },
      },
    ]),
  ).toThrow("children");
  expect(() =>
    applyOperations(changed, [
      {
        type: "surface.layout.set",
        nodeId: added.nodeId,
        layout: { x: 0, y: 0, width: 760, minColumnWidth: 20 },
      },
    ]),
  ).toThrow();
});
