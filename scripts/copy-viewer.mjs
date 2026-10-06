import { mkdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
await promisify(execFile)(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "vite.portable.config.ts",
    "--mode",
    "inline-core",
    "--outDir",
    "dist-portable/inline-core",
  ],
  { env: { ...process.env, NODE_ENV: "production" } },
);
await mkdir("public", { recursive: true });
await copyFile("dist-portable/portable.html", "public/portable.html");
