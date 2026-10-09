import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
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
} else if (["export", "state", "freeze", "unfreeze"].includes(operation)) {
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
    if (operation === "unfreeze" && !values.epoch)
      throw new Error("unfreeze requires the current --epoch.");
    const path =
      operation === "unfreeze"
        ? `/api/ops/resume?epoch=${encodeURIComponent(values.epoch)}`
        : `/api/ops/${operation}`;
    result = await (
      await operationsRequest(
        values.url,
        credential,
        path,
        operation === "state" ? "GET" : "POST",
      )
    ).json();
  }
} else
  throw new Error(
    "Use export, verify, restore, plan-cleanup, state, freeze or unfreeze.",
  );
console.log(JSON.stringify({ operation, ...result }));
