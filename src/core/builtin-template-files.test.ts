import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseTemplateBundle } from "../portable/template-bundle.mjs";
import { builtinTemplateBundles } from "./builtin-template-bundles";
import templateMessages from "../i18n/messages/templates";

// A built-in template is a folder in resources/templates that only ships once
// each file is imported by builtin-template-bundles.ts and allowed by .gitignore
// (Markdown is ignored by default). docs/contributing-templates.md lists these steps.
const root = "resources/templates";

// Forward slashes keep paths comparable with the imports on Windows too.
async function folderFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? folderFiles(`${directory}/${entry.name}`)
        : [`${directory}/${entry.name}`],
    ),
  );
  return files.flat();
}

describe("built-in template folders", async () => {
  const files = (await folderFiles(root)).filter(
    (path) => !path.endsWith(".gitkeep"),
  );
  const ids = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("imports every template file in builtin-template-bundles.ts", async () => {
    const source = await readFile(
      "src/core/builtin-template-bundles.ts",
      "utf8",
    );
    expect(files.filter((path) => !source.includes(`/${path}?raw`))).toEqual(
      [],
    );
  });

  it("bundles every folder under the folder's own id", () => {
    const bundled = builtinTemplateBundles.map(
      (bundle) => parseTemplateBundle(bundle).metadata.id,
    );
    expect(bundled.sort()).toEqual([...ids].sort());
  });

  it("keeps every template file out of .gitignore", () => {
    const ignored = files.filter((path) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", path]);
        return true;
      } catch (error) {
        // Exit status 1 means "not ignored"; anything else is a real failure.
        if ((error as { status?: number }).status === 1) return false;
        throw error;
      }
    });
    expect(ignored).toEqual([]);
  });

  it("labels every template in the Studio template navigation", () => {
    for (const catalog of Object.values(templateMessages.catalogs))
      expect(
        ids.filter(
          (id) => !(`type.${id}` in (catalog as Record<string, unknown>)),
        ),
      ).toEqual([]);
  });
});
