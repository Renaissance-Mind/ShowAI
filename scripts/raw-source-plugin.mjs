import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export const rawSourcePlugin = {
  name: "showai-embedded-source",
  setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -4)),
      namespace: "showai-embedded-source",
    }));
    builder.onLoad(
      { filter: /.*/, namespace: "showai-embedded-source" },
      async (args) => ({
        contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))}`,
        loader: "js",
      }),
    );
  },
};
