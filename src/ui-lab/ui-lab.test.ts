import { afterAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { remoteConnectionFixture } from "./fixtures/remote-connection";
import { uiFeatures, uiScene } from "./registry";
import { comparePng, runUiScenes } from "./runner";
import type { RemoteMcpConfig } from "../remote-mcp/types";
import { redactTrace } from "./trace";

const directory = await mkdtemp(join(tmpdir(), "showai-ui-lab-unit-"));
afterAll(() => rm(directory, { recursive: true, force: true }));
const config: RemoteMcpConfig = {
  provider: "lan",
  publicUrl: "",
  port: 0,
  executable: "",
  bindAddress: "192.168.50.20",
  access: "all",
  projects: [],
};
const projects = [{ id: "project-one", name: "One" }];

test("trace records redact credentials and bound large application payloads", () => {
  const input = {
    name: "visible name",
    token: "hidden-value",
    nested: { password: "hidden-password" },
    artifact: "x".repeat(100000),
    rows: Array.from({ length: 1000 }, (_, id) => ({ id })),
  };
  const output = redactTrace(input) as Record<string, unknown>;
  expect(output.name).toBe(input.name);
  expect(output.token).toBe("[redacted]");
  expect(output.nested).toEqual({ password: "[redacted]" });
  expect(output.artifact).toMatchObject({
    omitted: true,
    bytes: 100000,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(output).length).toBeLessThan(1000);
  expect(input.artifact.length).toBe(100000);
});

test("every registered scene has stable unique checkpoints in both locales", () => {
  for (const locale of ["zh-CN", "en"] as const) {
    const features = uiFeatures(locale);
    expect(new Set(features.map((feature) => feature.id)).size).toBe(
      features.length,
    );
    for (const feature of features) {
      expect(new Set(feature.scenes.map((scene) => scene.id)).size).toBe(
        feature.scenes.length,
      );
      for (const scene of feature.scenes) {
        expect(scene.steps.length).toBeGreaterThan(0);
        expect(new Set(scene.steps.map((step) => step.id)).size).toBe(
          scene.steps.length,
        );
      }
    }
  }
  expect(uiScene("workbench", "create-project").fixture).toBe("none");
  expect(() => uiScene("unknown", "overview")).toThrow("Unknown UI scene");
});

test("LAN keys require a running service, register a client, and revoke its access", async () => {
  const fixture = remoteConnectionFixture(projects, false);
  await expect(
    fixture.invoke("remoteMcp:createAccessKey", { name: "Tablet" }),
  ).rejects.toThrow("Start a LAN");
  await fixture.invoke("remoteMcp:start", { config });
  expect(fixture.inspect().phase).toBe("starting");
  await fixture.event("service.ready", {});
  expect(fixture.inspect().url).toBe("http://192.168.50.20:8789/mcp");
  const key = (await fixture.invoke("remoteMcp:createAccessKey", {
    name: "Tablet",
  })) as { id: string };
  await fixture.event("client.call", {});
  expect(fixture.inspect().lastCallClientId).toBe(key.id);
  await fixture.invoke("remoteMcp:revoke", { id: key.id });
  await expect(fixture.event("client.call", {})).rejects.toThrow(
    "no authorization",
  );
  fixture.close();
});

test("OAuth denial does not grant access and approval preserves selected projects", async () => {
  const fixture = remoteConnectionFixture(projects, false);
  await fixture.invoke("remoteMcp:start", {
    config: {
      ...config,
      provider: "tailscale-private",
      access: "selected",
      projects: [{ id: "project-one", write: false }],
    },
  });
  await fixture.event("service.ready", {});
  expect(fixture.inspect().url).toContain(":8443/mcp");
  await fixture.event("authorization.request", {});
  const id = () => (fixture.inspect().requests as Array<{ id: string }>)[0].id;
  await fixture.invoke("remoteMcp:decide", { id: id(), decision: "deny" });
  expect(fixture.inspect().clients).toEqual([]);
  await expect(fixture.event("client.call", {})).rejects.toThrow();
  await fixture.event("authorization.request", {});
  await fixture.invoke("remoteMcp:decide", { id: id(), decision: "allow" });
  expect(fixture.inspect().clients).toMatchObject([
    { projectIds: ["project-one"] },
  ]);
  fixture.close();
});

test("invalid configuration is rejected by the application validator and failure can recover", async () => {
  const fixture = remoteConnectionFixture(projects, false);
  await expect(
    fixture.invoke("remoteMcp:start", {
      config: { ...config, provider: "invalid" },
    }),
  ).rejects.toThrow();
  await expect(
    fixture.invoke("remoteMcp:start", {
      config: { ...config, bindAddress: "192.168.1.99" },
    }),
  ).rejects.toThrow("available LAN");
  await fixture.invoke("remoteMcp:start", { config });
  await fixture.event("service.error", {});
  expect(fixture.inspect().phase).toBe("error");
  await fixture.invoke("remoteMcp:start", { config });
  await fixture.event("service.ready", {});
  expect(fixture.inspect().phase).toBe("running");
  await fixture.invoke("remoteMcp:stop", {});
  await expect(fixture.event("service.ready", {})).rejects.toThrow(
    "Start the service",
  );
  fixture.close();
});

test("image comparison distinguishes missing, approved, changed and resized screenshots", async () => {
  const { PNG } = createRequire(import.meta.url)("pngjs");
  const png = (size = 20, value = 255) => {
    const image = new PNG({ width: size, height: size });
    image.data.fill(value);
    return PNG.sync.write(image);
  };
  const baseline = join(directory, "base.png"),
    diff = join(directory, "diff.png");
  expect((await comparePng(png(), baseline, diff)).state).toBe("missing");
  expect((await comparePng(png(), baseline, diff, true)).state).toBe("updated");
  expect((await comparePng(png(), baseline, diff)).state).toBe("passed");
  const black = new PNG({ width: 20, height: 20 });
  for (let i = 0; i < black.data.length; i += 4) black.data[i + 3] = 255;
  expect((await comparePng(PNG.sync.write(black), baseline, diff)).state).toBe(
    "changed",
  );
  expect((await readFile(diff)).length).toBeGreaterThan(0);
  expect((await comparePng(png(10), baseline, diff)).state).toBe(
    "size-changed",
  );
  await writeFile(baseline, "invalid image");
  await expect(comparePng(png(), baseline, diff)).rejects.toThrow();
});

test("invalid capture dimensions fail before launching a renderer", async () => {
  for (const width of [NaN, 0, 5000])
    await expect(
      runUiScenes({
        origin: "http://127.0.0.1:1",
        repository: process.cwd(),
        output: directory,
        width,
      }),
    ).rejects.toThrow("dimensions");
});
