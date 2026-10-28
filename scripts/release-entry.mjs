#!/usr/bin/env node
// Release notes and public-entry consistency for README, docs, the app welcome copy and the homepage.
//   node scripts/release-entry.mjs notes --headline TEXT [--changes FILE.json] [--notarized] [--media URL] [--source SHA] [--out FILE]
//   node scripts/release-entry.mjs check [--online] [--homepage DIR]
//   node scripts/release-entry.mjs assets DIR [--version X.Y.Z]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPO = "Renaissance-Mind/ShowAI";
export const SITE = "https://showai.renaissancemind.ai";

// Shared wording for every public entry. Keep in step with the app's welcome copy and the homepage.
export const ENTRY_COPY = {
  en: {
    tagline: "The evolving interface between humans and agents.",
    oneLiner: "Your agent's answers become interfaces — interactive, archived, and evolving as you use them.",
    usage: "ShowAI works inside the agent you already use: the plugin lets your agent build interfaces, and the ShowAI app keeps, opens and edits them.",
    prompt: "Use ShowAI to build a mortgage calculator: price, down payment, rate and term are adjustable; show the monthly payment and total interest.",
  },
  zh: {
    tagline: "可进化的人机交互界面",
    oneLiner: "Agent 的回答不再只是一段文字，而是一个可以交互、可以归档、在使用中不断进化的界面。",
    usage: "ShowAI 在你已经在用的 Agent 里工作：装上插件后，Agent 就能把回答做成界面；ShowAI App 负责保存、打开和继续编辑这些界面。",
    prompt: "用 ShowAI 帮我做一个房贷计算器：房价、首付比例、利率和贷款年限可以调整，显示月供和总利息。",
  },
};

const RETIRED = ["An interface between humans and agents", "人机协作 Harness", "Agent-Native"];
const LATEST = `https://github.com/${REPO}/releases/latest`;
const VERSION_PIN = /\b(?:application|plugin|source version)\s+(?:is\s+)?\**\d+\.\d+\.\d+|(?:应用|本机插件|源码版本(?:为)?)\s*\**\d+\.\d+\.\d+/i;

export function renderReleaseNotes({ version, headline, changes = {}, notarized = false, media, source }) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version ?? "")) throw new Error(`Invalid version: ${version}`);
  if (!headline?.trim()) throw new Error("A headline is required: name the most noticeable change for users.");
  const tag = `v${version}`;
  const download = (name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
  const blob = (path) => `https://github.com/${REPO}/blob/${tag}/${path}`;
  const { en } = ENTRY_COPY;
  const groups = [["New", changes.new], ["Improved", changes.improved], ["Fixed", changes.fixed]]
    .filter(([, items]) => items?.length);
  const knownIssues = [
    ...(notarized ? [] : ["This build has not been notarized by Apple, so macOS may block the first launch. After trying to open ShowAI, go to **System Settings → Privacy & Security → Open Anyway** ([Apple's instructions](https://support.apple.com/en-us/102445))."]),
    "Intel Macs are not supported yet.",
    ...(changes.knownIssues ?? []),
  ];
  const lines = [
    `**${en.tagline}** ${en.oneLiner} [Website](${SITE}/) · [README](https://github.com/${REPO}#readme)`,
    "",
    ...(media ? [media, ""] : []),
    "### Download",
    "",
    `- **[ShowAI-${version}-arm64.dmg](${download(`ShowAI-${version}-arm64.dmg`)})** — open it and drag ShowAI into Applications.`,
    `- [ShowAI-${version}-arm64.zip](${download(`ShowAI-${version}-arm64.zip`)}) — the same app as a ZIP.`,
    `- [SHA256SUMS.txt](${download("SHA256SUMS.txt")}) — checksums for both downloads.`,
    "",
    `Mac with Apple silicon, macOS 13 or later. On Windows or Linux, [run the browser edition from source](${blob("docs/quick-start.md")}#run-from-source).`,
    "",
    "### Get started",
    "",
    en.usage,
    "",
    "1. **Open ShowAI.**",
    "2. **Connect your agent** — the welcome screen finds Claude Code or Codex. Click **Install plugin**, then restart the agent.",
    "3. **Ask for an interface** — paste this into a new conversation:",
    "",
    `   > ${en.prompt}`,
    "",
    `Full guide: [Quick start](${blob("docs/quick-start.md")}) · [Use ShowAI in Claude Code and Codex](${blob("docs/codex.md")}).`,
    "",
  ];
  if (groups.length) {
    lines.push("### What's new", "");
    for (const [label, items] of groups) lines.push(`**${label}**`, "", ...items.map((item) => `- ${item}`), "");
  }
  lines.push("### Known issues", "", ...knownIssues.map((item) => `- ${item}`), "");
  if (source) lines.push(`Source: [${source.slice(0, 7)}](https://github.com/${REPO}/commit/${source}).`, "");
  return { title: `ShowAI ${version} — ${headline.trim()}`, body: lines.join("\n") };
}

function filesUnder(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, String(name)))
    .filter((path) => pattern.test(path) && !/node_modules|\/dist\//.test(path) && statSync(path).isFile());
}

// Files a macOS release uploads. The App's in-app updater reads latest-mac.yml and downloads the ZIP,
// using the blockmap for differential downloads; a release without them leaves installed Apps behind.
export function releaseAssetNames(version) {
  const base = `ShowAI-${version}-arm64`;
  return [`${base}.dmg`, `${base}.zip`, `${base}.zip.blockmap`, "latest-mac.yml", "SHA256SUMS.txt"];
}

// Versions before 0.10.1 shipped without the in-app updater, so their releases carry no update feed.
const updaterSince = [0, 10, 1];
function hasUpdater(version) {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index++)
    if (parts[index] !== updaterSince[index]) return parts[index] > updaterSince[index];
  return true;
}

// The files electron-builder lists in latest-mac.yml: url, base64 sha512 and size.
export function parseUpdateFeed(text) {
  const version = text.match(/^version:\s*['"]?([^'"\s]+)/m)?.[1];
  const files = [...text.matchAll(/^\s*- url:\s*(\S+)\n\s+sha512:\s*(\S+)\n\s+size:\s*(\d+)/gm)].map(
    ([, url, sha512, size]) => ({ url, sha512, size: Number(size) }),
  );
  return { version, path: text.match(/^path:\s*(\S+)/m)?.[1], files };
}

// Checks a release folder before upload; writes SHA256SUMS.txt when it is missing.
export function checkReleaseAssets(dir, version) {
  const errors = [];
  const [dmg, zip, blockmap, feedName, sumsName] = releaseAssetNames(version);
  for (const name of [dmg, zip, blockmap, feedName])
    if (!existsSync(join(dir, name))) errors.push(`${name} is missing from ${dir}`);
  if (errors.length) return { errors, files: [] };
  const digest = (name, algorithm, encoding) =>
    createHash(algorithm).update(readFileSync(join(dir, name))).digest(encoding);
  const feed = parseUpdateFeed(readFileSync(join(dir, feedName), "utf8"));
  if (feed.version !== version) errors.push(`${feedName} names version ${feed.version}, expected ${version}`);
  if (feed.path !== zip) errors.push(`${feedName} points the updater at ${feed.path}, expected ${zip}`);
  if (!feed.files.some((file) => file.url === zip)) errors.push(`${feedName} does not list ${zip}`);
  for (const file of feed.files) {
    if (!existsSync(join(dir, file.url))) {
      errors.push(`${feedName} lists ${file.url}, which is not in ${dir}`);
      continue;
    }
    if (statSync(join(dir, file.url)).size !== file.size) errors.push(`${file.url}: size differs from ${feedName}`);
    if (digest(file.url, "sha512", "base64") !== file.sha512) errors.push(`${file.url}: sha512 differs from ${feedName}; rebuild instead of re-signing the ZIP`);
  }
  const sums = [dmg, zip].map((name) => `${digest(name, "sha256", "hex")}  ${name}`).join("\n") + "\n";
  if (!existsSync(join(dir, sumsName))) writeFileSync(join(dir, sumsName), sums);
  else if (readFileSync(join(dir, sumsName), "utf8") !== sums) errors.push(`${sumsName} does not match ${dmg} and ${zip}`);
  return { errors, files: releaseAssetNames(version).map((name) => join(dir, name)) };
}

// Returns { errors, warnings } for the files in this repository (and an optional homepage checkout).
export function checkLocalEntries(root, { homepage } = {}) {
  const errors = [];
  const warnings = [];
  const read = (path) => readFileSync(join(root, path), "utf8");
  const expect = (path, texts) => {
    const text = read(path);
    for (const wanted of texts) if (!text.includes(wanted)) errors.push(`${path}: missing “${wanted}”`);
    for (const old of RETIRED) if (text.includes(old)) errors.push(`${path}: retired wording “${old}”`);
  };
  const { en, zh } = ENTRY_COPY;
  expect("README.md", [en.tagline, en.oneLiner, en.usage, en.prompt, LATEST, "docs/quick-start.md"]);
  expect("docs/i18n/README.zh-CN.md", [zh.tagline, zh.oneLiner, zh.usage, zh.prompt, LATEST, "quick-start.zh-CN.md"]);
  expect("docs/showai-banner.svg", [en.tagline]);
  expect("docs/i18n/showai-banner.zh-CN.svg", [zh.tagline]);
  expect("docs/quick-start.md", [en.usage, en.prompt, LATEST]);
  expect("docs/i18n/quick-start.zh-CN.md", [zh.usage, zh.prompt, LATEST]);
  expect("docs/chatgpt.md", ["Invite only"]);
  expect("docs/i18n/chatgpt.zh-CN.md", ["邀请制"]);
  for (const path of ["docs/README.md", "docs/i18n/index.zh-CN.md", "plugins/showai/README.md", "plugins/showai/README.zh-CN.md"]) {
    const pin = read(path).match(VERSION_PIN);
    if (pin) errors.push(`${path}: hard-coded version “${pin[0]}”; versions belong in release notes`);
  }
  const messages = filesUnder(join(root, "src/i18n/messages"), /\.ts$/).map((path) => readFileSync(path, "utf8")).join("\n");
  for (const tagline of [en.tagline, zh.tagline])
    if (!messages.includes(tagline)) errors.push(`src/i18n/messages: the app's welcome copy does not use “${tagline}”`);
  if (homepage) {
    const sources = [...filesUnder(join(homepage, "site/web"), /\.(tsx?|json)$/), ...filesUnder(join(homepage, "docs-site/pages"), /\.py$/)]
      .map((path) => readFileSync(path, "utf8")).join("\n");
    for (const tagline of [en.tagline, zh.tagline])
      if (!sources.includes(tagline)) errors.push(`${homepage}: homepage sources do not use “${tagline}”`);
    for (const old of RETIRED) if (sources.includes(old)) warnings.push(`${homepage}: retired wording “${old}” still appears`);
  }
  return { errors, warnings };
}

// Published state: GitHub releases and the homepage. Needs network access.
export async function checkOnlineEntries(version) {
  const errors = [];
  const warnings = [];
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { headers: { accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub releases request failed: HTTP ${response.status}`);
  const releases = await response.json();
  const newest = releases[0];
  if (!newest) errors.push("GitHub has no published release");
  else {
    if (newest.tag_name !== `v${version}`) warnings.push(`newest published release is ${newest.tag_name}, package.json is ${version}`);
    if (newest.prerelease) warnings.push(`${newest.tag_name} is a pre-release, so ${LATEST} opens the release list instead of this release`);
    const assets = new Set(newest.assets.map((asset) => asset.name));
    const tagVersion = newest.tag_name.replace(/^v/, "");
    const required = hasUpdater(tagVersion) ? releaseAssetNames(tagVersion) : [`ShowAI-${tagVersion}-arm64.dmg`, "SHA256SUMS.txt"];
    for (const name of required)
      if (!assets.has(name)) errors.push(`${newest.tag_name}: missing asset ${name}`);
    for (const wanted of [ENTRY_COPY.en.tagline, "docs/quick-start.md"])
      if (!newest.body?.includes(wanted)) errors.push(`${newest.tag_name} notes: missing “${wanted}”`);
  }
  // The site answers every path with its app shell; the launch page's shared copy ships in its main script.
  const published = [];
  const shell = await fetch(`${SITE}/`);
  if (!shell.ok) errors.push(`${SITE}/: HTTP ${shell.status}`);
  else {
    const html = await shell.text();
    published.push(html);
    const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    if (!script) errors.push(`${SITE}/: no main script`);
    else {
      const main = await fetch(new URL(script, `${SITE}/`));
      if (!main.ok) errors.push(`${SITE}${script}: HTTP ${main.status}`);
      else published.push(await main.text());
    }
  }
  for (const tagline of [ENTRY_COPY.en.tagline, ENTRY_COPY.zh.tagline])
    if (!published.some((text) => text.includes(tagline))) errors.push(`${SITE}: published homepage does not use “${tagline}” yet`);
  return { errors, warnings };
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

async function main(args) {
  const root = resolve(import.meta.dirname, "..");
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const [command] = args;
  if (command === "notes") {
    const changesPath = option(args, "--changes");
    const { title, body } = renderReleaseNotes({
      version: option(args, "--version") ?? version,
      headline: option(args, "--headline"),
      changes: changesPath ? JSON.parse(readFileSync(changesPath, "utf8")) : {},
      notarized: args.includes("--notarized"),
      media: option(args, "--media"),
      source: option(args, "--source") ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    });
    const out = option(args, "--out");
    if (out) writeFileSync(out, body);
    else process.stdout.write(body);
    process.stderr.write(`Title: ${title}\n`);
    return 0;
  }
  if (command === "check") {
    const results = [checkLocalEntries(root, { homepage: option(args, "--homepage") })];
    if (args.includes("--online")) results.push(await checkOnlineEntries(version));
    const errors = results.flatMap((result) => result.errors);
    for (const warning of results.flatMap((result) => result.warnings)) console.warn(`warning: ${warning}`);
    for (const error of errors) console.error(`error: ${error}`);
    console.log(errors.length ? `${errors.length} public-entry problem(s)` : "Public entries are consistent.");
    return errors.length ? 1 : 0;
  }
  if (command === "assets") {
    const dir = args[1];
    if (!dir || dir.startsWith("--")) throw new Error("assets needs the release folder");
    const { errors, files } = checkReleaseAssets(resolve(dir), option(args, "--version") ?? version);
    for (const error of errors) console.error(`error: ${error}`);
    if (errors.length) return 1;
    console.log(`Upload all of these to the GitHub release:\n${files.join("\n")}`);
    return 0;
  }
  console.error("Usage: release-entry.mjs notes --headline TEXT [--changes FILE.json] [--notarized] [--media URL] [--source SHA] [--out FILE]\n       release-entry.mjs check [--online] [--homepage DIR]\n       release-entry.mjs assets DIR [--version X.Y.Z]");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
