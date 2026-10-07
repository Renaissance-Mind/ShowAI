import { expect, test } from "vitest";
import {
  canonical,
  hash,
  legacySyncProtocol,
  snapshotRevision,
  syncProtocol,
  type ProjectSnapshot,
} from "./protocol";
import { encodeFile } from "../core/history-codec";
import { decodeSnapshot } from "./transfer";

test("current snapshot identity is independent of key insertion order and host collation", async () => {
  const files = {
    "projects/locale-project/project.json": "a".repeat(64),
    "projects/locale-project/packages/components/label/1.0.0/阿.tsx":
      "b".repeat(64),
    "projects/locale-project/packages/components/label/1.0.0/中.tsx":
      "c".repeat(64),
    "projects/locale-project/packages/components/label/1.0.0/Component.tsx":
      "d".repeat(64),
    "projects/locale-project/packages/components/label/1.0.0/compiled.json":
      "e".repeat(64),
  };
  const snapshot: ProjectSnapshot = {
    format: syncProtocol,
    projectId: "locale-project",
    parents: [],
    files,
    change: {
      at: "2026-10-08T00:00:00.000Z",
      actor: { kind: "human" },
      channel: "desktop",
      operationId: "locale-test",
      paths: [],
    },
  };
  const english = Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => a.localeCompare(b, "en")),
    ),
    chinese = Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => a.localeCompare(b, "zh")),
    );
  expect(Object.keys(english)).not.toEqual(Object.keys(chinese));
  expect(await snapshotRevision({ ...snapshot, files: english })).toBe(
    await snapshotRevision({ ...snapshot, files: chinese }),
  );
  expect(canonical({ "2": "two", "10": "ten", A: "upper", a: "lower" })).toBe(
    '{"10":"ten","2":"two","A":"upper","a":"lower"}',
  );
});

test("a legacy snapshot from a different locale is verified through its stored bytes", async () => {
  const objects = new Map<string, Buffer>(),
    files: Record<string, string> = {};
  const logical = new Map([
    [
      "projects/locale-project/project.json",
      Buffer.from(
        JSON.stringify({ id: "locale-project", name: "语言无关的历史" }),
      ),
    ],
    [
      "projects/locale-project/packages/components/label/1.0.0/阿.tsx",
      Buffer.from("export const first = 1;"),
    ],
    [
      "projects/locale-project/packages/components/label/1.0.0/中.tsx",
      Buffer.from("export const second = 2;"),
    ],
  ]);
  for (const [path, bytes] of logical)
    for (const [name, content] of encodeFile(path, bytes))
      if (content) {
        const digest = await hash(content);
        files[name] = digest;
        objects.set(digest, content);
      }
  const snapshot: ProjectSnapshot = {
    format: legacySyncProtocol,
    projectId: "locale-project",
    parents: [],
    files,
    change: {
      at: "2026-10-08T00:00:00.000Z",
      actor: { kind: "human" },
      channel: "desktop",
      operationId: "legacy-locale",
      paths: [],
    },
  };
  const legacy = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(legacy).join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b, "zh"))
            .map(([key, item]) => `${JSON.stringify(key)}:${legacy(item)}`)
            .join(",")}}`
        : JSON.stringify(value);
  const serialized = legacy(snapshot),
    revision = await hash(serialized);
  expect(await snapshotRevision(snapshot)).not.toBe(revision);
  const decoded = await decodeSnapshot(
    { revision, snapshot: JSON.parse(serialized) },
    async (digest) => objects.get(digest)!,
  );
  expect(
    JSON.parse(decoded.get("projects/locale-project/project.json")!.toString())
      .name,
  ).toBe("语言无关的历史");
  expect(
    decoded.get(
      "projects/locale-project/packages/components/label/1.0.0/阿.tsx",
    ),
  ).toEqual(
    logical.get(
      "projects/locale-project/packages/components/label/1.0.0/阿.tsx",
    ),
  );
});
