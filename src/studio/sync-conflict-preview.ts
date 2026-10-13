import type { FileConflict } from "../sync/transfer";
import { translator } from "../i18n";
import recoveryMessages from "../i18n/messages/recovery";

const t = translator(recoveryMessages);

const limit = 8000;
const shorten = (text: string) =>
  text.length > limit
    ? `${text.slice(0, limit)}\n${t("previewTruncated")}`
    : text;

function decode(bytes: string | null): string | null {
  if (bytes === null) return null;
  const data = Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0));
  // Binary resources are valid conflicts, but cannot be shown as text.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return text.includes("\0") ? t("binaryFile", { count: data.length }) : text;
  } catch {
    return t("binaryFile", { count: data.length });
  }
}

function valueText(value: unknown, other: unknown): string {
  if (
    typeof value === "string" &&
    typeof other === "string" &&
    value.length > limit
  ) {
    let shared = 0;
    while (
      shared < Math.min(value.length, other.length) &&
      value[shared] === other[shared]
    )
      shared++;
    const start = Math.max(0, shared - 160);
    return `${start ? `${t("sharedPrefixOmitted")}\n` : ""}${shorten(JSON.stringify(value.slice(start)))}`;
  }
  return value === undefined
    ? t("missingInVersion")
    : shorten(JSON.stringify(value, null, 2));
}

/** Compare the retained snapshots once, including changes after large shared data. */
export function conflictPreview(file: Pick<FileConflict, "local" | "remote">) {
  const local = decode(file.local),
    remote = decode(file.remote);
  const fallback = {
    local: local === null ? t("deleted") : shorten(local),
    remote: remote === null ? t("deleted") : shorten(remote),
    description: t("previewDescription"),
  };
  if (local === null || remote === null) return fallback;
  let left: unknown, right: unknown;
  try {
    left = JSON.parse(local);
    right = JSON.parse(remote);
  } catch {
    return fallback;
  }
  const changes: { path: string; local: unknown; remote: unknown }[] = [];
  let truncated = false;
  const visit = (a: unknown, b: unknown, path: string) => {
    if (a === b) return;
    if (changes.length >= 40) {
      truncated = true;
      return;
    }
    if (
      a !== null &&
      b !== null &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      const one = a as Record<string, unknown>,
        two = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(one), ...Object.keys(two)])) {
        visit(
          Object.hasOwn(one, key) ? one[key] : undefined,
          Object.hasOwn(two, key) ? two[key] : undefined,
          Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`,
        );
        if (truncated) break;
      }
    } else changes.push({ path, local: a, remote: b });
  };
  visit(left, right, "$");
  if (!changes.length)
    return {
      ...fallback,
      description: t("sameJson"),
    };
  const preview = (side: "local" | "remote") =>
    shorten(
      changes
        .map(
          (change) =>
            `${change.path}\n${valueText(change[side], change[side === "local" ? "remote" : "local"])}`,
        )
        .join("\n\n"),
    );
  return {
    local: preview("local"),
    remote: preview("remote"),
    description: t(truncated ? "fieldDiffsFirst" : "fieldDiffs", {
      count: changes.length,
    }),
  };
}
