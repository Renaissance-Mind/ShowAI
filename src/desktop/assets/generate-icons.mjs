import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

if (process.platform !== "darwin")
  throw new Error(
    "Regenerate icons on macOS using the native AppKit renderer.",
  );
const directory = dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "showai-icon-"));
const iconset = join(temporary, "icon.iconset");
const run = promisify(execFile);
try {
  await mkdir(iconset);
  await run("swift", [
    join(directory, "create-icon.swift"),
    join(directory, "icon.png"),
  ]);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2])
      await run("sips", [
        "-z",
        String(size * scale),
        String(size * scale),
        join(directory, "icon.png"),
        "--out",
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
      ]);
  }
  await run("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    join(directory, "icon.icns"),
  ]);
  console.log(
    "Generated ShowAI icon.png and icon.icns from native vector geometry.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
