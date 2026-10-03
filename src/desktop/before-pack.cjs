const { readFile, access } = require("node:fs/promises");
const { join } = require("node:path");
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
    await readFile(join(root, "plugins/showai/assets/build.json"), "utf8"),
  );
  if (
    metadata.platform !== target ||
    metadata.architecture !== architecture ||
    metadata.version !== context.packager.appInfo.version
  ) {
    throw new Error(
      "Plugin runtime does not match this application version/platform. Run npm run build on the target machine before packaging.",
    );
  }
  await access(
    join(
      root,
      "plugins/showai/node_modules/@esbuild",
      `${target}-${architecture}`,
      target === "win32" ? "esbuild.exe" : "bin/esbuild",
    ),
  );
};
