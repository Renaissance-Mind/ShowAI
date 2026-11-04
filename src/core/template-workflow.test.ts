import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  declaredGuidePaths,
  LEGACY_TEMPLATE_STAGES,
  parseTemplateBundle,
  STAGED_TEMPLATE_STAGES,
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
test("templates are read whole and the capability advertises protocol v3", () => {
  expect(TEMPLATE_WORKFLOW_CAPABILITIES.protocol).toBe(
    "showai-template-workflow-v3",
  );
  expect(TEMPLATE_WORKFLOW_CAPABILITIES.schemaVersion).toBe(4);
  expect(TEMPLATE_WORKFLOW_CAPABILITIES.guideDisclosure).toBe(
    "whole-template",
  );
  expect(TEMPLATE_WORKFLOW_CAPABILITIES.legacySchemaVersions).toEqual([
    1, 2, 3,
  ]);
});
test("portable folder contract rejects traversal, unknown fields, page skeletons and cross-platform collisions", () => {
  const source = templateFixture();
  const parsed = parseTemplateBundle(source);
  expect(parsed.components).toHaveLength(1);
  expect(parsed.legacy).toBe(false);
  expect(parsed.staged).toBe(false);
  expect(parsed.guides.map((guide) => guide.path)).toEqual([
    "guides/method.md",
    "guides/design.md",
  ]);
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
    '"schemaVersion": 4',
    '"schemaVersion": 4, "automaticPermissions": true',
  );
  expect(() => parseTemplateBundle(unknown)).toThrow(/Unknown/);
  const staged = structuredClone(source);
  staged.files["README.md"] = staged.files["README.md"].replace(
    '"guides/method.md",',
    '{"intent": "guides/method.md"},',
  );
  expect(() => parseTemplateBundle(staged)).toThrow(/guide/);
  const outside = structuredClone(source);
  outside.files["README.md"] = outside.files["README.md"].replace(
    '"guides/method.md"',
    '"method.md"',
  );
  outside.files["method.md"] = "# Method";
  expect(() => parseTemplateBundle(outside)).toThrow(/under guides/);
  const missing = structuredClone(source);
  delete missing.files["guides/design.md"];
  expect(() => parseTemplateBundle(missing)).toThrow(/Missing template file/);
});
test("a template without guides is only its README", () => {
  const source = templateFixture("overview-only", false);
  source.files["README.md"] = source.files["README.md"].replace(
    /"guides": \[[^\]]*\]/,
    '"guides": []',
  );
  delete source.files["guides/method.md"];
  delete source.files["guides/design.md"];
  expect(parseTemplateBundle(source).guides).toEqual([]);
});
test("staged schemaVersion 3 bundles stay readable as guides in stage order; folders add their subfiles", () => {
  const source = templateFixture("folder", false, "staged");
  source.files["README.md"] = source.files["README.md"]
    .replace('"design": "guides/design.md"', '"design": "guides/design"')
    .replace('"material": "guides/material.md"', '"material": null');
  source.files["guides/design/README.md"] = "# Design\nMain.";
  source.files["guides/design/detail.md"] = "# Detail\nOptional.";
  delete source.files["guides/design.md"];
  delete source.files["guides/material.md"];
  const parsed = parseTemplateBundle(source);
  expect(parsed.staged).toBe(true);
  expect(parsed.legacy).toBe(false);
  expect(parsed.guides.map((guide) => guide.path)).toEqual([
    "guides/intent.md",
    "guides/logic.md",
    "guides/design/README.md",
    "guides/design/detail.md",
  ]);
});
test("legacy six-stage bundles disclose intent, evidence, understanding and design and keep their page skeleton", () => {
  const legacy = templateFixture("legacy-six", false, true);
  const parsed = parseTemplateBundle(legacy);
  expect(parsed.legacy).toBe(true);
  expect(parsed.metadata.schemaVersion).toBe(1);
  expect(declaredGuidePaths(parsed.metadata)).toEqual([
    "guides/intent.md",
    "guides/evidence.md",
    "guides/understanding.md",
    "guides/design.md",
  ]);
  expect(parsed.guides.map((guide) => guide.path)).not.toContain(
    "guides/authoring.md",
  );
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
  expect(saved.workflow).not.toHaveProperty("stages");
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
  const whole = context.templates?.[0];
  expect(whole && "guides" in whole ? whole.guides : []).toHaveLength(2);
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
test("builtin catalog ships only the system workflow, the paper explainer and blank", async () => {
  const home = await temporary(),
    service = new AgentService({ root: home });
  const project = await service.createProject("Builtins");
  const ids = (await listTemplates(home, project.id)).map((item) => item.id);
  expect(ids.sort()).toEqual(["paper-explainer", "system-presentation"]);
  for (const id of ["system-presentation", "paper-explainer"]) {
    const current = await getTemplate(home, id, project.id, {
      scope: "builtin",
    });
    const parsed = parseTemplateBundle(current.bundle);
    expect(parsed.metadata.schemaVersion).toBe(4);
    expect(parsed.metadata.version).toBe("3.0.0");
    expect(parsed.guides.length).toBeGreaterThan(0);
    expect(current.document.content.content ?? []).toHaveLength(0);
  }
  const base = await service.templateContext(project.id);
  expect(base.context.templates).toEqual([]);
  expect(base.context.system.id).toBe("system-presentation");
  expect(base.system.required).toBe(true);
  expect(base.system).not.toHaveProperty("readme");
  const paper = await service.templateContext(project.id, [
    { id: "paper-explainer", scope: "builtin" },
  ]);
  expect(paper.context.templates[0].version).toBe("3.0.0");
  const summary = paper.templates?.[0];
  expect(summary && "readme" in summary ? summary.readme : "").toContain(
    "论文",
  );
  expect(
    summary && "guides" in summary ? summary.guides.length : 0,
  ).toBeGreaterThan(0);
  const cached = await service.templateContext(
    project.id,
    paper.context.templates,
    paper.context.hash,
  );
  expect(cached.unchanged).toBe(true);
  expect(cached.templates).toBeUndefined();
});
test("staged and legacy saved templates stay readable and keep verifying", async () => {
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
  // Records saved by earlier runtimes hash their declared stages; the runtime
  // keeps that list so stored integrity still verifies.
  expect(saved.workflow?.stages).toEqual([...LEGACY_TEMPLATE_STAGES]);
  const legacySummary = context.templates?.[0];
  expect(legacySummary).toHaveProperty("note");
  expect(
    legacySummary && "guides" in legacySummary
      ? legacySummary.guides.map((guide) => guide.path)
      : [],
  ).toEqual([
    "guides/intent.md",
    "guides/evidence.md",
    "guides/understanding.md",
    "guides/design.md",
  ]);
  const staged = await service.saveTemplate(project.id, undefined, {
    bundle: templateFixture("staged-four", false, "staged"),
  });
  const stored = await getTemplate(home, staged.id, project.id, {
    scope: "project",
    version: staged.version,
    integrity: staged.integrity,
  });
  expect(stored.workflow?.stages).toEqual([...STAGED_TEMPLATE_STAGES]);
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
