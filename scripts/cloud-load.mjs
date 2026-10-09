import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { connect, constants } from "node:http2";

const { values } = parseArgs({
  options: {
    fixture: { type: "string" },
    output: { type: "string" },
    "duration-ms": { type: "string", default: "90000" },
    transport: { type: "string", default: "fetch" },
  },
});
if (!values.fixture || !values.output)
  throw new Error("Specify --fixture PRIVATE_FILE --output REPORT_FILE.");
const fixture = JSON.parse(await readFile(values.fixture, "utf8"));
const { users, devices, projects } = fixture;
const base = new URL(fixture.base);
if (!["fetch", "http2"].includes(values.transport))
  throw new Error("Use --transport fetch or --transport http2.");
if (
  !["https:", "http:"].includes(base.protocol) ||
  (base.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw new Error(
    "Use HTTPS or a loopback test server without URL credentials.",
  );
const durationMs = Number(values["duration-ms"]);
if (!Number.isInteger(durationMs) || durationMs < 30000 || durationMs > 90000)
  throw new Error("The load window must be between 30 and 90 seconds.");
if (
  !Array.isArray(users) ||
  users.length !== 10 ||
  !Array.isArray(devices) ||
  devices.length !== 100 ||
  !Array.isArray(projects) ||
  projects.length !== 10 ||
  new Set(devices.map((d) => d.id)).size !== devices.length ||
  new Set(projects.map((p) => p.id)).size !== projects.length ||
  devices.some((d) => !/^[a-f0-9]{64}$/.test(d.token)) ||
  !/^[a-f0-9]{64}$/.test(users[0]?.token)
)
  throw new Error(
    "Provide ten test accounts, one hundred signed devices and ten existing shared test projects.",
  );

const limits = {
  devices: devices.length,
  accounts: users.length,
  projects: projects.length,
  durationMs,
  requests: 10000,
  uploadedBytes: 128 * 1024 * 1024,
  pollingMs: 1000,
  editIntervalMs: 10000,
  requestTimeoutMs: 15000,
};
const begun = Date.now(),
  errors = [],
  stages = [],
  visibility = [];
const seen = new Set(),
  published = new Map();
let requests = 0,
  uploadedBytes = 0,
  edits = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const session =
  values.transport === "http2"
    ? connect(base.origin, {
        settings: { initialWindowSize: 1024 * 1024, enablePush: false },
      })
    : undefined;
session?.once("connect", () => session.setLocalWindowSize(4 * 1024 * 1024));
let sessionError;
session?.on("error", (error) => {
  sessionError = error;
});
function http2Request(path, method, body, token, binary) {
  return new Promise((resolve, reject) => {
    if (sessionError || session.destroyed) {
      reject(sessionError ?? new Error("HTTP/2 connection closed."));
      return;
    }
    const stream = session.request({
      ":method": method,
      ":path": base.pathname.replace(/\/$/, "") + path,
      authorization: `Bearer ${token}`,
      ...(body === undefined
        ? {}
        : {
            "content-length": String(
              typeof body === "string"
                ? Buffer.byteLength(body)
                : body.byteLength,
            ),
          }),
      ...(body !== undefined && !binary
        ? { "content-type": "application/json" }
        : {}),
    });
    let status,
      bytes = 0,
      ended = false;
    const chunks = [];
    const deadline = setTimeout(() => {
      reject(new DOMException("Load request timed out.", "TimeoutError"));
      stream.close(constants.NGHTTP2_CANCEL);
    }, limits.requestTimeoutMs);
    stream.once("close", () => {
      clearTimeout(deadline);
      if (!ended)
        reject(new Error("HTTP/2 response closed before completion."));
    });
    stream.on("response", (headers) => {
      status = headers[":status"];
    });
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) {
        reject(new Error("Load response exceeds 512 KiB."));
        stream.close(constants.NGHTTP2_CANCEL);
      } else chunks.push(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => {
      ended = true;
      if (!status) reject(new Error("Missing HTTP/2 response status."));
      else resolve(new Response(Buffer.concat(chunks), { status }));
    });
    stream.end(body);
  });
}
const percentile = (values, quantile) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? null;
};
async function request(path, phase, method, data, token, binary = false) {
  if (++requests > limits.requests)
    throw new Error("Load request ceiling reached.");
  const body =
    data === undefined ? undefined : binary ? data : JSON.stringify(data);
  uploadedBytes +=
    typeof body === "string"
      ? Buffer.byteLength(body)
      : (body?.byteLength ?? 0);
  if (uploadedBytes > limits.uploadedBytes)
    throw new Error("Load upload ceiling reached.");
  const started = Date.now();
  try {
    const response = session
      ? await http2Request(path, method, body, token, binary)
      : await fetch(fixture.base.replace(/\/$/, "") + path, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(data !== undefined && !binary
              ? { "content-type": "application/json" }
              : {}),
          },
          body,
          signal: AbortSignal.timeout(limits.requestTimeoutMs),
        });
    const result = await response.json();
    stages.push({
      phase,
      status: response.status,
      elapsedMs: Date.now() - started,
    });
    if (!response.ok) {
      errors.push({
        phase,
        status: response.status,
        code: result.error?.code ?? "HTTP_ERROR",
      });
      throw new Error(`Load HTTP failure: ${response.status}`);
    }
    return result;
  } catch (error) {
    if (
      !errors.length ||
      !String(error.message).startsWith("Load HTTP failure:")
    )
      errors.push({ phase, status: 0, code: error.name ?? "NETWORK_ERROR" });
    throw error;
  }
}

let complete = false,
  failure;
try {
  const current = await request(
    "/api/projects/heads",
    "setup",
    "POST",
    { ids: projects.map((p) => p.id) },
    users[0].token,
  );
  if (current.projects.length !== projects.length)
    throw new Error("The fixture owner cannot access every test project.");
  for (const project of projects)
    project.head = current.projects.find((p) => p.id === project.id).head;
  const start = Date.now(),
    deadline = start + durationMs;
  const polling = async (device) => {
    while (Date.now() < deadline) {
      const round = Date.now();
      try {
        const result = await request(
          "/api/projects/heads",
          "heads",
          "POST",
          { ids: projects.map((p) => p.id) },
          device.token,
        );
        for (const project of result.projects) {
          const edit = published.get(project.head),
            identity = `${device.id}:${project.head}`;
          if (edit && !seen.has(identity)) {
            seen.add(identity);
            visibility.push(Date.now() - edit.started);
          }
        }
      } catch {
        // request() records every HTTP or transport failure in the report.
      }
      await sleep(limits.pollingMs);
    }
  };
  const editing = async () => {
    while (Date.now() < deadline - 15000) {
      await sleep(limits.editIntervalMs);
      if (Date.now() >= deadline - 15000) break;
      const project = projects[edits % projects.length],
        started = Date.now();
      const bytes = Buffer.from(
        JSON.stringify({
          id: project.id,
          name: `Bounded active edit ${randomUUID()}`,
        }),
      );
      const digest = createHash("sha256").update(bytes).digest("hex");
      try {
        await request(
          `/api/projects/${project.id}/objects/${digest}`,
          "object-upload",
          "PUT",
          bytes,
          users[0].token,
          true,
        );
        const snapshot = {
          format: "showai-project-sync-v2",
          projectId: project.id,
          parents: project.head ? [project.head] : [],
          files: { [`projects/${project.id}/project.json`]: digest },
          change: {
            at: new Date().toISOString(),
            actor: { kind: "system" },
            channel: "cli",
            operationId: randomUUID(),
            paths: [`projects/${project.id}/project.json`],
          },
        };
        const result = await request(
          `/api/projects/${project.id}/revisions`,
          "revision-publish",
          "POST",
          { snapshot, expected: project.head },
          users[0].token,
        );
        project.head = result.head;
        published.set(result.head, { started });
        stages.push({
          phase: "edit-publish",
          status: 200,
          elapsedMs: Date.now() - started,
        });
        edits++;
      } catch {
        // Failed edits are reported and never included in successful visibility.
      }
    }
  };
  await Promise.all([editing(), ...devices.map(polling)]);
  complete = true;
} catch (error) {
  failure = error.message;
}
const phaseTimings = {};
for (const phase of new Set(stages.map((s) => s.phase))) {
  const samples = stages
    .filter((s) => s.phase === phase && s.status === 200)
    .map((s) => s.elapsedMs);
  phaseTimings[phase] = {
    samples: samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
  };
}
const expected = edits * devices.length;
const report = {
  model:
    "100 real signed device sessions; ten shared projects; one-second wait after each batch-head round; synthetic metadata edits",
  base: fixture.base,
  transport:
    values.transport === "http2"
      ? "one TLS connection with independently authenticated HTTP/2 streams"
      : "Node fetch connection pool",
  transportConfiguration: session
    ? { streamWindowBytes: 1024 * 1024, connectionWindowBytes: 4 * 1024 * 1024 }
    : {},
  uploadMeasurement: "request body bytes; excludes transport headers",
  recordedAt: new Date().toISOString(),
  limits,
  complete,
  ...(failure ? { failure } : {}),
  elapsedMs: Date.now() - begun,
  requests,
  uploadedBytes,
  edits,
  phaseTimings,
  visibilitySamples: visibility.length,
  visibilityExpected: expected,
  missingVisibility: expected - visibility.length,
  visibilityP50Ms: percentile(visibility, 0.5),
  visibilityP95Ms: percentile(visibility, 0.95),
  errors,
  errorRate: errors.length / requests,
  passed:
    complete &&
    edits > 0 &&
    visibility.length === expected &&
    errors.length === 0 &&
    percentile(visibility, 0.95) <= 5000,
};
await writeFile(values.output, JSON.stringify(report, null, 2), {
  mode: 0o600,
});
session?.destroy();
console.log(
  JSON.stringify({
    ...report,
    errors: report.errors.slice(0, 10),
    errorCount: report.errors.length,
  }),
);
if (!report.passed) process.exitCode = 1;
