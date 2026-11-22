import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CoreError } from "../core/model";
import { workbenchChunkBytes, type WorkbenchBundle } from "../host/codex-workbench-transport";

export function workbenchAssets(directory: string, host: "codex" | "qoder" = "codex") {
  let manifest: Promise<WorkbenchBundle> | undefined;
  const bundle = () => manifest ??= readFile(join(directory, "index.json"), "utf8")
    .then((json) => {
      const value = JSON.parse(json) as WorkbenchBundle;
      if (host === "qoder") {
        if (!value.qoder) throw new CoreError("NOT_FOUND", "The Qoder workbench bundle is missing.");
        return { ...value, ...value.qoder };
      }
      return value;
    });
  return {
    bundle,
    async asset(name: string, offset: number) {
      const { assets } = await bundle();
      const item = Object.hasOwn(assets, name) ? assets[name] : undefined;
      if (!item || !/^[0-9a-f]{64}$/.test(item.sha256) || offset >= item.bytes)
        throw new CoreError("NOT_FOUND", "The workbench asset chunk does not exist.");
      const file = await open(join(directory, item.sha256 + ".gz"), "r");
      try {
        const data = Buffer.alloc(Math.min(workbenchChunkBytes, item.bytes - offset));
        const { bytesRead } = await file.read(data, { position: offset });
        if (bytesRead !== data.length)
          throw new CoreError("INVALID_DATA", "The workbench asset is incomplete.");
        return data.toString("base64");
      } finally {
        await file.close();
      }
    },
  };
}
