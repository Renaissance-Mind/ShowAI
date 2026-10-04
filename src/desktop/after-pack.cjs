const { access } = require("node:fs/promises");
const { join } = require("node:path");
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
  for (const file of [
    "scripts/cli.mjs",
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
