import { describe, expect, it } from "vitest";
import {
  builtinComponent,
  builtinComponentCatalog,
  readBuiltinComponentCatalog,
} from "./catalog";
import { insertComponent } from "../surface/component-insertion";
import { createResource } from "../document/containers.mjs";
import { blankDocument } from "../core/catalog";

describe("built-in component catalog sharing", () => {
  it("lists the same current components as a fresh catalog", () => {
    expect(readBuiltinComponentCatalog()).toEqual(builtinComponentCatalog());
    expect(readBuiltinComponentCatalog()).toBe(readBuiltinComponentCatalog());
  });

  it("finds legacy and current kinds like a full catalog search", () => {
    for (const item of builtinComponentCatalog({ includeLegacy: true }))
      expect(builtinComponent(item.kind)).toEqual(
        builtinComponentCatalog({ includeLegacy: true }).find(
          (candidate) => candidate.kind === item.kind,
        ),
      );
    expect(builtinComponent("not-a-component")).toBeUndefined();
  });

  it("keeps fresh catalogs independent of the shared copy", () => {
    const shared = builtinComponent("chart")!;
    const fresh = builtinComponentCatalog({ includeLegacy: true });
    const item = fresh.find((candidate) => candidate.kind === "chart")!;
    expect(item).not.toBe(shared);
    expect(item.defaultData).not.toBe(shared.defaultData);
    (item.defaultData as Record<string, unknown>).title = "changed";
    item.documentation = undefined;
    expect(builtinComponent("chart")!.defaultData.title).not.toBe("changed");
    expect(builtinComponent("chart")!.documentation).toBeDefined();
    const again = builtinComponentCatalog({ includeLegacy: true }).find(
      (candidate) => candidate.kind === "chart",
    )!;
    expect(again.defaultData.title).not.toBe("changed");
    expect(again.documentation).toBeDefined();
  });

  it("inserts a component without changing the shared default data", () => {
    const before = JSON.stringify(builtinComponent("chart")!.defaultData);
    const data = structuredClone(builtinComponent("chart")!.defaultData);
    const document = createResource(blankDocument(), "page");
    const inserted = insertComponent(document, null, "chart", data);
    expect(inserted.nodeId).toBeTruthy();
    expect(JSON.stringify(builtinComponent("chart")!.defaultData)).toBe(before);
  });
});
