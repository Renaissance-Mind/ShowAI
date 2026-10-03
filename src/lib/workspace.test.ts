import { describe, expect, it } from "vitest";
import {
  canReparent,
  initialWorkspace,
  newDocument,
  toMarkdown,
} from "./workspace";
import {
  descendantIds,
  hasWorkspaceCapacity,
  validateHistory,
  importDocumentTree,
  validateWorkspace,
} from "./workspace-state";

describe("workspace persistence and hierarchy", () => {
  it("rejects malformed saved history before rendering or restoration", () => {
    expect(() => validateHistory(null)).toThrow();
    expect(() => validateHistory({ page: [null] })).toThrow();
    expect(() =>
      validateHistory({ page: [{ savedAt: "invalid", document: {} }] }),
    ).toThrow();
    const document = newDocument("版本");
    const history = {
      [document.id]: [{ document, savedAt: new Date().toISOString() }],
    };
    expect(validateHistory(history)).toEqual(history);
  });
  it("round-trips all initial document block data", () => {
    const initial = initialWorkspace();
    expect(validateWorkspace(JSON.parse(JSON.stringify(initial)))).toEqual(
      initial,
    );
  });
  it("enforces the page cap across merged imports and ordinary creation", () => {
    expect(hasWorkspaceCapacity(3, 1000)).toBe(false);
    expect(hasWorkspaceCapacity(999, 1)).toBe(true);
    expect(hasWorkspaceCapacity(1000, 1)).toBe(false);
  });
  it("rejects duplicate ids and cycles before rendering a tree", () => {
    const workspace = initialWorkspace();
    workspace.documents[1].id = workspace.documents[0].id;
    expect(() => validateWorkspace(workspace)).toThrow("重复");
    const cycle = initialWorkspace();
    cycle.documents[0].parentId = cycle.documents[1].id;
    cycle.documents[1].parentId = cycle.documents[0].id;
    expect(() => validateWorkspace(cycle)).toThrow("循环");
  });
  it("imports a backup under new ids while preserving parent relationships", () => {
    const parent = newDocument("Parent");
    const child = newDocument("Child", parent.id);
    const imported = importDocumentTree([parent, child]);
    expect(imported[0].id).not.toBe(parent.id);
    expect(imported[1].parentId).toBe(imported[0].id);
    expect(canReparent(imported, imported[0].id, imported[1].id)).toBe(false);
    expect(descendantIds(imported, imported[0].id)).toEqual([
      imported[0].id,
      imported[1].id,
    ]);
  });
  it("does not archive unrelated pages", () => {
    const parent = newDocument("Parent");
    const child = newDocument("Child", parent.id);
    const other = newDocument("Other");
    expect(descendantIds([parent, child, other], parent.id)).not.toContain(
      other.id,
    );
  });
  it("preserves interactive block source in Markdown export", () => {
    const doc = initialWorkspace().documents[0];
    const markdown = toMarkdown(doc.content);
    expect(markdown).toContain("```showai-block");
    expect(markdown).toContain("y = x²");
    expect(markdown).toContain("- [x]");
  });
});
