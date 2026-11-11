import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getComponent, listComponents, saveComponent } from "./catalog";
import { FileStore } from "./store";
import type { ComponentManifest } from "../components/custom/types";

const directories: string[] = [];
async function library() {
  const home = await mkdtemp(join(tmpdir(), "showai-field-type-"));
  directories.push(home);
  const projectId = (await new FileStore(home).createProject({ name: "Fields" })).id;
  return { home, projectId };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const manifest = {
  id: "star-rating",
  name: "Rating",
  version: "1.0.0",
  description: "A 1–N star rating field for databases.",
  entry: "index.tsx",
  scenarios: ["Rate records in a database"],
  role: "database-field",
  databaseField: { protocol: 1, valueKind: "number", operators: ["is", "gte", "lte", "isEmpty", "isNotEmpty"] },
  defaultData: { max: 5 },
  examples: [{ name: "Five stars", data: { max: 5 } }],
} as unknown as ComponentManifest;
const schema = {
  type: "object",
  properties: { max: { type: "integer", minimum: 1, maximum: 10 } },
  required: ["max"],
  additionalProperties: false,
};
const source = `export const field = {
  format(value, config) {
    const n = Math.max(0, Math.min(config.max, Number(value) || 0));
    return n ? "★".repeat(n) + "☆".repeat(config.max - n) : "";
  },
  project(value) {
    return typeof value === "number" ? value : null;
  },
};
export default function RatingEditor({ data, value, onValue, onClose }) {
  return (
    <div role="radiogroup" aria-label="Rating">
      {Array.from({ length: data.max }, (_, index) => (
        <button key={index} type="button" role="radio" aria-checked={value === index + 1}
          onClick={() => { onValue?.(index + 1); onClose?.(); }}>
          {index < (value ?? 0) ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}`;

describe("field types contributed by components", () => {
  it("save with role database-field, list with their value kind and compile the field protocol", async () => {
    const { home, projectId } = await library();
    const saved = await saveComponent(home, { manifest, schema, source }, projectId);
    expect(saved).toMatchObject({
      role: "database-field",
      databaseField: { protocol: 1, valueKind: "number" },
    });
    expect(saved.html).toContain("showai:field-call");
    const [listed] = await listComponents(home, projectId);
    expect(listed).toMatchObject({
      id: "star-rating",
      role: "database-field",
      databaseField: { valueKind: "number", operators: ["is", "gte", "lte", "isEmpty", "isNotEmpty"] },
    });
    const reloaded = await getComponent(home, "star-rating", "1.0.0", projectId);
    expect(reloaded.integrity).toBe(saved.integrity);
  }, 60000);
  it("reject a field contract that names other kinds' operators or no kind", async () => {
    const { home, projectId } = await library();
    const save = (databaseField: unknown) =>
      saveComponent(
        home,
        { manifest: { ...manifest, databaseField } as ComponentManifest, schema, source },
        projectId,
      );
    await expect(save({ protocol: 1, valueKind: "number", operators: ["contains"] })).rejects.toThrow(
      "operators of number values",
    );
    await expect(save({ protocol: 1, valueKind: "money" })).rejects.toThrow("valueKind");
    await expect(save({ protocol: 2, valueKind: "number" })).rejects.toThrow("protocol");
  }, 60000);
});
