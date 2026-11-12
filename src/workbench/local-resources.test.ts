import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../agent/service";
import { openLibrary } from "../core/open-library";
import { createWorkbench, type OpenDialogOptions } from "./actions";
import { localFileRef } from "../document/local-files.mjs";
import type { DesktopInfo } from "../desktop/bridge";

let home: string;
let files: string;
let chosen: string[];
let dialogs: OpenDialogOptions[];
let hostCalls: { action: string; args: Record<string, unknown> }[];
let invoke: (action: string, args?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-resource-actions-"));
  files = await mkdtemp(join(tmpdir(), "showai-resource-files-"));
  await openLibrary(home);
  chosen = [];
  dialogs = [];
  hostCalls = [];
  const service = new AgentService({ root: home });
  // The host answers the file dialog with the paths the person picked.
  const workbench = createWorkbench(service.store, service, {
    info: () => ({ home, mode: "desktop" }) as unknown as DesktopInfo,
    openDialog: async (options) => {
      dialogs.push(options);
      return { canceled: !chosen.length, filePaths: chosen };
    },
    saveDialog: async () => ({ canceled: true }),
    invoke: async (action, args) => {
      hostCalls.push({ action, args });
      return null;
    },
  });
  invoke = (action, args = {}) => workbench(action, args);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(files, { recursive: true, force: true });
});

describe("linked resource actions", () => {
  it("grant a linked file of the field's kind with a stable address", async () => {
    const path = join(files, "图 1.png");
    await writeFile(path, "png");
    const ref = localFileRef(path);
    const grant = await invoke("media:resolve", { ref, kind: "image" });
    expect(grant).toMatchObject({ name: "图 1.png", kind: "image", size: 3 });
    // The renderer receives an address, never the device path.
    expect(grant.path).toBeUndefined();
    expect((await invoke("media:resolve", { ref, kind: "image" })).token).toBe(
      grant.token,
    );
    await expect(
      invoke("media:resolve", { ref, kind: "video" }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    await expect(
      invoke("media:resolve", { ref: path, kind: "image" }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    await rm(path);
    await expect(
      invoke("media:resolve", { ref, kind: "image" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      invoke("media:resolve", { ref: "file:gone.png", kind: "image" }),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
  });

  it("link chosen files as references and show where a moved file was", async () => {
    const first = join(files, "a b.mp4");
    const second = join(files, "c.mp4");
    await writeFile(first, "1");
    await writeFile(second, "22");
    expect(await invoke("media:chooseFile", { kind: "video" })).toBeNull();
    chosen = [first, second];
    const result = await invoke("media:chooseFile", {
      kind: "video",
      multiple: true,
    });
    expect(result.files).toEqual([
      { ref: localFileRef(first), name: "a b.mp4", size: 1 },
      { ref: localFileRef(second), name: "c.mp4", size: 2 },
    ]);
    expect(dialogs.at(-1)?.properties).toEqual(["openFile", "multiSelections"]);
    expect(dialogs.at(-1)?.filters?.[0].extensions).toContain("mov");
    chosen = [join(files, "a b.mp4")];
    await expect(
      invoke("media:chooseFile", { kind: "audio" }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });

    const nested = join(files, "moved", "clip.mp4");
    await mkdir(join(files, "moved"));
    await invoke("media:reveal", { ref: localFileRef(nested) });
    expect(hostCalls.at(-1)).toEqual({
      action: "media:reveal",
      args: { path: join(files, "moved") },
    });
    await invoke("media:reveal", { ref: localFileRef(first) });
    expect(hostCalls.at(-1)?.args).toEqual({ path: first });
  });
});
