import { describe, expect, it } from "vitest";
import { findComponent, indexComponents } from "./component-index";
import type { CompiledComponent } from "./types";

function component(
  integrity: string,
  scope: CompiledComponent["scope"],
  html: string,
): CompiledComponent {
  return {
    id: "same-name",
    name: "Same name",
    version: "1.0.0",
    description: "",
    scenarios: [],
    entry: "index.tsx",
    defaultData: {},
    examples: [],
    scope,
    integrity,
    html,
    schema: { type: "object" },
    updatedAt: "2026-10-04T00:00:00.000Z",
  };
}
describe("runtime component identity", () => {
  it("selects the pinned fingerprint when project and global have the same id/version", () => {
    const project = component(
      "sha256-" + "a".repeat(64),
      "project",
      "project payload",
    );
    const global = component(
      "sha256-" + "b".repeat(64),
      "global",
      "global payload",
    );
    const index = indexComponents([project, global]);
    expect(index.size).toBe(2);
    expect(
      findComponent(index, {
        componentId: project.id,
        version: project.version,
        integrity: global.integrity,
        scope: "project",
      }),
    ).toBe(global);
    expect(
      findComponent(index, {
        componentId: project.id,
        version: project.version,
        integrity: project.integrity,
      }),
    ).toBe(project);
    expect(
      findComponent(index, {
        componentId: project.id,
        version: project.version,
        integrity: "sha256-" + "c".repeat(64),
      }),
    ).toBeUndefined();
  });
  it("allows only an unambiguous legacy lookup and rejects forged duplicate payloads", () => {
    const first = component("sha256-" + "a".repeat(64), "project", "A");
    const second = component("sha256-" + "b".repeat(64), "global", "B");
    expect(
      findComponent(indexComponents([first]), {
        componentId: first.id,
        version: first.version,
      }),
    ).toBe(first);
    expect(() =>
      findComponent(indexComponents([first, second]), {
        componentId: first.id,
        version: first.version,
      }),
    ).toThrow("完整性指纹");
    expect(() =>
      indexComponents([first, { ...first, html: "Changed" }]),
    ).toThrow("same fingerprint");
  });
});
