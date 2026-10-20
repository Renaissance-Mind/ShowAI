#!/usr/bin/env node
// Release notes and public-entry consistency for README, docs, the app welcome copy and the homepage.
//   node scripts/release-entry.mjs notes --headline TEXT [--changes FILE.json] [--notarized] [--media URL] [--source SHA] [--out FILE]
//   node scripts/release-entry.mjs check [--online] [--homepage DIR]
import { execFileSync } from "node:child_process";
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
    for (const name of [`ShowAI-${tagVersion}-arm64.dmg`, "SHA256SUMS.txt"])
      if (!assets.has(name)) errors.push(`${newest.tag_name}: missing asset ${name}`);
    for (const wanted of [ENTRY_COPY.en.tagline, "docs/quick-start.md"])
      if (!newest.body?.includes(wanted)) errors.push(`${newest.tag_name} notes: missing “${wanted}”`);
  }
  // The site answers every path with its app shell, so check the published content rather than status codes.
  const published = [];
  for (const path of ["/", "/seed.json", "/seed.en.json"]) {
    const page = await fetch(`${SITE}${path}`);
    if (!page.ok) errors.push(`${SITE}${path}: HTTP ${page.status}`);
    else published.push(await page.text());
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
  console.error("Usage: release-entry.mjs notes --headline TEXT [--changes FILE.json] [--notarized] [--media URL] [--source SHA] [--out FILE]\n       release-entry.mjs check [--online] [--homepage DIR]");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
