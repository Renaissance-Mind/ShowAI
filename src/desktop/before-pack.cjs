const { readFile, access } = require("node:fs/promises");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { Arch } = require("builder-util");

module.exports = async function beforePack(context) {
  const target = context.electronPlatformName;
  const architecture = Arch[context.arch];
  if (target !== process.platform || architecture !== process.arch) {
    throw new Error(
      `Build ShowAI on the target OS and architecture (${target}/${architecture}). Component compiler binaries are native; this host is ${process.platform}/${process.arch}.`,
    );
  }
  const root = context.packager.projectDir;
  const metadata = JSON.parse(
    await readFile(join(root, "dist-runtime/assets/build.json"), "utf8"),
  );
  if (
    metadata.platform !== target ||
    metadata.architecture !== architecture ||
    metadata.version !== context.packager.appInfo.version
  ) {
    throw new Error(
      "Runtime does not match this application version/platform. Run npm run build on the target machine before packaging.",
    );
  }
  const desktop = JSON.parse(
    await readFile(join(root, "dist-desktop/build-info.json"), "utf8"),
  );
  if (
    metadata.pageModelVersion !== 3 ||
    desktop.pageModelVersion !== 3 ||
    metadata.sourceCommit !== desktop.sourceCommit ||
    metadata.sourceCommit === "unknown" ||
    metadata.sourceDirty === true ||
    desktop.sourceDirty === true ||
    JSON.stringify(metadata.frontendFiles) !==
      JSON.stringify(desktop.frontendFiles)
  )
    throw new Error(
      "Desktop and runtime were not built from the same page model and frontend. Rebuild before packaging.",
    );
  for (const [file, expected] of Object.entries(metadata.frontendFiles)) {
    for (const directory of ["dist", "dist-runtime/web"]) {
      const actual = createHash("sha256")
        .update(await readFile(join(root, directory, file)))
        .digest("hex");
      if (actual !== expected)
        throw new Error(
          `Built frontend changed after its manifest was created: ${directory}/${file}`,
        );
    }
  }
  await access(
    join(
      root,
      "dist-runtime/node_modules/@esbuild",
      `${target}-${architecture}`,
      target === "win32" ? "esbuild.exe" : "bin/esbuild",
    ),
  );
};
