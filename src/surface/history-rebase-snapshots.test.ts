import { expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { addNode, editNode } from "./editing";
import { createResource } from "./containers.mjs";
import { findSurfaceNode } from "./document.mjs";
import { rebaseHistorySnapshots } from "./history-rebase";
import type { ShowDocument } from "../types";
function fixture() {
  let page = createResource(blankDocument(), "board") as ShowDocument;
  for (const [id, x] of [["local", 10], ["foreign", 200]] as const) page = addNode(page, { type: "drawing", attrs: { id, tool: "rectangle", color: "#111111", strokeWidth: 2, label: id, extent: [100, 60], points: [{ x: 0, y: 0 }, { x: 100, y: 60 }] } }, { x, y: 20, width: 100, height: 60 }, page.content.attrs!.id) as ShowDocument;
  return page;
}
const label = (document: ShowDocument, id: string) => findSurfaceNode(document, id)!.node.attrs!.label;
it("foreign native source receipts preserve local undo/redo while rebasing non-ink edits and action identities", () => {
  const base = fixture(), local = structuredClone(base); local.layout!.local.x = 80;
  const incoming = editNode(local, "foreign", node => { node.attrs!.label = "Remote label"; }) as ShowDocument;
  const redo = structuredClone(local); redo.layout!.local.x = 150;
  const action = { intentId: "local-intent", boardId: base.content.attrs!.id, operationIds: ["device:1"], strokeIds: ["stroke"] };
  const actions = new Map([[base, action], [redo, { ...action, operationIds: ["device:2"] }]]);
  const history = { past: [base], future: [redo], group: "native-content:move", at: 50 };
  rebaseHistorySnapshots(history, actions, local, incoming);
  expect(history.past[0].layout!.local.x).toBe(10); expect(history.future[0].layout!.local.x).toBe(150);
  expect(label(history.past[0], "foreign")).toBe("Remote label"); expect(label(history.future[0], "foreign")).toBe("Remote label");
  expect(actions.get(history.past[0])).toBe(action); expect(actions.get(history.future[0])!.operationIds).toEqual(["device:2"]);
  expect(actions.has(base)).toBe(false); expect(history.group).toBe(""); expect(history.at).toBe(0);
});
it("same-field foreign replacement remains authoritative and discarded snapshots release their metadata", () => {
  const base = fixture(), owned = editNode(base, "local", node => { node.attrs!.label = "Local label"; }) as ShowDocument;
  const incoming = editNode(owned, "local", node => { node.attrs!.label = "Remote replacement"; }) as ShowDocument;
  const history = { past: [base], future: [], group: "label", at: 1 }, actions = new Map([[base, { intentId: "label" }]]);
  rebaseHistorySnapshots(history, actions, owned, incoming);
  expect(history.past).toEqual([]); expect(actions.size).toBe(0);
});
it("a shared snapshot referenced by both stacks retains one action object after rebase", () => {
  const base = fixture(), local = structuredClone(base); local.layout!.local.x = 80;
  const incoming = editNode(local, "foreign", node => { node.attrs!.label = "Remote"; }) as ShowDocument;
  const action = { intentId: "shared" }, actions = new Map([[base, action]]), history = { past: [base], future: [base], group: "", at: 0 };
  rebaseHistorySnapshots(history, actions, local, incoming);
  expect(history.past[0]).toBe(history.future[0]); expect(actions.size).toBe(1); expect(actions.get(history.future[0])).toBe(action);
});
