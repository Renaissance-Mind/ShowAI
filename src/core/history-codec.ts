import { createHash } from "node:crypto";
import { canonicalJson } from "./diff";
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

/** Extract only actual data URLs. Slot locations avoid reserving keys in component props. */
function encodeJson(value: unknown, files: FileChanges): Buffer {
  const assets: AssetSlot[] = [];
  const visit = (value: unknown, pointer: string[]): unknown => {
    if (typeof value === "string") {
      const match = value.match(
        /^data:([\w.+\/-]+);base64,([A-Za-z0-9+/]*={0,2})$/,
      );
      if (!match) return value;
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.toString("base64") !== match[2]) return value;
      const id = digest(bytes);
      files.set(`assets/${id}`, bytes);
      assets.push({ pointer, id, mime: match[1] });
      return `asset:${id}`;
    }
    if (Array.isArray(value))
      return value.map((entry, index) =>
        visit(entry, [...pointer, String(index)]),
      );
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          visit(entry, [...pointer, key]),
        ]),
      );
    return value;
  };
  const envelope: JsonEnvelope = {
    format: "showai-stored-json",
    version: 1,
    value: visit(value, []),
    assets,
  };
  return Buffer.from(canonicalJson(envelope));
}

async function decodeJson(
  bytes: Buffer,
  read: (path: string) => Promise<Buffer>,
): Promise<unknown> {
  const envelope = JSON.parse(bytes.toString("utf8")) as JsonEnvelope;
  if (
    envelope.format !== "showai-stored-json" ||
    envelope.version !== 1 ||
    !Array.isArray(envelope.assets)
  )
    throw new CoreError("INVALID_DATA", "Invalid stored JSON object.");
  let value = envelope.value;
  for (const slot of envelope.assets) {
    if (
      !/^[a-f0-9]{64}$/.test(slot.id) ||
      typeof slot.mime !== "string" ||
      !Array.isArray(slot.pointer)
    )
      throw new CoreError("INVALID_DATA", "Invalid stored asset reference.");
    const asset = await read(`assets/${slot.id}`);
    if (digest(asset) !== slot.id)
      throw new CoreError("INVALID_DATA", `Corrupt asset: ${slot.id}`);
    const url = `data:${slot.mime};base64,${asset.toString("base64")}`;
    if (!slot.pointer.length) {
      value = url;
      continue;
    }
    let parent = value as Record<string, unknown>;
    for (const part of slot.pointer.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part))
        throw new CoreError(
          "INVALID_DATA",
          "Stored asset location is missing.",
        );
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
  }
  return value;
}

export function nodePrefix(path: string): string {
  return `${path.slice(0, -5)}/nodes/`;
}
function nodePath(path: string, id: string): string {
  return `${nodePrefix(path)}${createHash("sha256").update(id).digest("hex")}.json`;
}

/** Storage splits pages, while callers and portable exports keep full readable artifacts. */
export function encodeFile(path: string, bytes: Buffer): FileChanges {
  const files: FileChanges = new Map();
  if (!path.endsWith(".json")) {
    files.set(path, bytes);
    return files;
  }
  const value = JSON.parse(bytes.toString("utf8"));
  if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)) {
    if (value.format !== "showai" || !value.document?.content)
      throw new CoreError(
        "INVALID_DATA",
        "A stored page requires a ShowAI artifact.",
      );
    const ids = new Set<string>();
    const split = (node: NodeValue): unknown => {
      if (node.type === "text") return node;
      const id = node.attrs?.id;
      if (typeof id !== "string" || !id || id.length > 200 || ids.has(id))
        throw new CoreError(
          "INVALID_DATA",
          "Page nodes need unique stable identifiers before storage.",
        );
      ids.add(id);
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

export async function decodeFile(
  path: string,
  read: (path: string) => Promise<Buffer>,
): Promise<Buffer> {
  const bytes = await read(path);
  if (!path.endsWith(".json")) return bytes;
  const value = (await decodeJson(bytes, read)) as {
    document?: { content: unknown };
  };
  if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)) {
    const visited = new Set<string>();
    const expand = async (entry: unknown, depth: number): Promise<unknown> => {
      if (depth > 64)
        throw new CoreError(
          "INVALID_DATA",
          "Stored page is nested too deeply.",
        );
      const ref = entry as { node?: string };
      if (!ref?.node) return entry;
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
      const node = (await decodeJson(
        await read(nodePath(path, ref.node)),
        read,
      )) as NodeValue;
      if (node.attrs?.id !== ref.node)
        throw new CoreError("INVALID_DATA", "Stored node identity differs.");
      if (node.content)
        node.content = (await Promise.all(
          node.content.map((child) => expand(child, depth + 1)),
        )) as NodeValue[];
      return node;
    };
    if (!value.document)
      throw new CoreError("INVALID_DATA", "Stored page metadata is missing.");
    value.document.content = await expand(value.document.content, 0);
  }
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}
