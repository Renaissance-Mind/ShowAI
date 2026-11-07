import { expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RemoteMcpManager } from "./manager";
test("App shutdown preserves enabled state, explicit disconnect disables restoration", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-remote-resume-"));
  const options = {
    directory: join(root, "profile"),
    home: () => join(root, "library"),
    encrypt: (s: string) => s,
    decrypt: (s: string) => s,
  };
  const first = new RemoteMcpManager(options),
    second = new RemoteMcpManager(options),
    third = new RemoteMcpManager(options);
  try {
    await first.start({
      provider: "cloudflare-quick",
      port: 0,
      publicUrl: "",
      projects: [],
      access: "all",
      executable: join(root, "missing-connector"),
    });
    await first.suspend();
    expect(
      JSON.parse(await readFile(join(root, "profile", "config.json"), "utf8"))
        .resumeOnLaunch,
    ).toBe(true);
    expect((await second.status()).resumeOnLaunch).toBe(true);
    expect((await second.restore()).phase).toBe("starting");
    await second.stop();
    expect((await third.restore()).phase).toBe("stopped");
    expect((await third.status()).resumeOnLaunch).toBe(false);
  } finally {
    await first.suspend();
    await second.suspend();
    await third.suspend();
    await rm(root, { recursive: true, force: true });
  }
});
