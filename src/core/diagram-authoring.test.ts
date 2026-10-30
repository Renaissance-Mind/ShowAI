import { expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readBuiltinComponentSource } from "./catalog";
import { defaultPython, generateDiagram } from "./diagram-authoring-runner.js";
import {
  componentAuthoringIndex,
  componentAuthoringGuide,
} from "../components/custom/authoring";
import { listDiagramTemplates } from "../components/blocks/diagrams/templates";
import { CAPACITY } from "../portable/capacity.mjs";
import {
  applyTemplate,
  renderCards,
} from "../components/blocks/diagrams/archify-utils.mjs";
import archifyShell from "../components/blocks/diagrams/archify-shell.json";

const execute = promisify(execFile);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const families = ["archify", "diagram-design", "fireworks-tech-graph"] as const;

test("the full original guides, inputs and production files travel with each component within source budgets", () => {
  for (const family of families) {
    const source = readBuiltinComponentSource(family);
    const index = componentAuthoringIndex(source.files, "authoring/index.json");
    expect(Object.keys(source.files).length).toBeLessThanOrEqual(
      CAPACITY.componentFiles,
    );
    expect(
      Object.values(source.files).reduce(
        (sum, value) => sum + Buffer.byteLength(value),
        0,
      ),
    ).toBeLessThanOrEqual(CAPACITY.componentSourceBytes);
    const kit = JSON.parse(source.files[index.kit!]);
    expect(kit.commit).toBe(index.commit);
    expect(kit.repository).toBe(index.repository);
    for (const ref of index.guides) {
      const guide = componentAuthoringGuide(source.files, index, ref.id);
      expect(sha(guide.markdown)).toBe(ref.sha256);
      expect(guide.markdown).toBe(kit.files[guide.sourcePath!].text);
    }
    for (const value of Object.values(kit.files) as {
      text: string;
      sha256: string;
    }[])
      expect(sha(value.text)).toBe(value.sha256);
    expect(
      index.guides.some((guide) => guide.sourcePath?.endsWith("SKILL.md")),
    ).toBe(true);
    expect(index.guides.length).toBeGreaterThan(10);
    const missing = { ...source.files };
    delete missing[index.guides[0].file];
    expect(() =>
      componentAuthoringIndex(missing, "authoring/index.json"),
    ).toThrow("缺少制作文件");
  }
});

test("same authored HTML or SVG is preserved exactly by the design and style-8 authoring paths", async () => {
  const parent = process.env.SHOWAI_TEST_OUTPUT_DIR ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "diagram-authored-"));
  try {
    for (const family of ["diagram-design", "fireworks-tech-graph"] as const) {
      const source = readBuiltinComponentSource(family);
      const kitPath = join(root, `${family}.json`);
      await writeFile(kitPath, source.files["authoring/kit.json"]);
      const template = listDiagramTemplates(family).find(
        (item) => family === "diagram-design" || item.id === "style-8",
      )!;
      const input = join(root, `${family}.html`);
      await writeFile(input, template.source);
      const result = await generateDiagram({
        kit: kitPath,
        type: "authored",
        input,
        out: join(root, `${family}-result.html`),
        workDir: join(root, `${family}-original`),
      });
      expect(result.data.source).toBe(template.source);
      expect(result.sourceSha256).toBe(sha(template.source));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all ten Archify types and eleven Fireworks generation styles match directly executing the unchanged original renderer", async () => {
  const parent = process.env.SHOWAI_TEST_OUTPUT_DIR ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "diagram-renderers-"));
  try {
    for (const family of ["archify", "fireworks-tech-graph"] as const) {
      const source = readBuiltinComponentSource(family),
        kit = JSON.parse(source.files["authoring/kit.json"]);
      if (family === "archify") {
        expect(listDiagramTemplates(family).map((item) => item.id)).toEqual([
          "workflow",
          "architecture",
          "sequence",
          "dataflow",
          "lifecycle",
          "erd",
          "class",
          "tree",
          "timeline",
          "waterfall",
        ]);
      }
      const reference = join(root, `${family}-reference`),
        kitPath = join(root, `${family}.json`);
      await writeFile(kitPath, source.files["authoring/kit.json"]);
      for (const [name, file] of Object.entries(kit.files) as [
        string,
        { text: string },
      ][]) {
        const path = join(reference, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.text);
      }
      for (const template of listDiagramTemplates(family).filter(
        (item) => item.input,
      )) {
        const inputData = structuredClone(template.input) as Record<
          string,
          any
        >;
        if (family === "archify")
          inputData.meta.title = "同一内容 · Shared input";
        else inputData.title = "同一内容 · Shared input";
        const input = join(root, `${family}-${template.id}.json`);
        await writeFile(input, JSON.stringify(inputData));
        const type = family === "archify" ? template.id : inputData.mode;
        const direct = join(
          root,
          `${family}-${template.id}-direct.${family === "archify" ? "html" : "svg"}`,
        );
        if (family === "archify")
          await execute(
            process.execPath,
            [
              join(
                reference,
                kit.root,
                "renderers",
                type,
                `render-${type}.mjs`,
              ),
              input,
              direct,
            ],
            { maxBuffer: 8 * 1024 * 1024 },
          );
        else
          await execute(
            defaultPython(),
            [
              join(reference, kit.root, "scripts/generate-from-template.py"),
              type,
              direct,
              JSON.stringify(inputData),
            ],
            {
              maxBuffer: 8 * 1024 * 1024,
              env: { ...process.env, PYTHONUTF8: "1" },
            },
          );
        const result = await generateDiagram({
          kit: kitPath,
          type,
          input,
          out: join(
            root,
            `${family}-${template.id}-component.${family === "archify" ? "html" : "svg"}`,
          ),
          workDir: join(root, `${family}-${template.id}-work`),
        });
        expect(result.data.source, `${family}/${template.id}`).toBe(
          await readFile(direct, "utf8"),
        );
        expect(result.originalSourceSha256).toBe(result.sourceSha256);
        expect(result.input).toEqual(inputData);
        expect(resolve(result.path)).not.toBe(resolve(input));
        if (family === "archify") {
          // Built-in samples must retain the original renderer's complete output,
          // including SVG semantics, motion and the viewer's embedded resources.
          await writeFile(input, JSON.stringify(template.input));
          const render = join(
            reference,
            kit.root,
            "renderers",
            type,
            `render-${type}.mjs`,
          );
          await execute(process.execPath, [render, input, direct]);
          expect(template.source, `builtin/${type}`).toBe(
            await readFile(direct, "utf8"),
          );
          // The browser replaces filesystem locale loading with bundled JSON.
          // Check it against the untouched renderer, including locale casing.
          const localized = structuredClone(template.input) as any;
          localized.meta.locale = ["zh-CN", "zh-TW", "es", "ko", "zh-cn"][
            listDiagramTemplates(family).findIndex((item) => item.id === type) %
              5
          ];
          await writeFile(input, JSON.stringify(localized));
          await execute(process.execPath, [render, input, direct]);
          const rendered = await readFile(direct, "utf8");
          const svg = rendered.match(
            /^[ \t]*<svg\b[^>]*aria-labelledby="archify-diagram-title archify-diagram-description"[\s\S]*?<\/svg>/m,
          )![0];
          expect(
            applyTemplate(archifyShell.html, {
              title: localized.meta.title,
              subtitle: localized.meta.subtitle,
              locale: localized.meta.locale,
              visualPreset: localized.meta.visual_preset || "classic",
              svg,
              cards: renderCards(localized.cards ?? []),
            }),
            `locale/${type}`,
          ).toBe(rendered);
        }
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120000);

test("Agents discover the scoped production files through the normal use guide", async () => {
  const { AgentService } = await import("../agent/service");
  const parent = process.env.SHOWAI_TEST_OUTPUT_DIR ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const home = await mkdtemp(join(parent, "diagram-guide-"));
  try {
    const service = new AgentService({ root: home });
    for (const family of families) {
      const guide = (await service.catalogDescribe(family, {
        kind: "component",
        scope: "builtin",
        view: "guide",
      })) as any;
      expect(guide.authoringReference.arguments).toMatchObject({
        id: family,
        scope: "builtin",
        version: family === "archify" ? "1.2.0" : "1.1.0",
        view: "source",
        file: "authoring/index.json",
      });
      const index = (await service.catalogDescribe(
        family,
        guide.authoringReference.arguments,
      )) as any;
      expect(JSON.parse(index.content).family).toBe(family);
      expect(index.content).not.toContain('"markdown"');
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("local production instructions need no invented repository and malformed package references fail", () => {
  const markdown = "# 绘制流程\n先读取实际内容，再布置节点和关系。";
  const ref = {
    id: "process",
    title: "制作流程",
    file: "authoring/process.json",
    sha256: sha(markdown),
  };
  const files = {
    "authoring/index.json": JSON.stringify({
      format: "showai-component-authoring",
      version: 1,
      guides: [ref],
    }),
    [ref.file]: JSON.stringify({
      format: "showai-authoring-guide",
      version: 1,
      ...ref,
      markdown,
    }),
  };
  const index = componentAuthoringIndex(files, "authoring/index.json");
  expect(componentAuthoringGuide(files, index, "process").markdown).toBe(
    markdown,
  );
  expect(() => componentAuthoringIndex(files, "../index.json")).toThrow(
    "组件源码包",
  );
});

test("downloaded production tools run independently inside a CommonJS project", async () => {
  const parent = process.env.SHOWAI_TEST_OUTPUT_DIR ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "diagram-cli-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ type: "commonjs" }),
    );
    const source = readBuiltinComponentSource("archify");
    for (const path of [
      "authoring/run.mjs",
      "authoring/kit.json",
      "authoring/diagram-authoring-fonts.mjs",
      "authoring/font-licenses.json",
    ]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source.files[path]);
    }
    const sample = listDiagramTemplates("archify")[0];
    await writeFile(join(root, "input.json"), JSON.stringify(sample.input));
    const out = join(root, "diagram.html"),
      result = join(root, "component.json");
    const execution = await execute(
      process.execPath,
      [
        join(root, "authoring/run.mjs"),
        "--kit",
        join(root, "authoring/kit.json"),
        "--type",
        sample.id,
        "--input",
        join(root, "input.json"),
        "--out",
        out,
        "--work-dir",
        join(root, "original"),
        "--result",
        result,
      ],
      { cwd: root, maxBuffer: 1024 * 1024 },
    );
    expect(JSON.parse(execution.stdout).ok).toBe(true);
    const generated = JSON.parse(await readFile(result, "utf8"));
    expect(generated.data.source).toBe(await readFile(out, "utf8"));
    expect(generated.sourceSha256).toBe(sha(generated.data.source));
    expect(generated.data.source).toContain("Agent Tool Call Workflow");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
