import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTemplateBundle } from "../portable/template-bundle.mjs";
import {
  readTemplateDirectory,
  writeTemplateDirectory,
} from "./template-bundle-files";
import { templateFixture } from "../test/template-fixture";
import { AgentService } from "../agent/service";
import {
  getTemplate,
  getComponentByRef,
  readComponentSource,
  resolveDocumentComponents,
  promotePackage,
  forkPackage,
  packageRevisionRef,
} from "./catalog";
import { validateDocument } from "../portable/validation.mjs";
const paths: string[] = [];
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "showai-template-workflow-"));
  paths.push(path);
  return path;
}
afterEach(async () => {
  for (const path of paths.splice(0))
    await rm(path, { recursive: true, force: true });
});
test("portable folder contract rejects traversal, unknown fields and cross-platform collisions", () => {
  const source = templateFixture();
  expect(parseTemplateBundle(source).components).toHaveLength(1);
  for (const name of [
    "../escape.md",
    "guides/CON.md",
    "guides/trailing.",
    "components",
    "guides",
  ]) {
    const bad = structuredClone(source);
    bad.files[name] = "bad";
    expect(() => parseTemplateBundle(bad)).toThrow();
  }
  const collision = structuredClone(source);
  collision.files["readme.md"] = "duplicate";
  expect(() => parseTemplateBundle(collision)).toThrow(/case-insensitive/);
  const unknown = structuredClone(source);
  unknown.files["README.md"] = unknown.files["README.md"].replace(
    '"schemaVersion": 1',
    '"schemaVersion": 1, "automaticPermissions": true',
  );
  expect(() => parseTemplateBundle(unknown)).toThrow(/Unknown/);
});
test("a stage folder discloses its main README; null inherits the system stage", () => {
  const source = templateFixture("folder", false);
  source.files["README.md"] = source.files["README.md"]
    .replace('"design": "guides/design.md"', '"design": "guides/design"')
    .replace('"evidence": "guides/evidence.md"', '"evidence": null');
  source.files["guides/design/README.md"] = "# Design\nMain.";
  source.files["guides/design/detail.md"] = "# Detail\nOptional.";
  const parsed = parseTemplateBundle(source);
  expect(parsed.guides.design?.path).toBe("guides/design/README.md");
  expect(parsed.guides.evidence).toBeUndefined();
});
test("real directory export/import preserves portable files and rejects symlinks", async () => {
  const directory = await temporary(),
    source = templateFixture();
  const exported = join(directory, "template");
  await writeTemplateDirectory(exported, source);
  expect(await readTemplateDirectory(exported)).toEqual(source);
  await writeFile(join(directory, "outside.md"), "outside");
  await symlink(
    join(directory, "outside.md"),
    join(exported, "guides/linked.md"),
  );
  await expect(readTemplateDirectory(exported)).rejects.toThrow(/symlink/);
});
test("template components compile with isolated names, persist exact refs and survive source roundtrip", async () => {
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Template workflow");
  const summary = await service.saveTemplate(project.id, undefined, {
    bundle: templateFixture(),
  });
  const saved = await getTemplate(home, summary.id, project.id, {
    scope: "project",
    version: summary.version,
    integrity: summary.integrity,
  });
  expect(saved.workflow?.components).toHaveLength(1);
  const binding = saved.workflow!.components[0];
  expect(binding.ref.id).toMatch(/^tpl-guided-example-step-picker-/);
  const compiled = await getComponentByRef(home, binding.ref, project.id);
  expect(compiled.inline?.script).toContain("Next step");
  const context = await service.templateContext(project.id, [
    {
      id: saved.id,
      version: saved.version,
      integrity: saved.integrity,
      scope: "project",
    },
  ]);
  expect(context.system?.required).toBe(true);
  expect(context.components?.[0].ref.integrity).toBe(compiled.integrity);
  const page = await service.applyTemplate(project.id, saved.id);
  expect(page.document.templateContext?.templates[0].integrity).toBe(
    saved.integrity,
  );
  expect(validateDocument(page.document).templateContext).toEqual(
    page.document.templateContext,
  );
  const raw = await service.catalogDescribe(saved.id, {
    projectId: project.id,
    kind: "template",
    scope: "project",
    view: "source",
  });
  expect((raw as { source: unknown }).source).toEqual({
    bundle: templateFixture(),
  });
  const otherSummary = await service.saveTemplate(project.id, undefined, {
    bundle: templateFixture("other-template"),
  });
  const other = await getTemplate(home, otherSummary.id, project.id, {
    scope: "project",
  });
  expect(other.workflow!.components[0].ref.id).not.toBe(binding.ref.id);
  const reference = await readComponentSource(
    home,
    binding.ref.id,
    binding.ref.version,
    project.id,
    { scope: "project", integrity: binding.ref.integrity },
  );
  expect(reference.source).toContain("Next step");
  const node = {
    type: "widget",
    attrs: {
      id: "selected-sequence",
      kind: "custom",
      data: {
        componentId: binding.ref.id,
        version: binding.ref.version,
        integrity: binding.ref.integrity,
        props: { title: "Inheritance", labels: ["Candidate", "Accepted"] },
      },
    },
  };
  const updated = await service.applyPage(project.id, page.document.id, {
    baseHash: page.hash,
    baseRevision: page.revision,
    operations: [{ type: "block.insert", node }],
  });
  expect(
    await resolveDocumentComponents(home, updated.document, project.id),
  ).toHaveLength(1);
});
test("system-only/default context, exact legacy revisions and changed-context cache are distinct", async () => {
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Contexts");
  const base = await service.templateContext(project.id);
  expect(base.context.templates).toEqual([]);
  expect(base.system?.required).toBe(true);
  const report = await service.templateContext(project.id, [
    { id: "evidence-report", scope: "builtin" },
  ]);
  expect(report.context.templates[0].version).toBe("2.1.0");
  const cached = await service.templateContext(
    project.id,
    report.context.templates,
    report.context.hash,
  );
  expect(cached.unchanged).toBe(true);
  expect(cached.system).toBeUndefined();
  const legacy = await getTemplate(home, "evidence-report", project.id, {
    scope: "builtin",
    version: "1.2.1",
  });
  expect(legacy.integrity).toBe(
    "sha256-c21034e9c09752e07d2492b56e2dd73a6a1421f1ed505679019cfd2b8dda3b5a",
  );
  const design = await service.templateGuide(
    project.id,
    "design",
    report.context.templates,
  );
  expect(
    design.documents?.every(
      (document) =>
        !("markdown" in document) ||
        !(document.markdown ?? "").includes("# 研究与证据报告：评审"),
    ),
  ).toBe(true);
  await expect(
    service.templateGuide(project.id, "design", [{ id: "evidence-report" }]),
  ).rejects.toThrow(/pinned/);
});
test("bundled README identity cannot be overridden and the mandatory system cannot be replaced", async () => {
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Identity");
  await expect(
    service.saveTemplate(project.id, undefined, {
      name: "other",
      bundle: templateFixture("identity", false),
    }),
  ).rejects.toThrow(/agree/);
  await expect(
    service.saveTemplate(project.id, undefined, {
      bundle: templateFixture("system-presentation", false),
    }),
  ).rejects.toThrow(/cannot be replaced/);
});

test("folder templates can be forked and promoted without losing guides or component scope", async () => {
  const home = await temporary(),
    service = new AgentService({ root: home });
  const a = await service.createProject("Owner"),
    b = await service.createProject("Consumer");
  const source = templateFixture("shared-folder"),
    parsed = parseTemplateBundle(source);
  parsed.metadata.page = "page.json";
  source.files["README.md"] =
    "---\n" +
    JSON.stringify(parsed.metadata, null, 2) +
    "\n---\n" +
    parsed.body;
  source.files["page.json"] = JSON.stringify({
    content: {
      type: "surface",
      attrs: { id: "root", kind: "page", name: "Sequence" },
      content: [
        {
          type: "widget",
          attrs: {
            id: "sequence",
            kind: "custom",
            data: {
              componentId: "step-picker",
              version: "1.0.0",
              props: {
                title: "Inheritance",
                labels: ["Candidate", "Accepted"],
              },
            },
          },
        },
      ],
    },
    layout: {},
    surfaceViews: {},
  });
  const summary = await service.saveTemplate(a.id, undefined, {
    bundle: source,
  });
  const original = await getTemplate(home, summary.id, a.id, {
    scope: "project",
  });
  const fork = await forkPackage(
    home,
    packageRevisionRef("template", original),
    {
      projectId: a.id,
      id: "forked-folder",
      version: "2.0.0",
      name: "Forked explanation",
    },
  );
  expect("bundle" in fork).toBe(true);
  const forked = await getTemplate(home, "forked-folder", a.id, {
    scope: "project",
  });
  expect(parseTemplateBundle(forked.bundle).metadata.name).toBe(
    "Forked explanation",
  );
  expect(forked.workflow!.components[0].ref.id).not.toBe(
    original.workflow!.components[0].ref.id,
  );
  await promotePackage(home, packageRevisionRef("template", original), {
    projectId: a.id,
    target: "global",
  });
  const context = await service.templateContext(b.id, [
    {
      id: original.id,
      scope: "global",
      version: original.version,
      integrity: original.integrity,
    },
  ]);
  expect(context.components?.[0].ref.scope).toBe("global");
  const applied = await service.applyTemplate(b.id, original.id, undefined, {
    scope: "global",
    version: original.version,
    integrity: original.integrity,
  });
  expect(
    await resolveDocumentComponents(home, applied.document, b.id),
  ).toHaveLength(1);
  await expect(
    service.templateContext(b.id, [
      {
        id: forked.id,
        scope: "project",
        version: forked.version,
        integrity: forked.integrity,
      },
    ]),
  ).rejects.toThrow(/not found/);
});

test("method-only templates reject page structures and apply as empty Pages", async () => {
  const source = templateFixture("method-only", false);
  const { metadata, body } = parseTemplateBundle(source);
  metadata.schemaVersion = 2;
  delete metadata.page;
  source.files["README.md"] =
    "---\n" + JSON.stringify(metadata) + "\n---\n" + body;
  expect(parseTemplateBundle(source).document).toBeUndefined();
  const invalid = structuredClone(source);
  invalid.files["page.json"] = "{}";
  expect(() => parseTemplateBundle(invalid)).toThrow(/page.json/);
  invalid.files["README.md"] =
    "---\n" +
    JSON.stringify({ ...metadata, page: "page.json" }) +
    "\n---\n" +
    body;
  expect(() => parseTemplateBundle(invalid)).toThrow(/page is not supported/);
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Methods");
  const saved = await service.saveTemplate(project.id, undefined, {
    bundle: source,
  });
  const applied = await service.applyTemplate(project.id, saved.id, undefined, {
    scope: "project",
    version: saved.version,
    integrity: saved.integrity,
  });
  expect(applied.document.content.content ?? []).toEqual([
    expect.objectContaining({ type: "paragraph" }),
  ]);
  expect(JSON.stringify(applied.document.content)).not.toContain("widget");
  for (const id of [
    "concept-explainer",
    "decision-comparison",
    "evidence-report",
    "procedure-guide",
    "progress-report",
    "exploration-map",
  ]) {
    const current = await getTemplate(home, id, project.id, {
      scope: "builtin",
    });
    expect(parseTemplateBundle(current.bundle).metadata.schemaVersion).toBe(2);
    expect(current.document.content.content ?? []).toHaveLength(0);
    const previous = await getTemplate(home, id, project.id, {
      scope: "builtin",
      version: "2.0.0",
    });
    expect(parseTemplateBundle(previous.bundle).metadata.schemaVersion).toBe(1);
    expect(previous.document.content.content?.length).toBeGreaterThan(0);
  }
});
