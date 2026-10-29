#!/usr/bin/env node
// Builds, verifies and (with --publish) publishes the macOS release of the pushed main commit.
//   node scripts/release-mac.mjs --headline TEXT --changes FILE.json [--work DIR] [--identity NAME] [--without-ci] [--publish]
//
// The full test suite runs in GitHub Actions (Check); this script requires that run to pass for the
// commit and then verifies what only a local build can: the signed bundle, the packaged App
// (src/desktop/smoke.mjs) and the in-app update feed. Without --publish it stops before tagging.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, checkOnlineEntries, checkReleaseAssets, releaseAssetNames, renderReleaseNotes } from "./release-entry.mjs";

const root = resolve(import.meta.dirname, "..");
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", ...options }).trim();
}

const timings = {};
// Runs a command with its output in logs/<name>.log and records how long it took.
async function step(work, name, command, args, options = {}) {
  const started = Date.now();
  const log = join(work, "logs", `${name}.log`);
  process.stdout.write(`${name} … `);
  const output = createWriteStream(log);
  const child = spawn(command, args, { cwd: options.cwd ?? root, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const code = await new Promise((done, fail) => child.on("error", fail).on("close", done));
  output.end();
  timings[name] = Math.round((Date.now() - started) / 1000);
  if (code !== 0) throw new Error(`${name} failed (exit ${code}); see ${log}`);
  console.log(`${timings[name]}s`);
  return log;
}

function sha256(path) {
  return new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", () => done(hash.digest("hex"))).on("error", fail);
  });
}

function developerIdentity(requested) {
  const identities = [...capture("security", ["find-identity", "-v", "-p", "codesigning"]).matchAll(/"(Developer ID Application: [^"]+)"/g)].map((match) => match[1]);
  if (requested) {
    if (!identities.some((identity) => identity.includes(requested))) throw new Error(`No valid signing identity matches “${requested}”: ${identities.join(", ") || "none"}`);
    return requested;
  }
  if (identities.length !== 1) throw new Error(`Pass --identity; found ${identities.length} Developer ID Application identities: ${identities.join(", ")}`);
  return identities[0];
}

// The Check workflow must have passed for the commit; waits while it is still running.
async function requireCheck(sha) {
  for (;;) {
    const runs = JSON.parse(capture("gh", ["api", `repos/${REPO}/actions/workflows/check.yml/runs?head_sha=${sha}&per_page=5`])).workflow_runs;
    const run = runs[0];
    if (!run) throw new Error(`Check has not run for ${sha.slice(0, 8)}. Push it to main, or pass --without-ci.`);
    if (run.status === "completed") {
      if (run.conclusion !== "success") throw new Error(`Check ${run.conclusion} for ${sha.slice(0, 8)}: ${run.html_url}`);
      return { conclusion: run.conclusion, url: run.html_url };
    }
    console.log(`Check is ${run.status} for ${sha.slice(0, 8)}; waiting: ${run.html_url}`);
    await new Promise((done) => setTimeout(done, 30_000));
  }
}

const urlHandler = () =>
  capture("osascript", ["-l", "JavaScript", "-e", 'ObjC.import("CoreServices"); const o = ObjC.castRefToObject($.LSCopyDefaultHandlerForURLScheme($("showai"))); typeof o.js === "string" ? o.js : ""']);
const setUrlHandler = (bundleId) =>
  capture("osascript", ["-l", "JavaScript", "-e", `ObjC.import("CoreServices"); $.LSSetDefaultHandlerForURLScheme($("showai"), $(${JSON.stringify(bundleId)}))`]);

async function main(args) {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tag = `v${version}`;
  const publish = args.includes("--publish");
  const changesPath = option(args, "--changes");
  const notes = renderReleaseNotes({
    version,
    headline: option(args, "--headline"),
    changes: changesPath ? JSON.parse(readFileSync(changesPath, "utf8")) : {},
    source: capture("git", ["rev-parse", "HEAD"]),
  });
  const work = resolve(option(args, "--work") ?? join(root, "release", version));
  const exports = join(work, "exports");
  const source = join(work, "source");

  // Preflight: everything that can stop the release before the long steps.
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("The macOS release builds on an Apple silicon Mac.");
  capture("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
  const sha = capture("git", ["rev-parse", "HEAD"]);
  if (sha !== capture("git", ["rev-parse", "origin/main"])) throw new Error(`HEAD ${sha.slice(0, 8)} is not origin/main; release a pushed main commit.`);
  if (publish && capture("git", ["tag", "--list", tag])) throw new Error(`${tag} already exists; bump the version in package.json first.`);
  const identity = developerIdentity(option(args, "--identity"));
  await mkdir(join(work, "logs"), { recursive: true });
  const { bavail, bsize } = statfsSync(work);
  if (bavail * bsize < 5 * 2 ** 30) throw new Error(`Less than 5 GiB free for ${work}.`);
  const ci = args.includes("--without-ci") ? { conclusion: "skipped" } : await requireCheck(sha);
  console.log(`Releasing ShowAI ${version} from ${sha.slice(0, 8)} into ${work}`);

  await rm(source, { recursive: true, force: true });
  await rm(exports, { recursive: true, force: true });
  await mkdir(source, { recursive: true });
  execFileSync("/bin/sh", ["-c", `git archive ${sha} | tar -x -C "${source}"`], { cwd: root });
  // An APFS clone of the dependencies the commit was tested with; it costs no disk space.
  execFileSync("cp", ["-cR", join(root, "node_modules"), join(source, "node_modules")]);
  const env = { SHOWAI_SOURCE_COMMIT: sha, TMPDIR: join(work, "tmp") };
  await mkdir(env.TMPDIR, { recursive: true });
  await step(work, "check", "npm", ["run", "check"], { cwd: source, env });
  await step(work, "build", "npm", ["run", "build"], { cwd: source, env });
  const packageLog = await step(
    work,
    "package",
    "npx",
    ["electron-builder", "--mac", "--arm64", "--publish", "never", "--config", "electron-builder.yml", `-c.directories.output=${exports}`, `-c.mac.identity=${identity.replace(/^Developer ID Application: /, "")}`, "-c.mac.hardenedRuntime=true"],
    { cwd: source, env },
  );

  const app = join(exports, "mac-arm64/ShowAI.app");
  await step(work, "verify-signature", "codesign", ["--verify", "--deep", "--strict", app]);
  const signature = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr;
  for (const [label, pattern] of [["Developer ID", /Authority=Developer ID Application/], ["secure timestamp", /Timestamp=/], ["hardened runtime", /flags=0x10000\(runtime\)/]])
    if (!pattern.test(signature)) throw new Error(`The App signature has no ${label}.`);
  if (capture("defaults", ["read", join(app, "Contents/Info.plist"), "CFBundleShortVersionString"]) !== version) throw new Error("The App reports a different version.");
  if (!existsSync(join(app, "Contents/Resources/app-update.yml"))) throw new Error("The App has no app-update.yml, so it cannot update itself.");

  // The packaged App registers itself for showai:// when it starts; give the scheme back afterwards.
  const handler = urlHandler();
  try {
    await step(work, "packaged-smoke", "node", ["src/desktop/smoke.mjs", join(app, "Contents/MacOS/ShowAI")], { cwd: source, env });
  } finally {
    execFileSync(LSREGISTER, ["-u", app]);
    if (handler) setUrlHandler(handler);
  }
  await step(work, "verify-dmg", "hdiutil", ["verify", join(exports, `ShowAI-${version}-arm64.dmg`)]);
  await step(work, "verify-zip", "unzip", ["-tq", join(exports, `ShowAI-${version}-arm64.zip`)]);
  const assets = checkReleaseAssets(exports, version);
  if (assets.errors.length) throw new Error(assets.errors.join("\n"));
  writeFileSync(join(work, "release-notes.md"), notes.body);

  const receipt = {
    version,
    tag,
    sourceCommit: sha,
    ci,
    signing: `${identity}, hardened runtime, secure timestamp`,
    notarized: false,
    timestampRetries: (readFileSync(packageLog, "utf8").match(/timestamp unavailable, retrying/g) ?? []).length,
    timings,
    assets: await Promise.all(releaseAssetNames(version).map(async (name) => ({ name, size: statSync(join(exports, name)).size, sha256: await sha256(join(exports, name)) }))),
  };
  await rm(source, { recursive: true, force: true });
  await rm(join(exports, "mac-arm64"), { recursive: true, force: true });
  await rm(env.TMPDIR, { recursive: true, force: true });

  if (publish) {
    capture("git", ["tag", tag, sha]);
    capture("git", ["push", "origin", tag]);
    await step(work, "upload", "gh", ["release", "create", tag, "--repo", REPO, "--verify-tag", "--latest", "--title", notes.title, "--notes-file", join(work, "release-notes.md"), ...releaseAssetNames(version).map((name) => join(exports, name))]);
    const remote = JSON.parse(capture("gh", ["release", "view", tag, "--repo", REPO, "--json", "url,isDraft,assets"]));
    if (remote.isDraft) throw new Error(`${tag} is still a draft: ${remote.url}`);
    for (const asset of receipt.assets) {
      const uploaded = remote.assets.find((item) => item.name === asset.name);
      if (uploaded?.size !== asset.size || uploaded.digest !== `sha256:${asset.sha256}`) throw new Error(`${asset.name} on GitHub differs from the local file.`);
    }
    const online = await checkOnlineEntries(version);
    for (const warning of online.warnings) console.warn(`warning: ${warning}`);
    if (online.errors.length) throw new Error(online.errors.join("\n"));
    receipt.release = remote.url;
  }
  writeFileSync(join(work, "release-receipt.json"), JSON.stringify(receipt, null, 1) + "\n");
  console.log(publish ? `Published ${receipt.release}` : `Verified ${tag}; rerun with --publish to tag and upload.\n${exports}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
