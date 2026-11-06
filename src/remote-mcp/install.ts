import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../agent-host/process";

/** Install one verified vendor binary inside this App profile; never modify system tools. */
export async function installCloudflared(directory: string): Promise<string> {
  const system = { darwin: "darwin", linux: "linux", win32: "windows" }[
    process.platform as "darwin" | "linux" | "win32"
  ];
  const arch = { arm64: "arm64", x64: "amd64" }[
    process.arch as "arm64" | "x64"
  ];
  if (!system || !arch)
    throw new Error(
      "Install cloudflared for this platform manually and choose its executable.",
    );
  const name = `cloudflared-${system}-${arch}${system === "darwin" ? ".tgz" : system === "windows" ? ".exe" : ""}`;
  const response = await fetch(
    "https://api.github.com/repos/cloudflare/cloudflared/releases/latest",
    {
      signal: AbortSignal.timeout(20000),
      headers: { accept: "application/vnd.github+json" },
    },
  );
  if (!response.ok)
    throw new Error(
      `Cannot read Cloudflare release metadata (${response.status}). Use the manual installation guide.`,
    );
  const release = (await response.json()) as {
    tag_name: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
      digest?: string;
      size: number;
    }>;
  };
  if (!/^[a-zA-Z0-9._-]+$/.test(release.tag_name))
    throw new Error("Invalid Cloudflare release version.");
  const asset = release.assets.find((a) => a.name === name);
  if (
    !asset ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") ||
    asset.size > 100 * 1024 * 1024
  )
    throw new Error(
      "This release has no verifiable binary for your platform. Use the manual installation guide.",
    );
  const expectedUrl = `https://github.com/cloudflare/cloudflared/releases/download/${release.tag_name}/${name}`;
  if (asset.browser_download_url !== expectedUrl)
    throw new Error("Unexpected Cloudflare release download URL.");
  const download = await fetch(expectedUrl, {
    signal: AbortSignal.timeout(90000),
  });
  if (!download.ok)
    throw new Error(`Cloudflared download failed (${download.status}).`);
  const bytes = Buffer.from(await download.arrayBuffer());
  if (
    bytes.length !== asset.size ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
      asset.digest
  )
    throw new Error(
      "Cloudflared checksum verification failed. The download was not installed.",
    );
  const staging = join(directory, `install-${randomUUID()}`);
  const installed = join(
    directory,
    `cloudflared-${release.tag_name}-${randomUUID()}`,
  );
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const binary = system === "windows" ? "cloudflared.exe" : "cloudflared";
  try {
    if (system === "darwin") {
      const archive = join(staging, "download.tgz");
      await writeFile(archive, bytes, { mode: 0o600 });
      const extracted = await execute(
        "/usr/bin/tar",
        ["-xzf", archive, "-C", staging, "cloudflared"],
        { timeout: 15000 },
      );
      if (extracted.code !== 0)
        throw new Error(extracted.stderr || "Cannot extract cloudflared.");
      await rm(archive);
    } else await writeFile(join(staging, binary), bytes, { mode: 0o700 });
    await chmod(join(staging, binary), 0o700);
    const verified = await execute(join(staging, binary), ["--version"], {
      timeout: 10000,
    });
    if (verified.code !== 0 || !verified.stdout.includes(release.tag_name))
      throw new Error("The downloaded cloudflared failed its version check.");
    await rename(staging, installed);
    return join(installed, binary);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
