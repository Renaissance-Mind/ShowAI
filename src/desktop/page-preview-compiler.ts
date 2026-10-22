import { createRequire } from "node:module";
import { workerData } from "node:worker_threads";
import type { BuildOptions, BuildResult } from "esbuild";

// The worker has no Electron app API; its parent supplies the packaged runtime's
// module location so the compiler can find its native binary outside app.asar.
const compiler = createRequire(workerData.compilerEntry)(
  "esbuild",
) as typeof import("esbuild");
export const version = compiler.version;
export function build<T extends BuildOptions>(
  options: T & { [Key in Exclude<keyof T, keyof BuildOptions>]: never },
): Promise<BuildResult<T>> {
  return compiler.build(options);
}
