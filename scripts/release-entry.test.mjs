import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { ENTRY_COPY, checkLocalEntries, checkReleaseAssets, renderReleaseNotes } from "./release-entry.mjs";

const latest = "https://github.com/Renaissance-Mind/ShowAI/releases/latest";

test("release notes open with the shared copy and link this version's downloads", () => {
  const { title, body } = renderReleaseNotes({
    version: "0.10.0",
    headline: "Connect Claude Code and Codex from the welcome screen",
    changes: { new: ["Welcome screen installs the plugin"], fixed: ["Saving after a conflict"] },
    source: "0123456789abcdef",
  });
  assert.equal(title, "ShowAI 0.10.0 — Connect Claude Code and Codex from the welcome screen");
  assert.ok(body.startsWith(`**${ENTRY_COPY.en.tagline}** ${ENTRY_COPY.en.oneLiner}`));
  assert.match(body, /releases\/download\/v0\.10\.0\/ShowAI-0\.10\.0-arm64\.dmg/);
  assert.match(body, /blob\/v0\.10\.0\/docs\/quick-start\.md/);
  assert.ok(body.includes(`> ${ENTRY_COPY.en.prompt}`));
  assert.match(body, /\*\*New\*\*\n\n- Welcome screen installs the plugin/);
  assert.doesNotMatch(body, /\*\*Improved\*\*/);
  assert.match(body, /not been notarized/);
  assert.match(body, /\[0123456\]\(https:\/\/github\.com\/Renaissance-Mind\/ShowAI\/commit\/0123456789abcdef\)/);
  assert.doesNotMatch(renderReleaseNotes({ version: "0.10.0", headline: "x", notarized: true }).body, /notarized/);
  assert.throws(() => renderReleaseNotes({ version: "0.10.0", headline: " " }), /headline/);
  assert.throws(() => renderReleaseNotes({ version: "latest", headline: "x" }), /Invalid version/);
});

test("entry check reports missing copy, retired wording and hard-coded versions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "showai-release-entry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { en, zh } = ENTRY_COPY;
  const files = {
    "README.md": [en.tagline, en.oneLiner, en.usage, en.prompt, latest, "docs/quick-start.md"],
    "docs/i18n/README.zh-CN.md": [zh.tagline, zh.oneLiner, zh.usage, zh.prompt, latest, "quick-start.zh-CN.md"],
    "docs/showai-banner.svg": [en.tagline],
    "docs/i18n/showai-banner.zh-CN.svg": [zh.tagline],
    "docs/quick-start.md": [en.usage, en.prompt, latest],
    "docs/i18n/quick-start.zh-CN.md": [zh.usage, zh.prompt, latest],
    "docs/chatgpt.md": ["Invite only"],
    "docs/i18n/chatgpt.zh-CN.md": ["邀请制"],
    "docs/README.md": ["Guides describe the current source."],
    "docs/i18n/index.zh-CN.md": ["指南对应当前源码。"],
    "plugins/showai/README.md": ["Install from the app."],
    "plugins/showai/README.zh-CN.md": ["从 App 安装。"],
    "src/i18n/messages/welcome.ts": [en.tagline, zh.tagline],
  };
  const write = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  for (const [path, texts] of Object.entries(files)) await write(path, texts.join("\n"));
  assert.deepEqual(checkLocalEntries(root), { errors: [], warnings: [] });

  await write("README.md", files["README.md"].filter((text) => text !== en.prompt).concat("An interface between humans and agents").join("\n"));
  await write("docs/README.md", "These guides follow **application 0.9.0, local plugin 0.16.1**.");
  await write("plugins/showai/README.zh-CN.md", "仓库应用源码版本为 **0.9.0**。");
  await write("src/i18n/messages/welcome.ts", en.tagline);
  const { errors } = checkLocalEntries(root);
  assert.ok(errors.some((error) => error.startsWith("README.md: missing") && error.includes("mortgage calculator")));
  assert.ok(errors.some((error) => error.startsWith("README.md: retired wording")));
  assert.ok(errors.some((error) => error.startsWith("docs/README.md: hard-coded version")));
  assert.ok(errors.some((error) => error.startsWith("plugins/showai/README.zh-CN.md: hard-coded version")));
  assert.ok(errors.some((error) => error.includes("welcome copy") && error.includes(zh.tagline)));
  assert.equal(errors.length, 5);
});

test("release assets include the update feed that matches the ZIP", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "showai-release-assets-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const zip = "ShowAI-0.11.0-arm64.zip";
  const dmg = "ShowAI-0.11.0-arm64.dmg";
  await writeFile(join(dir, zip), "zip bytes");
  await writeFile(join(dir, dmg), "dmg bytes");
  await writeFile(join(dir, `${zip}.blockmap`), "blockmap");
  const sha512 = (text) => createHash("sha512").update(text).digest("base64");
  const feed = (zipHash) =>
    [
      "version: 0.11.0",
      "files:",
      `  - url: ${zip}`,
      `    sha512: ${zipHash}`,
      "    size: 9",
      `  - url: ${dmg}`,
      `    sha512: ${sha512("dmg bytes")}`,
      "    size: 9",
      `path: ${zip}`,
      `sha512: ${zipHash}`,
      "releaseDate: '2026-10-28T00:00:00.000Z'",
      "",
    ].join("\n");
  await writeFile(join(dir, "latest-mac.yml"), feed(sha512("zip bytes")));
  const passed = checkReleaseAssets(dir, "0.11.0");
  assert.deepEqual(passed.errors, []);
  assert.equal(passed.files.length, 5);
  const sums = await readFile(join(dir, "SHA256SUMS.txt"), "utf8");
  assert.match(sums, new RegExp(`^[0-9a-f]{64}  ${dmg}\n[0-9a-f]{64}  ${zip}\n$`));

  await writeFile(join(dir, "latest-mac.yml"), feed(sha512("older zip")));
  assert.match(checkReleaseAssets(dir, "0.11.0").errors.join("\n"), /sha512 differs/);
  assert.match(checkReleaseAssets(dir, "0.12.0").errors.join("\n"), /ShowAI-0\.12\.0-arm64\.dmg is missing/);
  await rm(join(dir, "latest-mac.yml"));
  assert.match(checkReleaseAssets(dir, "0.11.0").errors.join("\n"), /latest-mac\.yml is missing/);
});
