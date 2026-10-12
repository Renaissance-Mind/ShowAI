import { expect, test } from "vitest";
import {
  latestTemplateVersions,
  editedTemplateBundle,
} from "./template-catalog-model";
import { templateFixture } from "../test/template-fixture";
import { parseTemplateBundle } from "../portable/template-bundle.mjs";
import { blankDocument } from "../core/catalog";
import type {
  TemplateMetadata,
  TemplateRecord,
} from "../components/custom/types";

test("latest cards retain scopes and conflicting identities, and prefer stable numeric versions", () => {
  const items = [
    { id: "same", scope: "builtin", version: "2.0.0", integrity: "a" },
    { id: "same", scope: "builtin", version: "10.0.0-beta", integrity: "b" },
    { id: "same", scope: "builtin", version: "10.0.0", integrity: "c" },
    { id: "same", scope: "builtin", version: "10.0.0", integrity: "d" },
    { id: "same", scope: "project", version: "1.0.0", integrity: "e" },
  ] as TemplateMetadata[];
  expect(latestTemplateVersions(items).map((item) => item.integrity)).toEqual([
    "c",
    "d",
    "e",
  ]);
});

test("customizing a folder template keeps guide files, component sources, assets and page edits", () => {
  const bundle = templateFixture();
  bundle.files["README.md"] = bundle.files["README.md"].replace(
    '"page": null',
    '"page": "page.json"',
  );
  bundle.files["page.json"] = JSON.stringify(blankDocument());
  bundle.assets = { "components/step-picker/example.png": "aGVsbG8=" };
  const record = { bundle, document: blankDocument() } as TemplateRecord;
  const files = {
    ...bundle.files,
    "guides/design.md": "# Edited design\nKeep the actual evidence visible.",
  };
  const document = { ...record.document, title: "Changed page" };
  const result = editedTemplateBundle(record, {
    name: "New name",
    version: "1.0.1",
    description: "New description",
    scenarios: ["New scenario"],
    document,
    files,
  });
  const parsed = parseTemplateBundle(result);
  expect(parsed.metadata).toMatchObject({
    name: "New name",
    version: "1.0.1",
    description: "New description",
    scenarios: ["New scenario"],
  });
  expect(parsed.guides.design?.markdown).toContain("Edited design");
  expect(parsed.components).toHaveLength(1);
  expect(parsed.document?.title).toBe("New name");
  expect(result.assets).toEqual(bundle.assets);
  expect(record.bundle?.files["guides/design.md"]).not.toContain(
    "Edited design",
  );
});

test("saved folder pages convert installed component refs back to local names before a new save", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { AgentService } = await import("../agent/service");
  const { getTemplate } = await import("../core/catalog");
  const home = await mkdtemp(join(tmpdir(), "catalog-template-edit-"));
  try {
    const service = new AgentService({ root: home });
    const project = await service.createProject("Template editing");
    const bundle = templateFixture();
    bundle.files["README.md"] = bundle.files["README.md"].replace(
      '"page": null',
      '"page": "page.json"',
    );
    bundle.files["page.json"] = JSON.stringify({
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              kind: "custom",
              data: {
                componentId: "step-picker",
                version: "1.0.0",
                props: { title: "Sequence", labels: ["First", "Second"] },
              },
            },
          },
        ],
      },
    });
    const first = await service.saveTemplate(project.id, undefined, { bundle });
    const record = await getTemplate(home, first.id, project.id, {
      scope: "project",
      version: first.version,
    });
    const next = editedTemplateBundle(record, {
      name: record.name,
      description: record.description,
      scenarios: record.scenarios,
      version: "1.0.1",
      document: record.document,
      files: record.bundle!.files,
    });
    const portable = parseTemplateBundle(next).document!;
    expect(JSON.stringify(portable)).toContain('"componentId":"step-picker"');
    expect(JSON.stringify(portable)).not.toContain(
      "tpl-guided-example-step-picker",
    );
    const saved = await service.saveTemplate(project.id, undefined, {
      bundle: next,
    });
    const reread = await getTemplate(home, saved.id, project.id, {
      scope: "project",
      version: "1.0.1",
    });
    expect(reread.workflow!.components[0].ref.id).toBe(
      record.workflow!.components[0].ref.id,
    );
    expect(JSON.stringify(reread.document)).toContain(
      "tpl-guided-example-step-picker",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
