import { describe, expect, it } from "vitest";
import { ReaderSource } from "./reader-source";
import { blocksDocument } from "../agent/page-authoring";

function artifact(title: string) {
  const document = blocksDocument(
    [
      {
        kind: "chart",
        data: {
          labels: ["A"],
          series: [{ name: "result", values: [1] }],
        },
      },
    ],
    title,
  );
  return JSON.stringify({ format: "showai", version: 3, document });
}

describe("live reader source", () => {
  it("publishes validated source changes and ignores duplicate delivery", () => {
    const first = artifact("First");
    const source = new ReaderSource(first);
    let updates = 0;
    const stop = source.subscribe(() => {
      updates++;
    });
    const document = JSON.parse(first);
    document.document.title = "Next";
    const next = JSON.stringify(document);
    source.update(next);
    expect(source.read()).toBe(next);
    expect(updates).toBe(1);
    source.update(next);
    expect(updates).toBe(1);
    stop();
    source.update(first);
    expect(updates).toBe(1);
  });
  it("rejects invalid input without notifying or replacing the current view", () => {
    const first = artifact("First");
    const source = new ReaderSource(first);
    let updates = 0;
    source.subscribe(() => {
      updates++;
    });
    expect(() => source.update('{"document":')).toThrow();
    expect(source.read()).toBe(first);
    expect(updates).toBe(0);
  });
  it("does not accept updates or listeners after disposal", () => {
    const first = artifact("First");
    const source = new ReaderSource(first);
    source.dispose();
    expect(() => source.update(first)).toThrow("disposed");
    expect(() => source.subscribe(() => {})).toThrow("disposed");
  });
});
