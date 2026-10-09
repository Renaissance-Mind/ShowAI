import { createHash } from "node:crypto";
import type {
  CatalogScope,
  PackageRevisionRef,
} from "../components/custom/types";

export const CATALOG_VIEWS = [
  "summary",
  "guide",
  "schema",
  "examples",
  "source",
  "dependencies",
  "full",
] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];
export type CatalogKind = "component" | "template";
export interface CatalogSummary {
  kind: CatalogKind;
  id: string;
  name: string;
  scope: CatalogScope;
  version?: string;
  integrity?: string;
  description?: string;
  scenarios: string[];
  effects?: string[];
  ref?: PackageRevisionRef;
}

export function shellToken(value: string): string {
  return /^[a-zA-Z0-9_./:@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Search only descriptive metadata, independently of the small returned summary. */
export function catalogSearchText(value: object): string {
  const item = value as Record<string, unknown>;
  const text: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string") text.push(value);
    else if (Array.isArray(value)) value.forEach(add);
  };
  for (const key of [
    "id",
    "kind",
    "name",
    "description",
    "scenarios",
    "effects",
  ])
    add(item[key]);
  const records = (value: unknown) =>
    Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
  for (const example of records(item.examples)) {
    add(example.name);
    add(example.request);
    add(example.description);
  }
  for (const section of records(item.contentGuide)) {
    add(section.title);
    add(section.instructions);
  }
  for (const related of records(item.related)) add(related.purpose);
  return text.join("\n").toLocaleLowerCase();
}

export function summarizeCatalog(
  kind: CatalogKind,
  value: object,
  projectId?: string,
): CatalogSummary {
  const item = value as Record<string, unknown>;
  const scope = (
    item.scope === "user" ? "global" : (item.scope ?? "builtin")
  ) as CatalogScope;
  const id = String(item.id ?? item.kind);
  const version = typeof item.version === "string" ? item.version : undefined;
  const integrity =
    typeof item.integrity === "string" ? item.integrity : undefined;
  const scenarios = Array.isArray(item.scenarios)
    ? item.scenarios.filter(
        (value): value is string => typeof value === "string",
      )
    : typeof item.description === "string"
      ? [item.description]
      : [];
  return {
    kind,
    id,
    name: String(item.name ?? id),
    description: typeof item.description === "string" ? item.description : "",
    scope,
    ...(version ? { version } : {}),
    ...(integrity ? { integrity } : {}),
    ...(kind === "component"
      ? {
          effects: Array.isArray(item.effects)
            ? item.effects.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        }
      : {}),
    scenarios,
    ...(version && integrity
      ? {
          ref: {
            kind,
            id,
            version,
            integrity,
            scope,
            ...(scope === "project" && projectId ? { projectId } : {}),
          },
        }
      : {}),
  };
}

export function describeCommand(
  summary: Pick<CatalogSummary, "kind" | "id" | "scope" | "version">,
  projectId?: string,
  view: CatalogView = "summary",
): string {
  return [
    "showai catalog describe",
    shellToken(summary.id),
    "--kind",
    summary.kind,
    "--scope",
    summary.scope,
    ...(summary.version ? ["--version", shellToken(summary.version)] : []),
    ...(projectId ? ["--project", shellToken(projectId)] : []),
    ...(view !== "summary" ? ["--view", view] : []),
    "--json",
  ].join(" ");
}

/** Full discovery stays compact; detailed metadata belongs to describe. */
export function catalogEntry(item: CatalogSummary) {
  const { kind, id, name, scope, version, integrity, description, scenarios } =
    item;
  return {
    kind,
    id,
    name,
    description: description ?? "",
    scenarios,
    scope,
    ...(version ? { version } : {}),
    ...(integrity ? { integrity } : {}),
  };
}

/** Catalogs disclose all matches unless a caller explicitly requests paging. */
export function catalogPage<T>(
  items: T[],
  input: { limit?: number; cursor?: string; key?: unknown } = {},
) {
  return input.limit !== undefined || input.cursor !== undefined
    ? pageOf(items, input)
    : { items, total: items.length, limit: items.length, nextCursor: null };
}

export function pageOf<T>(
  items: T[],
  input: { limit?: number; cursor?: string; key?: unknown } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error("--limit must be an integer from 1 to 50.");
  const snapshot = createHash("sha256")
    .update(JSON.stringify([input.key, items]))
    .digest("hex")
    .slice(0, 24);
  let offset = 0;
  if (input.cursor) {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(input.cursor))
      throw new Error("Invalid catalog cursor. Restart without --cursor.");
    const cursor = JSON.parse(
      Buffer.from(input.cursor, "base64url").toString("utf8"),
    ) as { snapshot?: string; offset?: number };
    if (cursor.snapshot !== snapshot)
      throw new Error(
        "The catalog or query changed. Restart without --cursor.",
      );
    if (
      !Number.isInteger(cursor.offset) ||
      cursor.offset! < 0 ||
      cursor.offset! > items.length
    )
      throw new Error("Invalid catalog cursor offset.");
    offset = cursor.offset!;
  }
  const selected = items.slice(offset, offset + limit);
  const nextOffset = offset + selected.length;
  return {
    items: selected,
    total: items.length,
    limit,
    nextCursor:
      nextOffset < items.length
        ? Buffer.from(
            JSON.stringify({ snapshot, offset: nextOffset }),
          ).toString("base64url")
        : null,
  };
}
