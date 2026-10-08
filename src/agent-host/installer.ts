import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, writeFile, chmod, rename, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { execute } from "./process";
import { readOptional, writeProtected } from "./storage";
import type { RuntimeStatus } from "./types";

interface PackageMetadata {
  version: string;
  dist: { tarball: string; integrity: string };
  dependencies?: Record<string, string>;
}
export async function npmMetadata(name: string, version: string) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error(`Cannot retrieve ${name}: HTTP ${response.status}`);
  return (await response.json()) as PackageMetadata;
}
export function verifyArchive(bytes: Buffer, integrity: string) {
  const [algorithm, encoded] = integrity.split("-");
  if (algorithm !== "sha512" || !encoded)
    throw new Error("Missing npm SHA-512 integrity.");
  const expected = Buffer.from(encoded, "base64"),
    actual = createHash("sha512").update(bytes).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error(
      "Downloaded package integrity does not match the registry.",
    );
}
/** Extract npm archives without lifecycle scripts, shell interpolation, links or path traversal. */
export async function extractPackage(archive: Buffer, root: string) {
  const tar = gunzipSync(archive, { maxOutputLength: 400 * 1024 * 1024 });
  let pax: Record<string, string> = {};
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, end: number) =>
      header.subarray(start, end).toString().replace(/\0.*$/s, "");
    const size = parseInt(field(124, 136).trim() || "0", 8);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length
    )
      throw new Error("Invalid tar entry size.");
    const contents = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = field(156, 157);
    if (type === "x" || type === "g") {
      for (let position = 0; position < contents.length;) {
        const space = contents.indexOf(32, position),
          length = Number(contents.subarray(position, space).toString());
        if (
          space < position ||
          !Number.isSafeInteger(length) ||
          length <= 0 ||
          position + length > contents.length
        )
          throw new Error("Invalid PAX entry.");
        const entry = contents
            .subarray(space + 1, position + length - 1)
            .toString(),
          equal = entry.indexOf("=");
        pax[entry.slice(0, equal)] = entry.slice(equal + 1);
        position += length;
      }
      continue;
    }
    const prefix = field(345, 500),
      name = pax.path ?? (prefix ? prefix + "/" : "") + field(0, 100);
    pax = {};
    if (
      !name.startsWith("package/") ||
      name.includes("\\") ||
      name.includes("\0")
    )
      throw new Error("Unsafe package entry.");
    const destination = resolve(root, name.slice(8));
    if (
      destination !== resolve(root) &&
      !destination.startsWith(resolve(root) + sep)
    )
      throw new Error("Package path escapes installation directory.");
    if (type === "5") await mkdir(destination, { recursive: true });
    else if (type === "0" || type === "") {
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, contents, {
        mode: parseInt(field(100, 108).trim() || "644", 8) & 0o777,
      });
    } else throw new Error(`Unsupported package entry type ${type}.`);
  }
}
async function download(metadata: PackageMetadata, root: string) {
  const url = new URL(metadata.dist.tarball);
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org")
    throw new Error("Unexpected package download origin.");
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok)
    throw new Error(`Package download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyArchive(bytes, metadata.dist.integrity);
  await extractPackage(bytes, root);
}
export function targetTriple(
  platform = process.platform,
  arch = process.arch,
): string {
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-arm64": "aarch64-unknown-linux-musl",
    "linux-x64": "x86_64-unknown-linux-musl",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const triple = triples[`${platform}-${arch}`];
  if (!triple)
    throw new Error(`Unsupported Codex platform: ${platform}/${arch}`);
  return triple;
}
export class SdkInstaller {
  state: RuntimeStatus;
  private active?: Promise<void>;
  constructor(readonly root: string) {
    this.state = { state: "absent", progress: "尚未安装", root };
  }
  async status() {
    if (this.state.state === "installing" || this.state.state === "failed")
      return this.state;
    const receipt = await readOptional<{ version: string; directory: string }>(
      join(this.root, "installed.json"),
    );
    if (receipt) {
      await stat(this.binary(receipt.directory));
      this.state = {
        state: "ready",
        progress: "Codex SDK 已安装",
        root: this.root,
        version: receipt.version,
      };
    }
    return this.state;
  }
  binary(directory: string) {
    return join(
      directory,
      "native",
      "vendor",
      targetTriple(),
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    );
  }
  async paths() {
    const receipt = await readOptional<{ version: string; directory: string }>(
      join(this.root, "installed.json"),
    );
    if (!receipt) throw new Error("请先在设置中安装 Codex SDK。");
    return {
      binary: this.binary(receipt.directory),
      sdk: join(receipt.directory, "sdk/dist/index.js"),
      version: receipt.version,
    };
  }
  start() {
    if (this.active) return;
    this.state = {
      state: "installing",
      progress: "正在获取官方安装包…",
      root: this.root,
    };
    this.active = this.install()
      .catch((error: Error) => {
        this.state = {
          state: "failed",
          progress: "安装失败",
          error: error.message,
          root: this.root,
        };
      })
      .finally(() => {
        this.active = undefined;
      });
  }
  async wait() {
    await this.active;
    if (this.state.state === "failed") throw new Error(this.state.error);
  }
  private async install() {
    const sdk = await npmMetadata("@openai/codex-sdk", "latest");
    const version = sdk.dependencies?.["@openai/codex"];
    if (!version || !/^\d+\.\d+\.\d+$/.test(version) || version !== sdk.version)
      throw new Error(
        "SDK runtime dependency must be a matching stable version.",
      );
    const native = await npmMetadata(
      "@openai/codex",
      `${version}-${process.platform}-${process.arch}`,
    );
    const previous = await readOptional<{
      version: string;
      directory: string;
      sdkIntegrity: string;
      runtimeIntegrity: string;
    }>(join(this.root, "installed.json"));
    if (
      previous?.version === version &&
      previous.sdkIntegrity === sdk.dist.integrity &&
      previous.runtimeIntegrity === native.dist.integrity
    ) {
      const intact = await Promise.all([
        stat(this.binary(previous.directory)),
        stat(join(previous.directory, "sdk/dist/index.js")),
      ]).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (intact) {
        this.state = {
          state: "ready",
          progress: "Codex SDK 已是当前版本",
          version,
          root: this.root,
        };
        return;
      }
    }
    const staging = join(this.root, ".install-" + randomUUID());
    await mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      this.state.progress = `正在下载 Codex SDK ${version} 与独立运行时…`;
      await Promise.all([
        download(sdk, join(staging, "sdk")),
        download(native, join(staging, "native")),
      ]);
      await chmod(this.binary(staging), 0o755);
      this.state.progress = "正在验证安装…";
      const test = await execute(this.binary(staging), ["--version"], {
        timeout: 10000,
      });
      if (test.code !== 0 || !test.stdout.includes(version))
        throw new Error("Installed Codex version verification failed.");
      const destination = join(
        this.root,
        "releases",
        version + "-" + randomUUID(),
      );
      await mkdir(join(this.root, "releases"), { recursive: true });
      await rename(staging, destination);
      await writeProtected(join(this.root, "installed.json"), {
        version,
        directory: destination,
        sdkIntegrity: sdk.dist.integrity,
        runtimeIntegrity: native.dist.integrity,
        installedAt: new Date().toISOString(),
      });
      this.state = {
        state: "ready",
        progress: "Codex SDK 已安装",
        version,
        root: this.root,
      };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
