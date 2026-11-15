import { buildIdentityPlugin } from "./scripts/build-info.mjs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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
    env: { SHOWAI_LANGUAGE: "zh-CN", SHOWAI_READER_CDN: "off" },
    globalSetup: ["./scripts/vitest-temp.mjs"],
    css: { include: [/\.css(?:\?raw)?$/] },
  },
} as Parameters<typeof defineConfig>[0]);
