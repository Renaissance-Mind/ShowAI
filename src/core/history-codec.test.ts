import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { decodeFile, decodeFileSync, encodeFile } from "./history-codec";

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
/** The stored-JSON encoding as first specified: every value rebuilt in order. */
function referenceEnvelope(value: unknown, assets: Map<string, Buffer>) {
  const slots: { pointer: string[]; id: string; mime: string }[] = [];
  const visit = (value: unknown, pointer: string[]): unknown => {
    if (typeof value === "string") {
      const match = value.match(
        /^data:([\w.+/-]+);base64,([A-Za-z0-9+/]*={0,2})$/,
      );
      if (!match) return value;
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.toString("base64") !== match[2]) return value;
      assets.set(`assets/${digest(bytes)}`, bytes);
      slots.push({ pointer, id: digest(bytes), mime: match[1] });
      return `asset:${digest(bytes)}`;
    }
    if (Array.isArray(value))
      return value.map((entry, index) => visit(entry, [...pointer, String(index)]));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry, [...pointer, key])]),
      );
    return value;
  };
  const encoded = visit(value, []);
  return Buffer.from(
    JSON.stringify({ format: "showai-stored-json", version: 1, value: encoded, assets: slots }),
  );
}

const image = "data:image/png;base64,iVBORw0KGgo=";
const artifact = {
  format: "showai",
  version: 3,
  document: {
    id: "page",
    title: image,
    "2": "numeric key",
    content: {
      type: "surface",
      attrs: { id: "root" },
      content: [
        {
          type: "richText",
          attrs: { id: "a", data: { images: [image, "data:text/plain;base64,aGk"], deep: { src: image } } },
          content: [
            { type: "paragraph", attrs: { id: "a-text" }, content: [{ type: "text", text: "data:not a url" }] },
          ],
        },
        { type: "richText", attrs: { id: "b" }, content: [] },
      ],
    },
  },
};

test("stored pages encode as specified and decode to the same bytes either way", async () => {
  const path = "projects/p/pages/page.json";
  // JSON text can name an own "__proto__" key, which every copy must keep.
  const text = JSON.stringify(artifact).replace('"title":', '"__proto__":{"x":1},"title":');
  const source = Buffer.from(JSON.stringify(JSON.parse(text), null, 2) + "\n");
  expect(source.toString()).toContain('"__proto__"');
  const files = encodeFile(path, source);
  // Each node file and the page skeleton equal the reference encoding.
  const parsed = JSON.parse(source.toString());
  const assets = new Map<string, Buffer>();
  const expected = new Map<string, Buffer>();
  const split = (node: { type: string; attrs?: { id: string }; content?: unknown[] }): unknown => {
    if (node.type === "text") return node;
    const stored = { ...node, ...(node.content ? { content: node.content.map((child) => split(child as never)) } : {}) };
    expected.set(
      `projects/p/pages/page/nodes/${digest(Buffer.from(node.attrs!.id))}.json`,
      referenceEnvelope(stored, assets),
    );
    return { node: node.attrs!.id };
  };
  parsed.document.content = split(parsed.document.content);
  expected.set(path, referenceEnvelope(parsed, assets));
  for (const [name, bytes] of assets) expected.set(name, bytes);
  expect(new Map([...files].sort())).toEqual(new Map([...expected].sort()));
  const read = (name: string) => files.get(name)!;
  const decoded = await decodeFile(path, async (name) => read(name));
  expect(decoded).toEqual(source);
  expect(decodeFileSync(path, read)).toEqual(decoded);
});

test("both decoders reject the same damaged pages", async () => {
  const path = "projects/p/pages/page.json";
  const files = encodeFile(path, Buffer.from(JSON.stringify(artifact)));
  const node = [...files.keys()].find((name) => name.includes("/nodes/"))!;
  const damaged = [
    new Map([...files].filter(([name]) => name !== node)),
    new Map([...files, [node, Buffer.from('{"format":"other"}')]]),
    new Map(
      [...files].map(([name, bytes]) => [
        name,
        name.startsWith("assets/") ? Buffer.from("changed") : bytes,
      ]),
    ),
  ];
  for (const set of damaged) {
    const read = (name: string) => {
      const bytes = set.get(name);
      if (!bytes) throw new Error(`missing ${name}`);
      return bytes;
    };
    const failure = await decodeFile(path, async (name) => read(name)).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(() => decodeFileSync(path, read)).toThrow(failure.message);
  }
});
