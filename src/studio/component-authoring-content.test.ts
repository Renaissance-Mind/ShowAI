import { expect, test } from "vitest";
import { diagramAuthoringFiles } from "../core/diagram-authoring-files";
import {
  componentAuthoringIndex,
  componentAuthoringGuide,
} from "../components/custom/authoring";
import { validateRichTextData } from "../components/rich-text/model.mjs";
import { componentAuthoringContent } from "./component-authoring-content";

test("every full upstream authoring guide displays as valid native text with resolved links", () => {
  for (const family of [
    "archify",
    "diagram-design",
    "fireworks-tech-graph",
  ] as const) {
    const files = diagramAuthoringFiles(family),
      index = componentAuthoringIndex(files, "authoring/index.json");
    for (const ref of index.guides) {
      const guide = componentAuthoringGuide(files, index, ref.id);
      const content = componentAuthoringContent(guide.markdown, guide.url);
      expect(
        () => validateRichTextData({ format: "richtext", content }),
        `${family}/${ref.id}`,
      ).not.toThrow();
      expect(JSON.stringify(content)).not.toContain('"type":"widget"');
    }
  }
});
test("local instructions preserve their text when they have no upstream link origin", () => {
  const content = componentAuthoringContent(
    "Read [local input](input.json).\n\n[unsafe](javascript:alert)",
  );
  expect(() =>
    validateRichTextData({ format: "richtext", content }),
  ).not.toThrow();
  expect(JSON.stringify(content)).toContain("local input");
  expect(JSON.stringify(content)).not.toContain("javascript:");
});
test("guide metadata shows as a code block, not as the first paragraph", () => {
  const content = componentAuthoringContent(
    "---\nname: archify\ndescription: Create diagrams\n---\n\n# Archify\n\nBody text.",
  );
  expect(() =>
    validateRichTextData({ format: "richtext", content }),
  ).not.toThrow();
  expect(content.content?.[0]?.type).toBe("codeBlock");
  expect(JSON.stringify(content.content?.[0])).toContain("name: archify");
  expect(content.content?.[1]?.type).toBe("heading");
});
