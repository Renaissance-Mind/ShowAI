import { parseArgs } from "node:util";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { values } = parseArgs({
  options: {
    home: { type: "string" },
    project: { type: "string" },
    batch: { type: "string", default: "50" },
    rollback: { type: "boolean", default: false },
  },
});
if (!values.home || !isAbsolute(values.home))
  throw new Error("Provide --home with an absolute server data directory.");
const maximum = Number(values.batch);
if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000)
  throw new Error("--batch must be between 1 and 1000.");
const { SQLiteMetadata, DiskObjects, Revisions, prepareMetadata } =
  await import(pathToFileURL(resolve("dist-server/server.mjs")).href);
const db = new SQLiteMetadata(join(values.home, "metadata.sqlite"));
try {
  await prepareMetadata(db, true);
  const revisions = new Revisions(
    db,
    new DiskObjects(join(values.home, "objects")),
  );
  if (values.rollback) {
    if (!values.project)
      throw new Error(
        "Rollback requires --project and only affects retained inline manifests.",
      );
    const rows = await db.all(
      "SELECT revision FROM revisions WHERE project_id=? AND manifest_key IS NOT NULL AND manifest!=''",
      [values.project],
    );
    for (const row of rows)
      await revisions.snapshot(
        values.project,
        await revisions.row(values.project, row.revision),
      );
    const result = await db.run(
      "UPDATE revisions SET manifest_key=NULL,manifest_digest=NULL WHERE project_id=? AND manifest!=''",
      [values.project],
    );
    console.log(
      JSON.stringify({
        operation: "rollback-inline-manifests",
        restored: result.changes,
      }),
    );
  } else {
    let migrated = 0,
      inspected = 0;
    while (true) {
      const result = await revisions.migrateInline(values.project, maximum);
      migrated += result.migrated;
      inspected += result.inspected;
      if (!result.more) break;
    }
    console.log(
      JSON.stringify({
        operation: "migrate-inline-manifests",
        inspected,
        migrated,
      }),
    );
  }
} finally {
  db.close();
}
