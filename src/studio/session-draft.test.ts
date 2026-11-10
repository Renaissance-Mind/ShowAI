import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  readSessionDraft,
  updateSessionDraft,
  useSessionDraft,
} from "./session-draft";

function Field({ id }: { id: string }) {
  const [value] = useSessionDraft(id, "");
  return createElement("input", { value, readOnly: true });
}

describe("session drafts", () => {
  it("shows what was typed when a section mounts again", () => {
    expect(renderToString(createElement(Field, { id: "test.name" }))).toContain(
      'value=""',
    );
    updateSessionDraft("test.name", "", "DeepSeek");
    expect(renderToString(createElement(Field, { id: "test.name" }))).toContain(
      'value="DeepSeek"',
    );
  });

  it("applies updates from the stored value, also after unmount", () => {
    updateSessionDraft("test.count", 0, 1);
    expect(updateSessionDraft("test.count", 0, (before) => before + 1)).toBe(2);
    updateSessionDraft("test.count", 0, 0);
    expect(readSessionDraft("test.count", 5)).toBe(0);
  });
});
