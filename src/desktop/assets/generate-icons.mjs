import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { iconSvg } from "./icon-design.mjs";
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
const run = promisify(execFile);
try {
  for (const [name, mode] of [
    ["icon", "dark"],
    ["icon-light", "light"],
  ]) {
    const iconset = join(temporary, `${name}.iconset`);
    const png = join(directory, `${name}.png`);
    await writeFile(join(directory, `${name}.svg`), iconSvg(mode));
    await writeFile(
      join(directory, `${name}-unmasked.svg`),
      iconSvg(mode, { masked: false }),
    );
    await mkdir(iconset);
    await run("swift", [join(directory, "create-icon.swift"), png, mode]);
    await run("swift", [
      join(directory, "create-icon.swift"),
      join(directory, `${name}-unmasked.png`),
      mode,
      "unmasked",
    ]);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2])
        await run("sips", [
          "-z",
          String(size * scale),
          String(size * scale),
          png,
          "--out",
          join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        ]);
    }
    await run("iconutil", [
      "-c",
      "icns",
      iconset,
      "-o",
      join(directory, `${name}.icns`),
    ]);
  }
  console.log(
    "Generated ShowAI masked display assets and full-square SVG/PNG masters for both appearances.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
