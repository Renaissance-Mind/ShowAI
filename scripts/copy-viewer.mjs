import { mkdir, copyFile } from "node:fs/promises";
await mkdir("public", { recursive: true });
await copyFile("dist-portable/portable.html", "public/portable.html");
