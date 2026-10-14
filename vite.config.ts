import { buildIdentityPlugin } from "./scripts/build-info.mjs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react(), buildIdentityPlugin()],
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
    css: { include: [/\.css(?:\?raw)?$/] },
  },
} as Parameters<typeof defineConfig>[0]);
