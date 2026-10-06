import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

if (process.platform !== "darwin")
  throw new Error(
    "The Finder application launcher requires macOS. Use npm run dev:open on other systems.",
  );
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const { values } = parseArgs({
  options: { home: { type: "string" }, port: { type: "string" } },
});
const previous = await readFile(join(root, ".showai-dev/launcher.json"), "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === "ENOENT") return {};
    throw error;
  });
const config = {
  sourceRoot: root,
  home: resolve(
    values.home ?? previous.home ?? join(root, ".showai-dev/library"),
  ),
  port: Number(values.port ?? previous.port ?? 5173),
  nodeExecutable: process.execPath,
};
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
  throw new Error("Invalid development port.");
for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
  if (
    await access(candidate).then(
      () => true,
      () => false,
    )
  ) {
    config.nodeExecutable = candidate;
    break;
  }
}
const prepared = join(root, ".showai-dev/launcher/ShowAI.app");
await rm(prepared, { recursive: true, force: true });
await mkdir(join(prepared, "Contents/MacOS"), { recursive: true });
await mkdir(join(prepared, "Contents/Resources"), { recursive: true });
await writeFile(
  join(prepared, "Contents/Resources/launch.json"),
  JSON.stringify(config, null, 2),
);
await copyFile(
  join(root, "src/desktop/assets/icon.icns"),
  join(prepared, "Contents/Resources/icon.icns"),
);
await writeFile(
  join(prepared, "Contents/Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>ShowAI</string>
<key>CFBundleDisplayName</key><string>ShowAI</string>
<key>CFBundleIdentifier</key><string>ai.renaissancemind.showai.local-launcher</string>
<key>CFBundleExecutable</key><string>ShowAILauncher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>2</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>ShowAI Page</string><key>CFBundleURLSchemes</key><array><string>showai</string></array></dict></array>
</dict></plist>`,
);
const execute = promisify(execFile);
await execute("/usr/bin/swiftc", [
  join(root, "scripts/dev-launcher.swift"),
  "-o",
  join(prepared, "Contents/MacOS/ShowAILauncher"),
]);
await execute("/usr/bin/codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  prepared,
]);
await execute("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  prepared,
]);
const installed = join(homedir(), "Applications/ShowAI.app");
const backup = join(root, ".showai-dev/launcher/previous.app");
await mkdir(dirname(installed), { recursive: true });
await rm(backup, { recursive: true, force: true });
const exists = await access(installed).then(
  () => true,
  () => false,
);
if (exists) await rename(installed, backup);
await rename(prepared, installed).catch(async (error) => {
  if (exists) await rename(backup, installed);
  throw error;
});
await writeFile(
  join(root, ".showai-dev/launcher.json"),
  JSON.stringify(config, null, 2),
);
await execute(
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
  ["-f", installed],
);
await execute("/usr/bin/swift", [
  "-e",
  'import Foundation; import CoreServices; let status = LSSetDefaultHandlerForURLScheme("showai" as CFString, "ai.renaissancemind.showai.local-launcher" as CFString); if status != 0 { fatalError("Cannot register ShowAI URL handler: \\(status)") }',
]);
await rm(backup, { recursive: true, force: true });
console.log(JSON.stringify({ app: installed, ...config }));
