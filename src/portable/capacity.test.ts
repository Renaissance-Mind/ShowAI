import { expect, test } from "vitest";
import {
  CAPACITY,
  assertContent,
  base64Bytes,
  measureContent,
  readCapacityText,
} from "./capacity.mjs";
import { validateDocument } from "./validation.mjs";

test("counts escaped UTF-8 structure, distinct decoded resources and repeated references", () => {
  const url = "data:image/png;base64,AAEC";
  const value = {
    title: '中文\n"',
    sources: [url, url, "data:image/png;base64,AQID"],
  };
  const sizes = measureContent(value);
  expect(sizes.resourceBytes).toBe(6);
  expect(sizes.resourceCount).toBe(2);
  expect(sizes.jsonBytes).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(sizes.prettyJsonBytes).toBe(
    Buffer.byteLength(JSON.stringify(value, null, 2)),
  );
  expect(sizes.structureBytes).toBe(
    Buffer.byteLength(
      JSON.stringify({
        ...value,
        sources: Array(3).fill("asset:image/png:sha256"),
      }),
    ),
  );
  // Embedded code cannot claim the whole-string extraction used by storage.
  expect(measureContent({ code: `<img src="${url}">` }).resourceBytes).toBe(0);
  expect(() => base64Bytes("AB==")).toThrow("canonical");
  expect(() => base64Bytes("A==")).toThrow("base64");
  // Existing permissive URLs that storage cannot extract remain ordinary structure.
  const legacy = { src: "data:image/png;base64,AB==" };
  expect(measureContent(legacy).resourceBytes).toBe(0);
  expect(measureContent(legacy).structureBytes).toBe(
    Buffer.byteLength(JSON.stringify(legacy)),
  );
});

test("large text cannot evade the page structure budget using characters instead of UTF-8 bytes", () => {
  const document = {
    id: "large-text",
    title: "Large text",
    content: {
      type: "doc",
      content: Array.from({ length: 7 }, () => ({
        type: "paragraph",
        content: [{ type: "text", text: "中".repeat(900_000) }],
      })),
    },
  };
  expect(() => validateDocument(document)).toThrow("Page structure");
  expect(() =>
    assertContent(
      { text: "中".repeat(3_000_000) },
      "Component instance data",
      CAPACITY.componentPropsBytes,
    ),
  ).toThrow("Component instance data");
});

test("single resource and decoded aggregate guards are independent of structure", () => {
  const tooLarge = `data:image/png;base64,${Buffer.alloc(CAPACITY.resourceBytes + 1).toString("base64")}`;
  expect(() => assertContent({ src: tooLarge })).toThrow(
    "Single resource (decoded)",
  );
  // Each file is valid, the combined decoded page is too large.
  const resources = [0, 1, 2].map(
    (byte) =>
      `data:image/png;base64,${Buffer.alloc(43 * 1024 * 1024, byte).toString("base64")}`,
  );
  expect(() => assertContent(resources)).toThrow("Page resources");
  // Deduplication does not make hundreds of MiB of repeated encoded references free to export.
  expect(() => assertContent(Array(5).fill(resources[0]))).toThrow(
    "Authoring JSON",
  );
});

test("HTTP body guards count actual stream bytes without relying on Content-Length", async () => {
  const request = new Request("http://localhost/", {
    method: "POST",
    body: "中文",
  });
  await expect(
    readCapacityText(request, 5, "Test input"),
  ).rejects.toMatchObject({
    code: "CAPACITY_EXCEEDED",
    actualBytes: 6,
    limitBytes: 5,
  });
});
