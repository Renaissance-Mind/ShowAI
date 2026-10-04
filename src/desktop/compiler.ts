import { app } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { BuildOptions, BuildResult } from "esbuild";

/** Load the compiler beside its native binary after the desktop runtime is ready. */
export function build<T extends BuildOptions>(
  options: T & { [Key in Exclude<keyof T, keyof BuildOptions>]: never },
): Promise<BuildResult<T>> {
  const entry = app.isPackaged
    ? join(process.resourcesPath, "runtime", "scripts", "cli.mjs")
    : import.meta.url;
  const compiler = createRequire(entry)("esbuild") as typeof import("esbuild");
  return compiler.build(options);
}
