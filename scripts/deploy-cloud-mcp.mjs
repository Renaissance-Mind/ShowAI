import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCloudMcpRelease } from "./cloud-mcp-release.mjs";

// Run by the account owner in their terminal. No credential is printed.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The handoff directory comes from scripts/prepare-cloud-mcp-release.mjs.
if (!process.argv[2]) throw new Error("用法：node scripts/deploy-cloud-mcp.mjs <发布交接目录>");
const handoff = resolve(root, process.argv[2]);
const source = join(handoff, "release-source");
const privateDir = join(handoff, "private");
const config = join(source, "deployments/cloudflare/mcp.wrangler.jsonc");
const bucket = "showai-mcp-state";
const origin = "https://agent.showai.renaissancemind.ai";
const syncServer = "https://showai.renaissancemind.ai/cloud";
const targetAccountId = "8f1753ad2d5e392716033248d7c5639e";
const keyFile = join(privateDir, "secrets.json");
const ownershipFile = join(privateDir, "bucket-ownership.json");
const scopes = ["account:read", "user:read", "workers:write", "workers_routes:write", "workers_scripts:write", "zone:read", "ssl_certs:write", "artifacts:write", "containers:write", "cloudchamber:write"];
let env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" };
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
function requireAuthConnectivity(result) {
  if (result.code !== 0 && /could not be reached|could not be refreshed|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network problem/i.test(result.stdout + result.stderr))
    throw new Error("Cloudflare 登录检查受网络阻止；保留已有登录。恢复终端联网后重试，无需重新登录。");
}

async function run(command, args, { capture = false, allowFailure = false, cwd = source, commandEnv = env } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env: commandEnv, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (s) => { stdout += s; });
    child.stderr?.on("data", (s) => { stderr += s; });
    child.on("error", fail);
    child.on("close", (code) => {
      const result = { code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) };
      if (code !== 0 && !allowFailure) {
        if (capture) process.stderr.write(result.stderr || result.stdout);
        fail(new Error(`${command} ${args[0]} 失败（${code}）。已停止，保留现有状态。`));
      } else done(result);
    });
  });
}
const wrangler = (args, options) => run("npx", ["--yes", "wrangler@4.148.0", ...args], options);
async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
async function savePrivate(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function startColima() {
  if (env.COLIMA_PROFILE && env.COLIMA_PROFILE !== "default") throw new Error("Colima 自定义实例启动失败，已停止。");
  const limaHome = join(resolve(env.COLIMA_HOME ?? join(homedir(), ".colima")), "_lima");
  const instance = join(limaHome, "colima");
  const lockPath = join(limaHome, "_disks/colima/in_use_by");
  let owner;
  try { owner = await readlink(lockPath); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const limaEnv = { ...env, LIMA_HOME: limaHome };
  // Inspect the existing lock before startup. The host-agent's final log can
  // arrive after Colima exits, so recovery must not depend on that log timing.
  if (owner !== undefined) {
    if (resolve(dirname(lockPath), owner) !== instance) throw new Error("磁盘锁属于另一个实例，已停止。");
    const state = await run("limactl", ["list", "colima", "--json"], { capture: true, commandEnv: limaEnv });
    const vm = JSON.parse(state.stdout);
    if (vm.status !== "Stopped" || resolve(vm.dir) !== instance) throw new Error("Colima 未确认停止，保留磁盘锁并停止部署。");
    let pidText;
    try { pidText = await readFile(join(instance, "ha.pid"), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (pidText !== undefined) {
      const pid = Number(pidText.trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("残留进程编号无效，已停止。");
      let running = true;
      try { process.kill(pid, 0); }
      catch (error) { if (error.code !== "ESRCH") throw error; running = false; }
      if (running) throw new Error("Colima 进程仍在运行，保留磁盘锁并停止部署。");
    }
    console.log("Colima 已确认停止，使用官方命令释放残留磁盘锁后启动。");
    await run("limactl", ["disk", "unlock", "colima"], { commandEnv: limaEnv });
  }
  const start = await run("colima", ["start"], { allowFailure: true });
  if (start.code === 0) return;
  let failure;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const log = await readFile(join(instance, "ha.stderr.log"), "utf8");
      const events = log.trim().split("\n").flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      failure = events.filter((event) => event.level === "fatal").at(-1)?.msg;
      if (failure) break;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Colima 启动失败：${failure ?? "未返回错误详情"}`);
}

async function main() {
  const manifest = await readJson(join(handoff, "release-source.json"));
  if (!manifest?.prepared) throw new Error("发布快照尚未准备好。先运行 node scripts/prepare-cloud-mcp-release.mjs <发布交接目录> <commit>。");
  const integrity = await verifyCloudMcpRelease(source, manifest);
  console.log(`发布快照完整性通过：${integrity.verifiedFiles} 个构建输入。`);
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== targetAccountId)
    throw new Error("CLOUDFLARE_ACCOUNT_ID 与本次授权的 Cloudflare 账号不一致，已停止。");
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  env.WRANGLER_LOG_PATH = join(privateDir, "wrangler.log");

  console.log("[1/6] 检查 Cloudflare 登录；若弹出网页，请完成 Authorize 后回到终端等待。");
  let identity = await wrangler(["whoami", "--json"], { capture: true, allowFailure: true });
  requireAuthConnectivity(identity);
  if (identity.code !== 0) {
    // Reuse a private task-specific location instead of modifying global login settings.
    env.XDG_CONFIG_HOME = join(privateDir, "auth");
    await mkdir(env.XDG_CONFIG_HOME, { recursive: true, mode: 0o700 });
    await chmod(env.XDG_CONFIG_HOME, 0o700);
    identity = await wrangler(["whoami", "--json"], { capture: true, allowFailure: true });
    requireAuthConnectivity(identity);
    if (identity.code !== 0) {
      await wrangler(["login", "--scopes", ...scopes]);
      identity = await wrangler(["whoami", "--json"], { capture: true });
    }
  }
  const user = JSON.parse(identity.stdout);
  if (!user.loggedIn || !user.accounts?.length) throw new Error("没有可部署的 Cloudflare 账号。");
  const account = user.accounts.find((a) => a.id === targetAccountId);
  if (!account) throw new Error("已有 Cloudflare 登录没有本次目标账号的权限，已停止。");
  env.CLOUDFLARE_ACCOUNT_ID = account.id;
  console.log(`使用账号：${account.name}`);

  console.log("[2/6] 检查 Docker。");
  let docker = await run("docker", ["info"], { capture: true, allowFailure: true }).catch(() => ({ code: 1 }));
  if (docker.code !== 0 && /permission denied|operation not permitted/i.test((docker.stdout ?? "") + (docker.stderr ?? "")))
    throw new Error("终端环境被拒绝访问 Docker socket；需要恢复执行环境权限。未启动或修改 Colima。");
  if (docker.code !== 0) {
    const colima = await run("colima", ["version"], { capture: true, allowFailure: true }).catch(() => ({ code: 1 }));
    if (colima.code !== 0) throw new Error("请打开 Docker Desktop，等待启动完成后再次运行这条命令。");
    await startColima();
    docker = await run("docker", ["info"], { capture: true });
  }
  if (docker.code !== 0) throw new Error("Docker 尚未可用。");
  const buildx = await run("docker", ["buildx", "version"], { capture: true, allowFailure: true });
  if (buildx.code !== 0)
    throw new Error("Docker Buildx 不可用；Wrangler 构建需要 --load，旧构建器不支持。请先运行 brew install docker-buildx，再重试部署。现有存储和密钥保持不变。");
  // Wrangler invokes docker build with BuildKit-only --load/--provenance flags.
  // Scope this to our child processes; do not change shared Docker settings.
  env.DOCKER_BUILDKIT = "1";
  console.log(`Docker Buildx 可用：${buildx.stdout.trim()}`);

  console.log("[3/6] 构建并检查容器（首次可能需要数分钟）。");
  const architecture = (await run("docker", ["info", "--format", "{{.Architecture}}"], { capture: true })).stdout.trim();
  const nativeArch = ["aarch64", "arm64"].includes(architecture) ? "arm64"
    : ["x86_64", "amd64"].includes(architecture) ? "amd64" : undefined;
  if (!nativeArch) throw new Error(`Docker 架构不受支持：${architecture}`);
  const nativePlatform = `linux/${nativeArch}`;
  const image = `showai-mcp:chatgpt-check-${nativeArch}`;
  console.log(`本机使用 ${nativePlatform} 实测渲染；Cloudflare 使用 linux/amd64，并在启动时再次实测。`);
  await run("docker", ["build", "--load", "--provenance=false", "--platform", nativePlatform, "-f", "deployments/cloudflare/mcp.Dockerfile", "-t", image, "."]);
  const rendering = await run("docker", ["run", "--rm", "--platform", nativePlatform, "--network", "none", "--entrypoint", "node", image, "/app/scripts/browser-check.mjs"], { capture: true, allowFailure: true });
  await writeFile(join(handoff, "container-render-check.log"), rendering.stdout + rendering.stderr);
  if (rendering.code !== 0) {
    process.stderr.write(rendering.stderr || rendering.stdout);
    throw new Error(`本机原生容器渲染失败；完整日志已保存在 ${join(handoff, "container-render-check.log")}。`);
  }
  const localBrowserRendering = JSON.parse(rendering.stdout);
  if (localBrowserRendering.passed !== true || localBrowserRendering.architecture !== (nativeArch === "amd64" ? "x64" : "arm64")) throw new Error("本机渲染验证架构不一致。");
  await writeFile(join(handoff, "container-render-check.json"), `${JSON.stringify(localBrowserRendering, null, 2)}\n`);
  console.log("本机原生容器 Chromium 渲染通过。");

  console.log("[4/6] 检查存储和密钥；保留已有加密密钥。");
  await verifyCloudMcpRelease(source, manifest);
  const list = await wrangler(["r2", "bucket", "list"], { capture: true });
  const bucketExists = new RegExp(`^\\s*name:\\s*${bucket}\\s*$`, "im").test(list.stdout);
  const secrets = await wrangler(["secret", "list", "--format", "json", "--config", config], { capture: true, allowFailure: true });
  let secretExists = false;
  if (secrets.code === 0) secretExists = JSON.parse(secrets.stdout).some((s) => s.name === "SHOWAI_MCP_STATE_KEY");
  else if (!secrets.stderr.includes('Worker "showai-mcp" not found.') && !secrets.stdout.includes('Worker "showai-mcp" not found.')) {
    process.stderr.write(secrets.stderr || secrets.stdout);
    throw new Error("无法确认现有密钥，已停止。");
  }
  const ownership = await readJson(ownershipFile);
  const ownedBucket = ownership?.accountId === account.id && ownership?.bucket === bucket;
  const savedKey = await readJson(keyFile);
  if (savedKey && !/^[a-f0-9]{64}$/.test(savedKey.SHOWAI_MCP_STATE_KEY ?? "")) throw new Error("本地密钥备份无效。");
  if (bucketExists && !secretExists && !(ownedBucket && savedKey)) throw new Error("存储桶已经存在，但没有可确认的密钥。请把这条提示告诉我；不要重置或删除存储。");
  if (!bucketExists && secretExists) throw new Error("已有密钥但存储桶缺失。请把这条提示告诉我；不要重建后覆盖状态。");
  if (!bucketExists) {
    if (!savedKey) await savePrivate(keyFile, { SHOWAI_MCP_STATE_KEY: randomBytes(32).toString("hex") });
    await wrangler(["r2", "bucket", "create", bucket]);
    await savePrivate(ownershipFile, { accountId: account.id, bucket, createdAt: new Date().toISOString() });
  }
  const deployArgs = ["deploy", "--config", config];
  if (!secretExists) deployArgs.push("--secrets-file", keyFile);

  console.log("[5/6] 部署 ShowAI MCP。");
  await verifyCloudMcpRelease(source, manifest);
  const deployStartedAt = Date.now();
  await wrangler(deployArgs);
  console.log("[6/6] 等待新容器接管并验证 HTTPS、OAuth 和 MCP 工具（滚动替换旧容器可能需要十几分钟）。");
  let health;
  // A running instance keeps serving until Cloudflare replaces it, so only a
  // browser check rendered after this deployment proves the new image is live.
  const fresh = (value) => value?.ok && Date.parse(value.browserRendering?.checkedAt ?? "") > deployStartedAt;
  const healthDeadline = Date.now() + 30 * 60_000;
  while (Date.now() < healthDeadline) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(55000) });
      if (response.ok) { health = await response.json(); if (fresh(health)) break; }
    } catch { /* DNS, certificate or container may still be starting. */ }
    await new Promise((r) => setTimeout(r, 15000));
  }
  if (!fresh(health)) throw new Error(health?.ok ? "已提交部署，但旧容器仍在服务，新容器尚未接管。稍后检查 /health 的 browserRendering.checkedAt。" : "已提交部署，但健康检查尚未通过。请把终端最后的提示告诉我。");
  if (health.browserRendering?.passed !== true || health.browserRendering.architecture !== "x64") throw new Error("Cloudflare AMD64 容器的实际渲染检查尚未通过，不能确认部署完成。");
  async function json(url, options) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(55000) });
    if (!response.ok) throw new Error(`验证失败：${new URL(url).pathname}（${response.status}）。`);
    return response.json();
  }
  const authorization = await json(`${origin}/.well-known/oauth-authorization-server`);
  const resource = await json(`${origin}/.well-known/oauth-protected-resource`);
  if (authorization.issuer !== origin || resource.resource !== `${origin}/mcp`) throw new Error("OAuth 发现地址不一致。");
  const rpc = (id, method, params) => json(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const initialized = await rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ShowAI deployment check", version: "1" } });
  if (!initialized.result?.protocolVersion) throw new Error("MCP 初始化失败。");
  const tools = await rpc(2, "tools/list", {});
  if (!tools.result?.tools?.some((t) => t.name === "project_create")) throw new Error("MCP 新建项目工具缺失。");
  const upstream = await json(`${syncServer}/api/info`);
  const providers = Array.isArray(upstream.auth) ? upstream.auth : [];
  await writeFile(join(handoff, "deployment-result.json"), `${JSON.stringify({ deployed: true, endpoint: `${origin}/mcp`, verifiedAt: new Date().toISOString(), accountId: account.id, sourceCommit: manifest.baseCommit, sourceSnapshotSha256: integrity.sha256, browserRendering: true, localBrowserRendering, productionBrowserRendering: health.browserRendering, oauthDiscovery: true, mcpToolDiscovery: true, socialProviders: providers, realChatGPTAcceptance: false }, null, 2)}\n`);
  console.log(`\n部署和基础验证完成：${origin}/mcp`);
  console.log(`服务器登录方式：${providers.join(", ") || "未返回"}`);
  console.log("回到 ChatGPT 告诉我“部署好了”，我继续实际连接验证。");
}
main().catch((error) => { console.error(`\n${error.message}\n把终端最后的提示告诉我即可。不要发送密码、令牌或密钥文件。`); process.exitCode = 1; });
