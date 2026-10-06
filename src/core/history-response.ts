import { canonicalJson } from "./diff";
import type { FileChanges } from "./history-model";

export type ResponseDescriptor =
  | { type: "literal"; value: unknown }
  | { type: "array"; items: ResponseDescriptor[] }
  | { type: "object"; fields: Record<string, ResponseDescriptor> }
  | { type: "text-file" | "base64-file"; path: string }
  | {
      type: "json-fields";
      path: string;
      fields: string[];
      extras: Record<string, ResponseDescriptor>;
    }
  | {
      type: "page-record";
      path: string;
      extras: Record<string, ResponseDescriptor>;
    };

/** Response receipts refer to committed files, rather than duplicate pages/images/runtimes. */
export function describeResponse(
  value: unknown,
  changes: FileChanges,
  logical: (path: string) => string | undefined,
): ResponseDescriptor {
  const json: { path: string; value: Record<string, unknown> }[] = [];
  const texts = new Map<string, string>(),
    binary = new Map<string, string>();
  for (const [path, bytes] of changes)
    if (bytes !== null) {
      if (
        /(?:project|compiled|template|manifest|props\.schema)\.json$/.test(
          path,
        ) ||
        /^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)
      ) {
        const parsed = JSON.parse(bytes.toString("utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          json.push({ path, value: parsed });
      }
      // Text source and binary asset values also have stable file references.
      if (/\.(tsx?|jsx?|css|md)$/.test(path))
        texts.set(bytes.toString("utf8"), path);
      if (/\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/.test(path))
        binary.set(bytes.toString("base64"), path);
    }
  const describe = (entry: unknown): ResponseDescriptor => {
    if (typeof entry === "string") {
      const source = texts.get(entry);
      if (source) return { type: "text-file", path: source };
      const asset = binary.get(entry);
      if (asset) return { type: "base64-file", path: asset };
    }
    if (Array.isArray(entry))
      return { type: "array", items: entry.map(describe) };
    if (entry && typeof entry === "object") {
      const object = entry as Record<string, unknown>;
      const path =
        typeof object.path === "string" ? logical(object.path) : undefined;
      if (
        path &&
        object.document &&
        /^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)
      ) {
        const extras = Object.fromEntries(
          Object.entries(object)
            .filter(([key]) => !["document", "path", "revision"].includes(key))
            .map(([key, value]) => [key, describe(value)]),
        );
        return { type: "page-record", path, extras };
      }
      if (typeof object.id === "string") {
        const candidates = json.filter(
          (candidate) =>
            candidate.value.id === object.id &&
            (!Object.hasOwn(object, "version") ||
              candidate.value.version === object.version) &&
            (!Object.hasOwn(object, "integrity") ||
              candidate.value.integrity === object.integrity),
        );
        const selected = candidates
          .map((candidate) => ({
            ...candidate,
            fields: Object.keys(object).filter(
              (key) =>
                Object.hasOwn(candidate.value, key) &&
                canonicalJson(object[key]) ===
                  canonicalJson(candidate.value[key]),
            ),
          }))
          .sort((a, b) => b.fields.length - a.fields.length)[0];
        if (selected)
          return {
            type: "json-fields",
            path: selected.path,
            fields: selected.fields,
            extras: Object.fromEntries(
              Object.entries(object)
                .filter(([key]) => !selected.fields.includes(key))
                .map(([key, value]) => [key, describe(value)]),
            ),
          };
      }
      return {
        type: "object",
        fields: Object.fromEntries(
          Object.entries(object).map(([key, value]) => [key, describe(value)]),
        ),
      };
    }
    return { type: "literal", value: entry };
  };
  return describe(value);
}

export async function restoreResponse(
  descriptor: ResponseDescriptor,
  revision: string,
  read: (path: string) => Promise<Buffer>,
  physical: (path: string) => string,
): Promise<unknown> {
  switch (descriptor.type) {
    case "literal":
      return descriptor.value;
    case "array":
      return Promise.all(
        descriptor.items.map((item) =>
          restoreResponse(item, revision, read, physical),
        ),
      );
    case "object":
      return Object.fromEntries(
        await Promise.all(
          Object.entries(descriptor.fields).map(async ([key, value]) => [
            key,
            await restoreResponse(value, revision, read, physical),
          ]),
        ),
      );
    case "text-file":
      return (await read(descriptor.path)).toString("utf8");
    case "base64-file":
      return (await read(descriptor.path)).toString("base64");
    case "json-fields": {
      const value = JSON.parse((await read(descriptor.path)).toString("utf8"));
      const extras = (await restoreResponse(
        { type: "object", fields: descriptor.extras },
        revision,
        read,
        physical,
      )) as object;
      return {
        ...Object.fromEntries(
          descriptor.fields.map((key) => [key, value[key]]),
        ),
        ...extras,
      };
    }
    case "page-record": {
      const value = JSON.parse((await read(descriptor.path)).toString("utf8"));
      const extras = (await restoreResponse(
        { type: "object", fields: descriptor.extras },
        revision,
        read,
        physical,
      )) as object;
      return {
        ...extras,
        document: value.document,
        path: physical(descriptor.path),
        revision,
      };
    }
  }
}
