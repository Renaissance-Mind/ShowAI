import type { FileConflict } from "../sync/transfer";

const limit = 8000;
const shorten = (text: string) =>
  text.length > limit ? `${text.slice(0, limit)}\n…（预览已截断）` : text;

function decode(bytes: string | null): string | null {
  if (bytes === null) return null;
  const data = Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0));
  // Binary resources are valid conflicts, but cannot be shown as text.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return text.includes("\0") ? `二进制文件（${data.length} 字节）` : text;
  } catch {
    return `二进制文件（${data.length} 字节）`;
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
    return `${start ? "…（相同开头已省略）\n" : ""}${shorten(JSON.stringify(value.slice(start)))}`;
  }
  return value === undefined
    ? "此版本中不存在"
    : shorten(JSON.stringify(value, null, 2));
}

/** Compare the retained snapshots once, including changes after large shared data. */
export function conflictPreview(file: Pick<FileConflict, "local" | "remote">) {
  const local = decode(file.local),
    remote = decode(file.remote);
  const fallback = {
    local: local === null ? "已删除" : shorten(local),
    remote: remote === null ? "已删除" : shorten(remote),
    description: "版本内容预览；选择将应用该文件的完整版本。",
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
      description:
        "两个版本的 JSON 内容相同，文件格式可能不同；选择将应用该文件的完整版本。",
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
    description: `显示${truncated ? "前 " : ""}${changes.length} 处字段差异；选择将应用该文件的完整版本。`,
  };
}
