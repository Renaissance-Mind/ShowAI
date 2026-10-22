import { describe, expect, it } from "vitest";
import { escapeJsonForHtml, serializeArtifact } from "../lib/artifact";
import { newDocument } from "../lib/document";
import {
  htmlArtifactSource,
  importedArtifact,
  isImportablePageFile,
} from "./page-import";
import { templateAgentPrompt, templateSelection } from "./template-actions";
import {
  readAppearancePreference,
  resolveAppearance,
} from "../design/appearance-preference";
import { supportsManualEditing } from "../components/blocks/manual-editing";
import { rememberExport, revealableExport } from "../workbench/actions";

describe("page import", () => {
  it("accepts the same file types as the import dialog", () => {
    for (const name of ["a.json", "a.HTML", "a.htm", "notes.md", "x.markdown", "t.txt"])
      expect(isImportablePageFile(name), name).toBe(true);
    for (const name of ["photo.png", "README", "md", "data.csv"])
      expect(isImportablePageFile(name), name).toBe(false);
  });

  it("turns Markdown and text into a new page titled after the file", () => {
    const artifact = importedArtifact({
      name: "会议纪要.md",
      content: "# 标题\n\n第一段",
    });
    expect(artifact.document.title).toBe("会议纪要");
    expect(JSON.stringify(artifact.document.content)).toContain("第一段");
  });

  it("reads the page source embedded in an exported HTML file", () => {
    const document = newDocument("导出的页面");
    const source = serializeArtifact(document, []);
    const html = `<!doctype html><html><body><script type="application/json" id="showai-data">${escapeJsonForHtml(JSON.parse(source))}</script><script>1</script></body></html>`;
    expect(htmlArtifactSource(html)).toBe(escapeJsonForHtml(JSON.parse(source)));
    expect(importedArtifact({ name: "page.html", content: html }).document.title)
      .toBe("导出的页面");
    expect(
      importedArtifact({ name: "page.showai.json", content: source }).document.id,
    ).toBe(document.id);
  });

  it("falls back to a named page data script and rejects HTML without one", () => {
    expect(
      htmlArtifactSource(
        '<script id="showai-reader-data" type="application/json">{"a":1}</script>',
      ),
    ).toBe('{"a":1}');
    expect(() =>
      importedArtifact({ name: "plain.html", content: "<p>hello</p>" }),
    ).toThrow();
  });
});

describe("template prompt for an agent", () => {
  const template = {
    id: "paper-explainer",
    name: "论文讲解",
    scope: "global" as const,
    version: "2.1.1",
    integrity: "sha256-abc",
  };
  it("names the template and the exact template_context selection", () => {
    const prompt = templateAgentPrompt(template);
    expect(prompt).toContain("论文讲解");
    expect(prompt).toContain("template_context");
    expect(prompt).toContain(JSON.stringify(templateSelection(template)));
    expect(templateSelection(template)).toEqual({
      id: "paper-explainer",
      scope: "global",
      version: "2.1.1",
      integrity: "sha256-abc",
    });
  });
});

describe("appearance preference", () => {
  it("follows the system unless light or dark was chosen", () => {
    expect(readAppearancePreference(null)).toBe("system");
    expect(readAppearancePreference("system")).toBe("system");
    expect(readAppearancePreference("bogus")).toBe("system");
    expect(readAppearancePreference("dark")).toBe("dark");
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("light", true)).toBe("light");
  });
});

describe("manual component editing", () => {
  it("separates components with a settings form from those an agent changes", () => {
    for (const kind of ["chart", "database", "g2-bar", "mindmap", "pdf"])
      expect(supportsManualEditing(kind), kind).toBe(true);
    for (const kind of ["custom", "roadmap", "comparison-matrix", "scene-3d"])
      expect(supportsManualEditing(kind), kind).toBe(false);
  });
});

describe("export reveal", () => {
  it("reveals only paths this process exported", () => {
    const path = `/tmp/showai-export-${crypto.randomUUID()}.html`;
    expect(revealableExport(path)).toBe(false);
    expect(rememberExport({ path, format: "html" })).toEqual({
      path,
      format: "html",
    });
    expect(revealableExport(path)).toBe(true);
    expect(rememberExport(null)).toBeNull();
  });
});
