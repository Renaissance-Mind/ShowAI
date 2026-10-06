import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import {
  listBuiltinComponents,
  readBuiltinComponentSource,
  saveComponent,
} from "./catalog";
import { componentCategory } from "./component-categories";
import { validateG2Data } from "../components/blocks/g2/contract.mjs";
import { FileStore } from "./store";

test("G2 defaults and examples are valid discoverable data components", () => {
  const items = listBuiltinComponents().filter((i) => i.kind.startsWith("g2-"));
  expect(items).toHaveLength(43);
  const ajv = new Ajv({ strict: true, allowUnionTypes: true });
  for (const item of items) {
    expect(componentCategory(item)).toBe("data");
    validateG2Data(item.defaultData);
    const check = ajv.compile(item.propsSchema);
    expect(check(item.defaultData), JSON.stringify(check.errors)).toBe(true);
    for (const e of item.examples) expect(check(e.data)).toBe(true);
    expect(readBuiltinComponentSource(item.kind).source).toContain(
      "showai:components",
    );
  }
});
test("G2 data validation rejects non-JSON values and unsafe field mappings", () => {
  expect(() => validateG2Data({ datasets: { main: [NaN] } })).toThrow();
  expect(() =>
    validateG2Data({
      datasets: { main: [1] },
      appearance: { palette: ["red"] },
    }),
  ).toThrow();
  expect(() =>
    validateG2Data({
      datasets: { main: [1] },
      fields: JSON.parse('{"__proto__":"value"}'),
    }),
  ).toThrow();
  expect(() =>
    validateG2Data({
      datasets: { main: [1] },
      interaction: { brushFilter: "true" },
    }),
  ).toThrow();
});
test("G2 builtin can be derived into an offline compiled component", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-g2-"));
  try {
    const project = (
      await new FileStore(home).createProject({
        name: "G2 component validation",
      })
    ).id;
    const original = readBuiltinComponentSource("g2-bar");
    const compiled = await saveComponent(
      home,
      { ...original, manifest: { ...original.manifest, id: "g2-derived-bar" } },
      project,
    );
    expect(compiled.inline?.script).toContain("datasets");
    expect(compiled.html).toContain("Content-Security-Policy");
    expect(compiled.inline?.script).not.toMatch(/https:\/\/(?:cdn|unpkg)/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
