import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { withLibraryLock } from "../core/library-lock";
import { writeGeneratedCache } from "../core/generated-cache";
import { writePresentation } from "./presentation";

export async function writeCachedPresentation(
  root: string,
  value: Parameters<typeof writePresentation>[0],
  directory?: string,
) {
  if (directory)
    return writePresentation(value, join(directory, randomUUID(), "page.html"));
  return withLibraryLock(
    root,
    async () => {
      async function output(name: string, contents: string) {
        const key = createHash("sha256").update(contents).digest("hex");
        return writeGeneratedCache(
          root,
          join(root, "local", "agent-previews", key, name),
          contents,
        );
      }
      const html = await output("page.html", value.html);
      const source = await output("page.showai.json", value.source);
      const fragments: Partial<
        Record<"inline" | "online" | "compact", string>
      > = {};
      for (const name of ["inline", "online", "compact"] as const)
        if (value[name])
          fragments[name] = await output(`page.${name}.html`, value[name]);
      return {
        delivery: { html, source, ...fragments },
      };
    },
    "generated-cache",
  );
}
