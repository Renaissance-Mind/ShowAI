import { mkdir, copyFile } from "node:fs/promises";
import { buildReaderSource } from "./build-reader-source.mjs";
await buildReaderSource(process.cwd(), "dist-portable/reader-source.json");
await mkdir("public", { recursive: true });
await copyFile("dist-portable/portable.html", "public/portable.html");
