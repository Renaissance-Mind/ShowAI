import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { AgentService } from "../agent/service";
import { parameterComponent } from "../test/parameter-component";
import { getComponent, lockDocumentComponents, blankDocument } from "./catalog";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "showai-parameter-"));
  roots.push(home);
  const service = new AgentService({ root: home });
  const project = await service.createProject("Parameter contract");
  return { home, service, project };
}

test("actual compilation emits portable relation checks and query pages retain exact versions/cache", async () => {
  const { home, service, project } = await setup(),
    source = parameterComponent();
  const saved = await service.saveComponent(project.id, source);
  const component = await getComponent(
    home,
    saved.id,
    saved.version,
    project.id,
    { scope: "project", integrity: saved.integrity },
  );
  expect(component.html).toContain("Coordinate extent exceeds");
  expect(component.inline?.script).toContain("Coordinate extent exceeds");
  const input = {
    projectId: project.id,
    kind: "component" as const,
    id: saved.id,
    scope: "project" as const,
    version: saved.version,
    integrity: saved.integrity,
    view: "parameters" as const,
    parameterLimit: 3,
  };
  const page = (await service.catalogDescribe(saved.id, input)) as any;
  expect(page.entries).toHaveLength(3);
  expect(page.definitionValidated).toBe(true);
  expect(page.diagnosticCount).toBe(0);
  expect(page.nextPage.arguments.version).toBe(saved.version);
  const next = (await service.catalogDescribe(
    saved.id,
    page.nextPage.arguments,
  )) as any;
  expect(next.offset).toBe(3);
  const cache = (await service.catalogDescribe(saved.id, {
    ...input,
    knownHash: page.hash,
  })) as any;
  expect(cache.unchanged).toBe(true);
  expect(cache.entries).toBeUndefined();
  const selected = (await service.catalogDescribe(saved.id, {
    ...input,
    parameterPath: "slides[].regions[].box",
    parameterLimit: 20,
  })) as any;
  expect(selected.total).toBe(5);
  expect(
    selected.entries.every((e: any) =>
      e.path.startsWith("/slides/*/regions/*/box"),
    ),
  ).toBe(true);
  expect(JSON.stringify(selected)).not.toContain("createRoot");
  const cliArgs = [
    resolve("dist-agent/cli.mjs"),
    "--home",
    home,
    "catalog",
    "describe",
    saved.id,
    "--project",
    project.id,
    "--scope",
    "project",
    "--version",
    saved.version!,
    "--integrity",
    saved.integrity!,
    "--kind",
    "component",
    "--view",
    "parameters",
    "--parameter-path",
    "slides[].regions[].box.x",
    "--parameter-limit",
    "1",
    "--parameter-offset",
    "0",
    "--json",
  ];
  const cli = JSON.parse(
    (await promisify(execFile)(process.execPath, cliArgs)).stdout,
  );
  expect(cli.ok).toBe(true);
  expect(cli.data.entries[0].path).toBe("/slides/*/regions/*/box/x");
  const cliCached = JSON.parse(
    (
      await promisify(execFile)(process.execPath, [
        ...cliArgs,
        "--known-hash",
        cli.data.hash,
      ])
    ).stdout,
  );
  expect(cliCached.data.unchanged).toBe(true);
  expect(cliCached.data.entries).toBeUndefined();
  await expect(
    service.catalogDescribe(saved.id, { ...input, parameterPath: "notHere" }),
  ).rejects.toThrow("Unknown");
  const guide = (await service.catalogDescribe(saved.id, {
    ...input,
    view: "guide",
    parameterLimit: undefined,
  })) as any;
  expect(guide.parameterReference.arguments.view).toBe("parameters");
  expect(guide.schema).toBeUndefined();
  expect(guide.guide.inputs).toBeUndefined();
  expect(guide.guide.rules).toBeUndefined();
}, 60000);

test("actual page saves refuse invalid relational inputs without replacing the valid original", async () => {
  const { home, service, project } = await setup(),
    source = parameterComponent();
  const saved = await service.saveComponent(project.id, source);
  const doc = blankDocument();
  doc.content.content = [
    {
      type: "widget",
      attrs: {
        id: "regions",
        kind: "custom",
        data: {
          componentId: saved.id,
          version: saved.version,
          integrity: saved.integrity,
          props: source.manifest.defaultData,
        },
      },
    },
  ];
  const page = await service.createPage(project.id, { document: doc });
  const attempt = structuredClone(page.document);
  (
    attempt.content.content![0].attrs!.data.props as any
  ).slides[0].regions[0].box.x = 95;
  await expect(
    service.savePage(
      project.id,
      page.document.id,
      attempt,
      page.hash,
      undefined,
      undefined,
      page.revision,
    ),
  ).rejects.toThrow("relations");
  const reread = await service.readPage(project.id, page.document.id, {
    rendered: false,
  });
  expect(reread.hash).toBe(page.hash);
  const invalid = structuredClone(doc);
  (invalid.content.content![0].attrs!.data.props as any).selected = "missing";
  await expect(
    lockDocumentComponents(home, invalid, project.id),
  ).rejects.toThrow("Reference");
}, 60000);
