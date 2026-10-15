import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/deploy-remote-agent.mjs <private-release-directory> [committed-revision]",
  );
const release = resolve(process.argv[2]),
  source = join(release, "source"),
  privateDirectory = join(release, "private");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" };
async function run(command, args, { cwd = source, allowFailure = false } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (value) => (stdout += value));
    child.stderr.on("data", (value) => (stderr += value));
    child.on("error", fail);
    child.on("exit", (code) => {
      if (code && !allowFailure)
        fail(
          new Error(
            `${command} ${args[0]} failed (${code}): ${stderr || stdout}`,
          ),
        );
      else done({ code, stdout, stderr });
    });
  });
}
await mkdir(release, { recursive: true, mode: 0o700 });
const revision = (
  await run("git", ["rev-parse", process.argv[3] ?? "HEAD"], {
    cwd: process.cwd(),
  })
).stdout.trim();
const archive = join(release, "source.tar");
await run("git", ["archive", "--format=tar", `--output=${archive}`, revision], {
  cwd: process.cwd(),
});
await mkdir(source, { recursive: true });
await run("tar", ["-xf", archive, "-C", source], { cwd: release });
const sourceHash = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(
  join(release, "source.json"),
  JSON.stringify(
    { revision, sourceHash, createdAt: new Date().toISOString() },
    null,
    2,
  ),
);
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
await chmod(privateDirectory, 0o700);
const config = "deployments/cloudflare/agent.wrangler.jsonc";
const wrangler = (args, options) =>
  run("npx", ["--yes", "wrangler@4.148.0", ...args], options);
const who = JSON.parse((await wrangler(["whoami", "--json"])).stdout);
if (!who.loggedIn || !who.accounts?.length)
  throw new Error("Cloudflare deployment login is required.");
const account = env.CLOUDFLARE_ACCOUNT_ID
  ? who.accounts.find((a) => a.id === env.CLOUDFLARE_ACCOUNT_ID)
  : who.accounts.length === 1
    ? who.accounts[0]
    : undefined;
if (!account)
  throw new Error("The configured ShowAI Cloud account is unavailable.");
env.CLOUDFLARE_ACCOUNT_ID = account.id;
const bucket = "showai-agent-state";
const buckets = (await wrangler(["r2", "bucket", "list"])).stdout;
const bucketExists = new RegExp(`name:\\s+${bucket}(?:\\s|$)`).test(buckets);
const secrets = await wrangler(
  ["secret", "list", "--format", "json", "--config", config],
  { allowFailure: true },
);
const keyExists =
  secrets.code === 0 &&
  JSON.parse(secrets.stdout).some((s) => s.name === "SHOWAI_AGENT_KEY");
if (
  secrets.code !== 0 &&
  !/Worker "showai-agent" not found/.test(secrets.stdout + secrets.stderr)
)
  throw new Error("Could not inspect existing Cloudflare secrets.");
const keyFile = join(privateDirectory, "secrets.json"),
  ownershipFile = join(privateDirectory, "ownership.json");
const optional = async (path) =>
  readFile(path, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
const ownership = await optional(ownershipFile),
  saved = await optional(keyFile);
if (
  bucketExists &&
  !keyExists &&
  !(ownership?.accountId === account.id && saved?.SHOWAI_AGENT_KEY)
)
  throw new Error(
    "An existing state bucket has no verified key. Preserve it and restore the original deployment secret.",
  );
if (keyExists && !bucketExists)
  throw new Error(
    "Existing encryption key has no state bucket. Preserve the deployment and investigate.",
  );
if (!keyExists && !saved) {
  await writeFile(
    keyFile,
    JSON.stringify({ SHOWAI_AGENT_KEY: randomBytes(32).toString("hex") }),
    { mode: 0o600, flag: "wx" },
  );
}
if (!bucketExists) {
  await wrangler(["r2", "bucket", "create", bucket]);
  await writeFile(
    ownershipFile,
    JSON.stringify({ accountId: account.id, bucket }),
    { mode: 0o600 },
  );
}
console.log(`Deploying ShowAI Agent from ${revision}.`);
const result = await wrangler([
  "deploy",
  "--config",
  config,
  "--var",
  `SHOWAI_AGENT_REVISION:${revision}`,
  ...(!keyExists ? ["--secrets-file", keyFile] : []),
]);
await writeFile(join(release, "deployment.log"), result.stdout + result.stderr);
const origin = "https://run.showai.renaissancemind.ai";
let health;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const response = await fetch(origin + "/health", {
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      health = await response.json();
      break;
    }
  } catch {
    /* Newly provisioned DNS or TLS is not ready yet. */
  }
  await new Promise((r) => setTimeout(r, 3000));
}
if (health?.service !== "showai-agent" || health.revision !== revision)
  throw new Error("Deployment was uploaded but HTTPS health has not passed.");
const operationsKey = (await optional(keyFile))?.SHOWAI_AGENT_KEY;
if (!operationsKey)
  throw new Error(
    "HTTPS is ready. Keep the original secret backup available to verify the actual Container runtime.",
  );
let container;
for (let attempt = 0; attempt < 24; attempt++) {
  try {
    const response = await fetch(origin + "/_operations/health", {
      method: "POST",
      headers: { authorization: `Bearer ${operationsKey}` },
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (response.ok) {
      container = await response.json();
      break;
    }
    if (response.status !== 503)
      throw new Error(`Container readiness failed (${response.status}).`);
  } catch (error) {
    if (!(error instanceof TypeError) && error.name !== "TimeoutError")
      throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (
  container?.runtime !== "ready" ||
  !container.browserRendering?.passed ||
  container.browserRendering.architecture !== "x64" ||
  !container.sandbox?.passed
)
  throw new Error(
    "The deployed Linux runtime, browser or sandbox has not passed readiness checks: " +
      JSON.stringify(container),
  );
const ticketResponse = await fetch(origin + "/_operations/relay-ticket", {
  method: "POST",
  headers: { authorization: `Bearer ${operationsKey}` },
  redirect: "error",
});
if (!ticketResponse.ok) throw new Error("WSS readiness ticket was not issued.");
const relayTicket = await ticketResponse.json();
await new Promise((resolve, reject) => {
  const socket = new WebSocket(
    origin.replace(/^https:/, "wss:") +
      `/devices/connect/${relayTicket.tenant}?ticket=${relayTicket.ticket}`,
  );
  let passed = false;
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("WSS relay readiness timed out."));
  }, 15000);
  socket.onopen = () => socket.send(JSON.stringify({ type: "ping" }));
  socket.onmessage = (event) => {
    if (JSON.parse(String(event.data)).type === "pong") {
      passed = true;
      clearTimeout(timer);
      socket.close(1000, "Verified");
      resolve();
    }
  };
  socket.onerror = () => {
    clearTimeout(timer);
    reject(new Error("WSS relay connection failed."));
  };
  socket.onclose = () => {
    if (!passed) {
      clearTimeout(timer);
      reject(new Error("WSS relay closed before verification."));
    }
  };
});
await writeFile(
  join(release, "deployment-result.json"),
  JSON.stringify(
    {
      revision,
      sourceHash,
      origin,
      health,
      container,
      wssRelay: true,
      verifiedAt: new Date().toISOString(),
      modelInvocationVerified: false,
    },
    null,
    2,
  ),
);
console.log(`ShowAI Agent HTTPS is ready: ${origin}`);
