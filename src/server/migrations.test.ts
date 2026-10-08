import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteMetadata } from "./node";
import { schema } from "./storage";
import { prepareMetadata } from "./migrations";

test("a legacy database upgrades once and preserves identity, session bytes and invitation receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-migration-"));
  const db = new SQLiteMetadata(join(directory, "metadata.sqlite"));
  try {
    for (const sql of schema) await db.run(sql);
    await db.run(
      "INSERT INTO settings(key,value) VALUES('server_id','existing-server')",
    );
    await db.run(
      "INSERT INTO users VALUES('user','name','salt','hash','2026-01-01')",
    );
    await db.run(
      "INSERT INTO sessions VALUES('digest','user','device','2026-01-01','2027-01-01',0)",
    );
    await db.run(
      "INSERT INTO projects VALUES('project','name',NULL,0,'2026-01-01')",
    );
    await db.run(
      "INSERT INTO invites VALUES('invite','project','viewer','user','2027-01-01','user',0)",
    );
    const session = await db.all(
      "SELECT digest,user_id,device,created_at,expires_at,revoked FROM sessions",
    );
    await expect(prepareMetadata(db, false)).rejects.toThrow("migrations");
    await prepareMetadata(db, true);
    expect(
      await db.all("SELECT value FROM settings WHERE key='server_id'"),
    ).toEqual([{ value: "existing-server" }]);
    expect(
      await db.all(
        "SELECT digest,user_id,device,created_at,expires_at,revoked FROM sessions",
      ),
    ).toEqual(session);
    expect(await db.all("SELECT * FROM invite_acceptances")).toEqual([
      { digest: "invite", user_id: "user" },
    ]);
    const before = await db.all("SELECT total_changes() AS changed");
    await prepareMetadata(db, true);
    await prepareMetadata(db, false);
    expect(await db.all("SELECT total_changes() AS changed")).toEqual(before);
  } finally {
    db.close();
    await rm(directory, { recursive: true });
  }
});
