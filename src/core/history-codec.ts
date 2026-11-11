import { createHash } from "node:crypto";
import { CoreError } from "./model";
import type { FileChanges } from "./history-model";

interface AssetSlot {
  pointer: string[];
  id: string;
  mime: string;
}
interface JsonEnvelope {
  format: "showai-stored-json";
  version: 1;
  value: unknown;
  assets: AssetSlot[];
}
type NodeValue = {
  type: string;
  attrs?: { id?: string };
  content?: NodeValue[];
  [key: string]: unknown;
};
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function jsonEnvelope(path: string): boolean {
  // Component source fingerprints cover exact bytes, including JSON formatting.
  return (
    path.endsWith(".json") &&
    (!/\/components\//.test(path) || path.endsWith("/compiled.json"))
  );
}

/** Extract only actual data URLs. Slot locations avoid reserving keys in component props. */
function encodeJson(value: unknown, files: FileChanges): Buffer {
  const assets: AssetSlot[] = [];
  // The location of the value being visited; copied only for a data URL.
  const pointer: string[] = [];
  // Returns the value itself unless it holds a data URL, so the JSON text of
  // unchanged parts is that of the input.
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (!value.startsWith("data:")) return value;
      const match = value.match(
        /^data:([\w.+\/-]+);base64,([A-Za-z0-9+/]*={0,2})$/,
      );
      if (!match) return value;
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.toString("base64") !== match[2]) return value;
      const id = digest(bytes);
      files.set(`assets/${id}`, bytes);
      assets.push({ pointer: [...pointer], id, mime: match[1] });
      return `asset:${id}`;
    }
    if (Array.isArray(value)) {
      let copy: unknown[] | undefined;
      for (let index = 0; index < value.length; index++) {
        pointer.push(String(index));
        const entry = visit(value[index]);
        pointer.pop();
        if (entry !== value[index]) (copy ??= [...value])[index] = entry;
      }
      return copy ?? value;
    }
    if (value && typeof value === "object") {
      let copy: Record<string, unknown> | undefined;
      for (const [key, item] of Object.entries(value)) {
        pointer.push(key);
        const entry = visit(item);
        pointer.pop();
        if (entry !== item)
          (copy ??= Object.fromEntries(Object.entries(value)))[key] = entry;
      }
      return copy ?? value;
    }
    return value;
  };
  const envelope: JsonEnvelope = {
    format: "showai-stored-json",
    version: 1,
    value: visit(value),
    assets,
  };
  return Buffer.from(JSON.stringify(envelope));
}

function readEnvelope(bytes: Buffer): JsonEnvelope {
  const envelope = JSON.parse(bytes.toString("utf8")) as JsonEnvelope;
  if (
    envelope.format !== "showai-stored-json" ||
    envelope.version !== 1 ||
    !Array.isArray(envelope.assets)
  )
    throw new CoreError("INVALID_DATA", "Invalid stored JSON object.");
  return envelope;
}
function assetPath(slot: AssetSlot): string {
  if (
    !/^[a-f0-9]{64}$/.test(slot.id) ||
    typeof slot.mime !== "string" ||
    !Array.isArray(slot.pointer)
  )
    throw new CoreError("INVALID_DATA", "Invalid stored asset reference.");
  return `assets/${slot.id}`;
}
/** The value with the asset's data URL restored at the slot's location. */
function restoreAsset(value: unknown, slot: AssetSlot, asset: Buffer): unknown {
  if (digest(asset) !== slot.id)
    throw new CoreError("INVALID_DATA", `Corrupt asset: ${slot.id}`);
  const url = `data:${slot.mime};base64,${asset.toString("base64")}`;
  if (!slot.pointer.length) return url;
  let parent = value as Record<string, unknown>;
  for (const part of slot.pointer.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part))
      throw new CoreError("INVALID_DATA", "Stored asset location is missing.");
    parent = parent[part] as Record<string, unknown>;
  }
  const key = slot.pointer.at(-1)!;
  if (
    !parent ||
    !Object.hasOwn(parent, key) ||
    parent[key] !== `asset:${slot.id}`
  )
    throw new CoreError(
      "INVALID_DATA",
      "Stored asset location differs from its reference.",
    );
  Object.defineProperty(parent, key, {
    value: url,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return value;
}
async function decodeJson(
  bytes: Buffer,
  read: (path: string) => Promise<Buffer>,
): Promise<unknown> {
  const envelope = readEnvelope(bytes);
  let value = envelope.value;
  for (const slot of envelope.assets)
    value = restoreAsset(value, slot, await read(assetPath(slot)));
  return value;
}
function decodeJsonSync(
  bytes: Buffer,
  read: (path: string) => Buffer,
): unknown {
  const envelope = readEnvelope(bytes);
  let value = envelope.value;
  for (const slot of envelope.assets)
    value = restoreAsset(value, slot, read(assetPath(slot)));
  return value;
}

export function nodePrefix(path: string): string {
  return `${path.slice(0, -5)}/nodes/`;
}
function nodePath(path: string, id: string): string {
  return `${nodePrefix(path)}${createHash("sha256").update(id).digest("hex")}.json`;
}

/** Storage splits pages, while callers and portable exports keep full readable artifacts. */
/** Reports the errors that would stop a page artifact from being stored as nodes. */
export function assertStorablePage(value: {
  format?: unknown;
  document?: { content?: NodeValue };
}): void {
  if (value.format !== "showai" || !value.document?.content)
    throw new CoreError(
      "INVALID_DATA",
      "A stored page requires a ShowAI artifact.",
    );
  const ids = new Set<string>();
  const visit = (node: NodeValue) => {
    if (node.type === "text") return;
    const id = node.attrs?.id;
    if (typeof id !== "string" || !id || id.length > 200 || ids.has(id))
      throw new CoreError(
        "INVALID_DATA",
        "Page nodes need unique stable identifiers before storage.",
      );
    ids.add(id);
    node.content?.forEach(visit);
  };
  visit(value.document.content);
}

export function encodeFile(path: string, bytes: Buffer): FileChanges {
  const files: FileChanges = new Map();
  if (!jsonEnvelope(path)) {
    files.set(path, bytes);
    return files;
  }
  const value = JSON.parse(bytes.toString("utf8"));
  if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)) {
    assertStorablePage(value);
    const split = (node: NodeValue): unknown => {
      if (node.type === "text") return node;
      const id = node.attrs!.id as string;
      const stored = {
        ...node,
        ...(node.content ? { content: node.content.map(split) } : {}),
      };
      files.set(nodePath(path, id), encodeJson(stored, files));
      return { node: id };
    };
    value.document.content = split(value.document.content);
  }
  files.set(path, encodeJson(value, files));
  return files;
}

/** The node an entry of a stored page refers to, or undefined for inline content. */
function nodeReference(
  entry: unknown,
  depth: number,
  visited: Set<string>,
): string | undefined {
  if (depth > 64)
    throw new CoreError("INVALID_DATA", "Stored page is nested too deeply.");
  const ref = entry as { node?: string };
  if (!ref?.node) return undefined;
  if (
    typeof ref.node !== "string" ||
    !ref.node ||
    ref.node.length > 200 ||
    visited.has(ref.node)
  )
    throw new CoreError(
      "INVALID_DATA",
      "Stored page contains a missing or repeated node.",
    );
  visited.add(ref.node);
  return ref.node;
}
function checkNode(node: NodeValue, id: string) {
  if (node.attrs?.id !== id)
    throw new CoreError("INVALID_DATA", "Stored node identity differs.");
}
function pageMetadata(value: { document?: { content: unknown } }) {
  if (!value.document)
    throw new CoreError("INVALID_DATA", "Stored page metadata is missing.");
  return value.document;
}
const pageFile = (path: string) =>
  /^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path);

export async function decodeFile(
  path: string,
  read: (path: string) => Promise<Buffer>,
): Promise<Buffer> {
  const bytes = await read(path);
  if (!jsonEnvelope(path)) return bytes;
  const value = (await decodeJson(bytes, read)) as {
    document?: { content: unknown };
  };
  if (pageFile(path)) {
    const visited = new Set<string>();
    const expand = async (entry: unknown, depth: number): Promise<unknown> => {
      const id = nodeReference(entry, depth, visited);
      if (id === undefined) return entry;
      const node = (await decodeJson(
        await read(nodePath(path, id)),
        read,
      )) as NodeValue;
      checkNode(node, id);
      if (node.content)
        node.content = (await Promise.all(
          node.content.map((child) => expand(child, depth + 1)),
        )) as NodeValue[];
      return node;
    };
    const document = pageMetadata(value);
    document.content = await expand(document.content, 0);
  }
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}

/**
 * decodeFile for a reader that answers synchronously, without a promise per
 * node. Nodes are read depth first; a valid page decodes to the same bytes.
 */
export function decodeFileSync(
  path: string,
  read: (path: string) => Buffer,
): Buffer {
  const bytes = read(path);
  if (!jsonEnvelope(path)) return bytes;
  const value = decodeJsonSync(bytes, read) as {
    document?: { content: unknown };
  };
  if (pageFile(path)) {
    const visited = new Set<string>();
    const expand = (entry: unknown, depth: number): unknown => {
      const id = nodeReference(entry, depth, visited);
      if (id === undefined) return entry;
      const node = decodeJsonSync(read(nodePath(path, id)), read) as NodeValue;
      checkNode(node, id);
      if (node.content)
        node.content = node.content.map((child) =>
          expand(child, depth + 1),
        ) as NodeValue[];
      return node;
    };
    const document = pageMetadata(value);
    document.content = expand(document.content, 0);
  }
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}
