import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDocs,
  compareDocs,
  componentFile,
  writeDocs,
} from "./sync-docs.mjs";

const projectId = "docs-project";
const hex = "a".repeat(64);
const key = `doc-hero:1.0.0:sha256-${hex}`;
const page = (id, title, parentId = null, componentKeys = []) => ({
  document: {
    id,
    title,
    icon: "📄",
    parentId,
    archived: false,
    content: { type: "surface" },
  },
  componentKeys,
});
function website(title = (text) => text) {
  const seed = {
    projects: {
      [projectId]: {
        name: title("ShowAI 文档"),
        icon: "📖",
        folders: [
          {
            id: "use",
            name: title("使用"),
            parentId: null,
            sortBy: "manual",
            manualOrder: ["install", "export"],
          },
          { id: "old", name: "旧文档", parentId: null, archived: true },
        ],
      },
    },
    sidebar: {
      entryOrder: {
        [projectId]: ["intro", "home", "faq", "use", "export", "install"],
      },
    },
    pages: {
      [`${projectId}/intro`]: page("intro", title("介绍")),
      [`${projectId}/home`]: page("home", title("文档"), null, [key]),
      [`${projectId}/faq`]: page("faq", title("常见问题")),
      [`${projectId}/install`]: page("install", title("安装"), "use"),
      [`${projectId}/export`]: page("export", title("导出"), "use", [key]),
      ["other/page"]: page("page", "其他项目"),
    },
  };
  return {
    seed,
    catalog: {
      components: {
        [key]: { id: "doc-hero", version: "1.0.0", html: title("<p>英雄</p>") },
      },
    },
  };
}
const english = (text) => `${text} (en)`;
const input = () => {
  const zh = website(),
    en = website(english);
  return {
    seeds: { "zh-CN": zh.seed, en: en.seed },
    catalogs: { "zh-CN": zh.catalog, en: en.catalog },
    site: {
      projectId,
      pages: { "": "home", install: "install", export: "export" },
      appExclude: ["intro"],
    },
  };
};

test("the App receives the website's documentation pages in their folders and order, per language", () => {
  const files = buildDocs(input());
  const manifest = JSON.parse(files.get("manifest.json"));
  assert.deepEqual(manifest.locales["zh-CN"].tree, [
    { type: "page", id: "home" },
    // A page without a slug is still documentation; slugs only name link targets.
    { type: "page", id: "faq" },
    {
      type: "folder",
      id: "use",
      name: "使用",
      children: [
        { type: "page", id: "install" },
        { type: "page", id: "export" },
      ],
    },
  ]);
  assert.equal(manifest.locales.en.name, "ShowAI 文档 (en)");
  assert.equal(manifest.locales.en.pages.install.title, "安装 (en)");
  assert.deepEqual(manifest.locales["zh-CN"].pages.home.components, [
    `zh-CN/components/${componentFile(key)}`,
  ]);
  assert.equal(componentFile(key), `doc-hero@1.0.0-${hex.slice(0, 12)}.json`);
  // The launch article (appExclude) and pages of other projects are website content.
  assert.ok(!files.has("zh-CN/pages/intro.json"));
  assert.ok(!files.has("zh-CN/pages/page.json"));
  assert.equal(
    JSON.parse(files.get("en/pages/export.json")).title,
    "导出 (en)",
  );
  assert.equal(
    JSON.parse(files.get(`en/components/${componentFile(key)}`)).html,
    "<p>英雄</p> (en)",
  );
});

test("missing documentation pages or components stop the sync", () => {
  const withoutPage = input();
  delete withoutPage.seeds.en.pages[`${projectId}/install`];
  assert.throws(
    () => buildDocs(withoutPage),
    /en seed is missing documentation pages: install/,
  );
  const withoutComponent = input();
  withoutComponent.catalogs["zh-CN"].components = {};
  assert.throws(
    () => buildDocs(withoutComponent),
    /zh-CN catalog has no component/,
  );
});

test("the check reports changed, missing and leftover files", () => {
  const dir = mkdtempSync(join(tmpdir(), "showai-docs-"));
  try {
    const files = buildDocs(input());
    writeDocs(files, dir);
    assert.deepEqual(compareDocs(files, dir), []);
    writeFileSync(join(dir, "zh-CN/pages/home.json"), "{}");
    writeFileSync(join(dir, "zh-CN/pages/removed.json"), "{}");
    rmSync(join(dir, "en/pages/install.json"));
    assert.deepEqual(compareDocs(files, dir).sort(), [
      "changed zh-CN/pages/home.json",
      "extra zh-CN/pages/removed.json",
      "missing en/pages/install.json",
    ]);
    writeDocs(files, dir);
    assert.deepEqual(compareDocs(files, dir), []);
    assert.equal(
      readFileSync(join(dir, "zh-CN/pages/home.json"), "utf8"),
      files.get("zh-CN/pages/home.json"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
