const { access, lstat, readdir, realpath } = require("node:fs/promises");
const { join, sep } = require("node:path");
const { Arch } = require("builder-util");

module.exports = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const plugin = join(resources, "runtime");
  const canonical = await realpath(plugin);
  async function verifyLinks(directory) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name),
        info = await lstat(path);
      if (info.isSymbolicLink()) {
        const target = await realpath(path);
        if (target !== canonical && !target.startsWith(canonical + sep))
          throw new Error(
            `Packaged runtime link escapes its own bundle: ${path}`,
          );
      } else if (info.isDirectory()) await verifyLinks(path);
    }
  }
  await verifyLinks(plugin);
  for (const file of [
    "scripts/cli.mjs",
    "node_modules/dugite/git/" +
      (context.electronPlatformName === "win32" ? "cmd/git.exe" : "bin/git"),
    "assets/viewer.html",
    "node_modules/esbuild/lib/main.js",
    "node_modules/react/package.json",
    "node_modules/react-dom/package.json",
    "node_modules/ajv/package.json",
    "node_modules/marked/package.json",
    "node_modules/lucide-react/package.json",
  ]) {
    await access(join(plugin, file));
  }
  await access(
    join(
      plugin,
      "node_modules/@esbuild",
      `${context.electronPlatformName}-${Arch[context.arch]}`,
      context.electronPlatformName === "win32" ? "esbuild.exe" : "bin/esbuild",
    ),
  );
};
