import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    "key-file": { type: "string" },
    destination: { type: "string" },
    backup: { type: "string" },
    home: { type: "string" },
    resume: { type: "boolean" },
    epoch: { type: "string" },
    "retention-days": { type: "string" },
    apply: { type: "boolean", default: false },
    reservation: { type: "string", multiple: true },
    plan: { type: "string" },
  },
});
const operation = positionals[0];
const {
  exportServerBackup,
  verifyServerBackup,
  restoreServerBackup,
  operationsRequest,
  planServerCleanup,
} = await import(pathToFileURL(resolve("dist-server/server.mjs")).href);
let result;
if (operation === "plan-cleanup") {
  if (!values.backup || !values.destination)
    throw new Error(
      "plan-cleanup requires --backup and a new absolute --destination report file.",
    );
  result = await planServerCleanup({
    backup: values.backup,
    destination: values.destination,
    retentionDays: values["retention-days"]
      ? Number(values["retention-days"])
      : undefined,
  });
} else if (operation === "verify") {
  if (!values.backup) throw new Error("verify requires --backup.");
  result = await verifyServerBackup(values.backup);
} else if (operation === "restore") {
  if (!values.backup || !values.home)
    throw new Error("restore requires --backup and a new absolute --home.");
  result = await restoreServerBackup({
    backup: values.backup,
    home: values.home,
  });
} else if (
  ["export", "state", "freeze", "unfreeze", "reconcile", "cleanup"].includes(
    operation,
  )
) {
  if (!values.url || !values["key-file"])
    throw new Error("Operations require --url and --key-file.");
  const credential = (await readFile(values["key-file"], "utf8")).trim();
  if (operation === "export") {
    if (!values.destination)
      throw new Error(
        "export requires a new absolute --destination, or --resume with the original directory.",
      );
    result = await exportServerBackup({
      url: values.url,
      credential,
      destination: values.destination,
      resume: values.resume,
      onProgress: (message) => console.error(message),
    });
  } else {
    if (
      ["unfreeze", "reconcile", "cleanup"].includes(operation) &&
      !values.epoch
    )
      throw new Error("unfreeze requires the current --epoch.");
    let cleanupInput;
    if (operation === "cleanup") {
      if (!values.plan || !values.backup)
        throw new Error(
          "cleanup requires the verified --backup and --plan report.",
        );
      await verifyServerBackup(values.backup);
      const descriptorBytes = await readFile(values.backup + "/backup.json");
      const descriptor = JSON.parse(descriptorBytes);
      const [header, ...items] = (await readFile(values.plan, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      if (
        header.format !== "showai-cleanup-dry-run-v1" ||
        header.epoch !== values.epoch ||
        header.serverId !== descriptor.serverId ||
        header.backupSha256 !==
          createHash("sha256").update(descriptorBytes).digest("hex")
      )
        throw new Error(
          "Cleanup report does not match this frozen backup generation.",
        );
      const candidates = items
        .filter((item) => /\/\b(?:objects|manifests)\//.test(item.candidate))
        .slice(0, 20)
        .map((item) => ({
          key: item.candidate,
          bytes: item.bytes,
          sha256: item.sha256,
          uploadedAt: item.uploadedAt,
        }));
      cleanupInput = {
        candidates,
        retentionDays: header.retentionDays,
        apply: values.apply,
      };
    }
    const path =
      operation === "unfreeze"
        ? `/api/ops/resume?epoch=${encodeURIComponent(values.epoch)}`
        : operation === "reconcile"
          ? `/api/ops/reconcile?epoch=${encodeURIComponent(values.epoch)}`
          : operation === "cleanup"
            ? `/api/ops/cleanup?epoch=${encodeURIComponent(values.epoch)}`
            : `/api/ops/${operation}`;
    result = await (
      await operationsRequest(
        values.url,
        credential,
        path,
        operation === "state" ? "GET" : "POST",
        operation === "reconcile"
          ? { ids: values.reservation ?? [], apply: values.apply }
          : cleanupInput,
      )
    ).json();
  }
} else
  throw new Error(
    "Use export, verify, restore, plan-cleanup, state, freeze or unfreeze.",
  );
console.log(JSON.stringify({ operation, ...result }));
