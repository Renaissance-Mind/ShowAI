import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LEGACY_TEMPLATE_STAGES,
  parseTemplateBundle,
  stageGuidePath,
  TEMPLATE_STAGES,
  TEMPLATE_WORKFLOW_CAPABILITIES,
} from "../portable/template-bundle.mjs";
import {
  readTemplateDirectory,
  writeTemplateDirectory,
} from "./template-bundle-files";
import { templateFixture } from "../test/template-fixture";
import { AgentService } from "../agent/service";
import {
  getTemplate,
  getComponentByRef,
  listTemplates,
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
test("the workflow has four stages and the capability advertises protocol v2", () => {
  expect([...TEMPLATE_STAGES]).toEqual([
    "intent",
    "material",
    "logic",
    "design",
  ]);
  expect(TEMPLATE_WORKFLOW_CAPABILITIES.protocol).toBe(
    "showai-template-workflow-v2",
  );
  expect(TEMPLATE_WORKFLOW_CAPABILITIES.schemaVersion).toBe(3);
});
test("portable folder contract rejects traversal, unknown fields, page skeletons and cross-platform collisions", () => {
  const source = templateFixture();
  const parsed = parseTemplateBundle(source);
  expect(parsed.components).toHaveLength(1);
  expect(parsed.legacy).toBe(false);
  expect(Object.keys(parsed.guides)).toEqual([...TEMPLATE_STAGES]);
  for (const name of [
    "../escape.md",
    "guides/CON.md",
    "guides/trailing.",
    "components",
    "guides",
    "page.json",
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
    '"schemaVersion": 3',
    '"schemaVersion": 3, "automaticPermissions": true',
  );
  expect(() => parseTemplateBundle(unknown)).toThrow(/Unknown/);
  const legacyStage = structuredClone(source);
  legacyStage.files["README.md"] = legacyStage.files["README.md"].replace(
    '"material": "guides/material.md"',
    '"evidence": "guides/material.md"',
  );
  expect(() => parseTemplateBundle(legacyStage)).toThrow(/stage guide/);
});
test("a stage folder discloses its main README; null inherits the system stage", () => {
  const source = templateFixture("folder", false);
  source.files["README.md"] = source.files["README.md"]
    .replace('"design": "guides/design.md"', '"design": "guides/design"')
    .replace('"material": "guides/material.md"', '"material": null');
  source.files["guides/design/README.md"] = "# Design\nMain.";
  source.files["guides/design/detail.md"] = "# Detail\nOptional.";
  const parsed = parseTemplateBundle(source);
  expect(parsed.guides.design?.path).toBe("guides/design/README.md");
  expect(parsed.guides.material).toBeUndefined();
  expect(stageGuidePath(parsed.metadata, "material")).toBeNull();
});
test("legacy six-stage bundles map evidence/understanding onto material/logic and keep their page skeleton", () => {
  const legacy = templateFixture("legacy-six", false, true);
  const parsed = parseTemplateBundle(legacy);
  expect(parsed.legacy).toBe(true);
  expect(parsed.metadata.schemaVersion).toBe(1);
  expect(parsed.guides.material?.path).toBe("guides/evidence.md");
  expect(parsed.guides.logic?.path).toBe("guides/understanding.md");
  expect(stageGuidePath(parsed.metadata, "logic")).toBe(
    "guides/understanding.md",
  );
  expect(Object.keys(parsed.guides)).toEqual([...TEMPLATE_STAGES]);
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
  expect(saved.workflow?.stages).toEqual([...TEMPLATE_STAGES]);
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
  expect(context.stages).toEqual([...TEMPLATE_STAGES]);
  expect(context.templates?.[0]).not.toHaveProperty("legacyStages");
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
test("builtin catalog ships only the system baseline, the paper explainer and blank", async () => {
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Builtins");
  const ids = (await listTemplates(home, project.id)).map((item) => item.id);
  expect(ids.sort()).toEqual([
    "blank",
    "paper-explainer",
    "system-presentation",
  ]);
  for (const id of ["system-presentation", "paper-explainer"]) {
    const current = await getTemplate(home, id, project.id, {
      scope: "builtin",
    });
    const parsed = parseTemplateBundle(current.bundle);
    expect(parsed.metadata.schemaVersion).toBe(3);
    expect(parsed.metadata.version).toBe(
      id === "paper-explainer" ? "2.1.2" : "2.0.0",
    );
    expect(Object.keys(parsed.guides)).toEqual([...TEMPLATE_STAGES]);
    expect(current.document.content.content ?? []).toHaveLength(0);
  }
  const base = await service.templateContext(project.id);
  expect(base.context.templates).toEqual([]);
  expect(base.system?.required).toBe(true);
  expect(base.system?.readme).toContain("理解意图");
  const paper = await service.templateContext(project.id, [
    { id: "paper-explainer", scope: "builtin" },
  ]);
  expect(paper.context.templates[0].version).toBe("2.1.2");
  const summary = paper.templates?.[0];
  expect(summary && "stages" in summary).toBe(true);
  expect(
    summary && "stages" in summary
      ? summary.stages.map((stage) => stage.stage)
      : [],
  ).toEqual([...TEMPLATE_STAGES]);
  const cached = await service.templateContext(
    project.id,
    paper.context.templates,
    paper.context.hash,
  );
  expect(cached.unchanged).toBe(true);
  expect(cached.system).toBeUndefined();
  const design = await service.templateGuide(
    project.id,
    "design",
    paper.context.templates,
  );
  expect(design.documents).toHaveLength(2);
  expect(
    design.documents?.every(
      (document) =>
        !("path" in document) || String(document.path).includes("design"),
    ),
  ).toBe(true);
  await expect(
    service.templateGuide(project.id, "design", [{ id: "paper-explainer" }]),
  ).rejects.toThrow(/pinned/);
  await expect(
    service.templateGuide(
      project.id,
      "authoring" as never,
      paper.context.templates,
    ),
  ).rejects.toThrow(/Unknown presentation stage/);
});
test("legacy saved templates stay readable through the four current stages", async () => {
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Legacy");
  const saved = await service.saveTemplate(project.id, undefined, {
    bundle: templateFixture("legacy-six", false, true),
  });
  const context = await service.templateContext(project.id, [
    {
      id: saved.id,
      scope: "project",
      version: saved.version,
      integrity: saved.integrity,
    },
  ]);
  // Records saved before the four-stage runtime hash their six declared
  // stages; the runtime keeps that list so stored integrity still verifies.
  expect(saved.workflow?.stages).toEqual([...LEGACY_TEMPLATE_STAGES]);
  const legacySummary = context.templates?.[0];
  expect(legacySummary).toMatchObject({ legacyStages: true });
  expect(
    legacySummary && "stages" in legacySummary
      ? legacySummary.stages.find((stage) => stage.stage === "logic")?.path
      : undefined,
  ).toBe("guides/understanding.md");
  const logic = await service.templateGuide(
    project.id,
    "logic",
    context.context.templates,
  );
  const document = logic.documents?.[1];
  expect(document && "path" in document ? document.path : undefined).toBe(
    "guides/understanding.md",
  );
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
  const source = templateFixture("shared-folder");
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
  expect(applied.document.content.content ?? []).toEqual([
    expect.objectContaining({ type: "paragraph" }),
  ]);
  expect(JSON.stringify(applied.document.content)).not.toContain("widget");
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

test("legacy schemaVersion 1 page skeletons still instantiate while schemaVersion 3 rejects them", async () => {
  const source = templateFixture("legacy-page", true, true);
  const { metadata, body } = parseTemplateBundle(source);
  metadata.page = "page.json";
  source.files["README.md"] =
    "---\n" + JSON.stringify(metadata, null, 2) + "\n---\n" + body;
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
  expect(parseTemplateBundle(source).document).toBeDefined();
  const invalid = templateFixture("current-page", false);
  const current = parseTemplateBundle(invalid);
  invalid.files["README.md"] =
    "---\n" +
    JSON.stringify({ ...current.metadata, page: "page.json" }) +
    "\n---\n" +
    current.body;
  expect(() => parseTemplateBundle(invalid)).toThrow(/legacy schemaVersion 1/);
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Legacy pages");
  const saved = await service.saveTemplate(project.id, undefined, {
    bundle: source,
  });
  const applied = await service.applyTemplate(project.id, saved.id, undefined, {
    scope: "project",
    version: saved.version,
    integrity: saved.integrity,
  });
  expect(
    await resolveDocumentComponents(home, applied.document, project.id),
  ).toHaveLength(1);
});
