import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "./icons";

describe("application icon registry", () => {
  it("covers every application icon import and prevents bypassing the viewer", () => {
    const root = resolve(import.meta.dirname, "..");
    for (const file of readdirSync(root, { recursive: true }).filter(
      (file) => typeof file === "string" && file.endsWith(".tsx"),
    )) {
      const source = readFileSync(resolve(root, String(file)), "utf8");
      const imports = source.matchAll(
        /import\s+(?:\{([^}]+)\}|\*\s+as\s+\w+)\s+from\s+["']([^"']+)["']/g,
      );
      for (const [, names, path] of imports) {
        expect(path, `${file} must use the shared registry`).not.toBe(
          "lucide-react",
        );
        if (!path.endsWith("ui/icons") || !names) continue;
        for (const binding of names
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)) {
          expect(icons, `${file}: ${binding}`).toHaveProperty(
            binding.split(/\s+as\s+/)[0],
          );
        }
      }
    }
  });

  it("renders every viewer entry as an SVG", () => {
    for (const [name, Icon] of Object.entries(icons)) {
      expect(
        renderToStaticMarkup(createElement(Icon, { size: 24 })),
        name,
      ).toContain("<svg");
    }
  });
});
