# Server backup and migration

Linux and Cloudflare use the same operations protocol and application metadata. A consistent backup contains all accounts, password formats, device session digests and expiry/revocation state, memberships, invitation claims, quota reservations, upload tasks, complete revision graphs and the private object inventory. Infrastructure secrets stay in the deployment environment. The server identity remains unchanged on restore.

Set `SHOWAI_OPERATIONS_KEY` to 32 random bytes encoded as 64 lowercase hexadecimal characters. It is an infrastructure credential independent of user passwords and sessions. Without it, operations endpoints return 404. Keep its source file private; use HTTPS for remote access or a loopback connection through SSH. Cloudflare environments need independent keys installed with Wrangler secrets. The [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#bucket-method-definitions) supplies the paginated object inventory.

The backup tool creates a new directory with mode 0700 and files with mode 0600. Backups contain password hashes and session metadata. Copy them through a protected channel and retain access controls on the destination. Run the restore under the same filesystem owner as the Node service.

## Consistent export

Build the current server and explicitly name a new absolute backup directory:

```sh
npm run build:server
node scripts/server-backup.mjs export --url https://showai.renaissancemind.ai/cloud-staging --key-file /private/staging-operations.key --destination /private/backups/showai-staging-2026-10-09
node scripts/server-backup.mjs verify --backup /private/backups/showai-staging-2026-10-09
```

Export freezes the source and waits for admitted object/manifest writes to finish. Database triggers reject subsequent application writes, including writes started before the freeze. Physical object writes have durable admission records. Objects and metadata are copied only after those records drain to zero. The source remains frozen after completion or failure. The JSON receipt reports its `serverId`, counts and verified bytes; the complete generation and per-file digests are in `backup.json`.

Table export uses stable cursors with bounded pages. Large retained inline manifests are exported separately within the manifest limit. Object copies stream through a bounded buffer and record their complete SHA-256 digest. Verification checks every physical object, metadata file, ready-object reference, retained upload part, manifest, parent sequence, reader and owned dependency closure. Restore also checks account/source identity and foreign keys. Completed uploads can retain cleanup bookkeeping after a crash; only unfinished tasks require their parts to remain available.

An interrupted export can reuse the original generation and verified files:

```sh
node scripts/server-backup.mjs export --url https://showai.renaissancemind.ai/cloud-staging --key-file /private/staging-operations.key --destination /private/backups/showai-staging-2026-10-09 --resume
```

Resume fails when the source was reopened or the frozen generation changed. Active admission records are never silently expired. If export still reports draining after its deadline, inspect the isolated runtime and retained records before recovering it; a timeout alone does not prove that an object write stopped. Public request bodies have a two-minute transfer deadline. Login and other metadata-only writes remain fenced by the database rather than consuming object-write admission slots.

## Restore and switch

Copy the complete backup to the target Linux host, then restore into a new directory:

```sh
node scripts/server-backup.mjs restore --backup /private/backups/showai-staging-2026-10-09 --home /srv/showai/restored-data
```

The tool refuses an existing destination, verifies the archive, creates and checks the copied objects and metadata, and publishes the new directory after completion. The restored database stays frozen. Start Node with `SHOWAI_SERVER_HOME` set to this directory, a target `SHOWAI_SERVER_URL` retaining the base prefix, and the target operations key. A reverse proxy must preserve the prefix.

Check `/api/info`, existing valid sessions and project roles on the target. Confirm that source writes remain frozen and that the target contains the advertised history and object counts. Then reopen only the chosen target, using the generation returned by restore or `state`:

```sh
node scripts/server-backup.mjs state --url https://target.example/cloud --key-file /private/target-operations.key
node scripts/server-backup.mjs unfreeze --url https://target.example/cloud --key-file /private/target-operations.key --epoch CURRENT_FROZEN_GENERATION
```

Clients reconnect to the target using their existing account/token. Matching `serverId` and user identity preserve connection IDs, project bindings, default connection and immutable caches. Original valid tokens remain valid; expired or revoked sessions retain their state. Verify continued synchronization from two independent content libraries and viewer restrictions before changing the public route.

For rollback, freeze and export any new target writes first. Close or keep that target frozen, restore the complete latest backup into a new source directory, verify it and reopen the chosen source. Do not route two writable copies of the same server identity. Reopening a pre-migration source after the target accepted new changes would omit those changes.

## Reachability report

A dry-run can report old, unreferenced objects from a verified frozen backup:

```sh
node scripts/server-backup.mjs plan-cleanup --backup /private/backups/showai-staging-2026-10-09 --destination /private/backups/cleanup-plan.ndjson --retention-days 30
```

The report identifies its backup digest and frozen generation. It protects files from every revision, including unpublished and archived history, all manifest pointers, quota reservations and upload tasks/parts. Objects without a usable age remain protected; the minimum retention is 30 days. The command deletes zero objects. Live deletion and verified reconciliation of interrupted quota reservations require a separate controlled maintenance operation; they are not implemented by this reporting command.
