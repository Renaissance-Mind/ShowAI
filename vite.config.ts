import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { target: "es2022" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    css: { include: [/\.css(?:\?raw)?$/] },
  },
} as Parameters<typeof defineConfig>[0]);
