import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { completePageReaders, stageReader } from "./archived-reader";
import type { FileChanges } from "./history-model";
import type { ShowDocument } from "../types";

const viewer = resolve("dist-portable/portable.html");
const page = (content: unknown[]) =>
  ({
    id: "omits",
    title: "Omitted capabilities",
    content: {
      type: "doc",
      content: [
        {
          type: "widget",
          attrs: {
            id: "body",
            kind: "text",
            data: { format: "richtext", content: { type: "doc", content } },
          },
        },
      ],
    },
  }) as unknown as ShowDocument;
const plain = page([
  { type: "paragraph", content: [{ type: "text", text: "Plain" }] },
]);
const formula = page([{ type: "mathBlock", attrs: { latex: "x^2" } }]);
const code = page([
  {
    type: "codeBlock",
    attrs: { language: "js" },
    content: [{ type: "text", text: "let x = 1;" }],
  },
]);
const pagePath = "projects/p1/pages/omits.json";

describe.skipIf(!existsSync(viewer))("archived readers and omitted capabilities", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.SHOWAI_VIEWER;
    process.env.SHOWAI_VIEWER = viewer;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.SHOWAI_VIEWER;
    else process.env.SHOWAI_VIEWER = previous;
  });
  const staged = async (captured: ShowDocument, saved: ShowDocument) => {
    const changes: FileChanges = new Map();
    await stageReader(changes, pagePath, captured);
    changes.set(pagePath, Buffer.from(JSON.stringify({ document: saved })));
    return changes;
  };
  const read = async (path: string): Promise<Buffer> => {
    throw new Error(`unexpected read ${path}`);
  };

  it("keeps a reader that already covers the page", async () => {
    await expect(
      completePageReaders(await staged(plain, plain), read),
    ).resolves.toBeUndefined();
    await expect(
      completePageReaders(await staged(formula, formula), read),
    ).resolves.toBeUndefined();
    await expect(
      completePageReaders(await staged(code, code), read),
    ).resolves.toBeUndefined();
  });
  it("rejects a reader without formulas for a page that gained one", async () => {
    await expect(
      completePageReaders(await staged(plain, formula), read),
    ).rejects.toThrow("kind or capability");
  });
  it("rejects a reader without syntax grammars for a page that gained code", async () => {
    await expect(
      completePageReaders(await staged(plain, code), read),
    ).rejects.toThrow("kind or capability");
  });
});
