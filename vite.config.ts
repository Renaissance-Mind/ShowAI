import { buildIdentityPlugin } from "./scripts/build-info.mjs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The workbench reads built-in component metadata only to list and insert
 * components; examples and parameter documentation reach its catalog views
 * from the library host. Leaving them out of the renderer saves about 1 MB of
 * JSON parsed at startup. Agent, CLI and reader builds keep their own data.
 */
function workbenchCatalogPlugin(): Plugin {
  const entries =
    /[\\/]resources[\\/]catalog[\\/](?:g2|components|primitives|surfaces|diagrams)\.json$/;
  const documentation =
    /[\\/]resources[\\/]catalog[\\/](?:component|diagram)-documentation\.json$/;
  return {
    name: "showai-workbench-catalog",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (entries.test(id))
        return JSON.stringify(
          (JSON.parse(code) as Record<string, unknown>[]).map(
            ({ examples: _examples, ...item }) => item,
          ),
        );
      if (documentation.test(id)) return "{}";
    },
    buildEnd() {
      // The Agent catalog returns examples and documentation; it must never be
      // bundled into a renderer that has dropped them.
      for (const id of this.getModuleIds())
        if (/[\\/]src[\\/]core[\\/]catalog\.ts$/.test(id))
          this.error(
            "src/core/catalog.ts reached the workbench renderer, which omits component examples and documentation.",
          );
    },
  };
}

export default defineConfig({
  plugins: [react(), buildIdentityPlugin(), workbenchCatalogPlugin()],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { target: "es2022" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests assert the Chinese UI unless they choose a language themselves.
    // Previews use the bundled reader unless a test opts into the CDN reader,
    // so the suite never depends on a public CDN.
    env: { SHOWAI_LANGUAGE: "zh-CN", SHOWAI_READER_CDN: "off" },
    globalSetup: ["./scripts/vitest-temp.mjs"],
    css: { include: [/\.css(?:\?raw)?$/] },
  },
} as Parameters<typeof defineConfig>[0]);
