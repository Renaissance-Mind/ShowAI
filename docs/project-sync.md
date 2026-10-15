# Project server and synchronization

**Language:** English | [简体中文](i18n/project-sync.zh-CN.md) · [Documentation](README.md)

ShowAI Server shares current project content by **administrator, editor and viewer** membership. The creator is an administrator and each project retains at least one administrator. Accounts/device sessions belong to a server; membership determines project permissions.

## Connect and manage projects

**Settings → Servers and sync** contains:

- **Project sync:** per-project status/account, upload to a server, switch sync account, visibility on this device and disconnect; default save location affects subsequently created projects.
- **Server accounts:** login, server projects, account/device management and member invitations.
- **Account linking:** connect trusted accounts on multiple servers.

Disconnecting retains local content. Removing a member blocks later server access; downloaded copies remain on their device. The **Show on this device** switch changes local navigation/recents while retaining content and membership.

## Deploy a content server

Linux and Cloudflare use the same HTTP handler and sync protocol. Linux uses Node.js 24, SQLite and disk objects. Cloudflare uses SQLite Durable Objects and private R2, with D1 retained for older-deployment migration. Content storage verifies and distributes packages without executing uploaded component code.

```sh
npm run build:server
SHOWAI_SERVER_HOME=/absolute/private/data SHOWAI_SERVER_PORT=8788 node dist-server/server.mjs
```

| Variable                      | Purpose                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `SHOWAI_SERVER_HOST` / `PORT` | Default `127.0.0.1` / `8788`                                         |
| `SHOWAI_SERVER_HOME`          | Private service data                                                 |
| `SHOWAI_SERVER_NAME` / `URL`  | Display name and reachable canonical base URL                        |
| `SHOWAI_REGISTRATION_KEY`     | Controlled registration key                                          |
| `SHOWAI_REGISTRATION_MODE`    | Linux may explicitly select `open`; official Worker stays controlled |

The base URL may include `/cloud` and excludes `/api`. Reverse proxies preserve the prefix. `SHOWAI_SERVER_PATH_ALIASES='[""]'` can retain the old root while moving a Linux service to a prefixed canonical URL. Keep server identity, accounts, sessions and vault key when changing routes.

Docker/Compose files are under `deployments/server/`; mounted data must be writable by container UID 1000. A user systemd template is provided alongside them. Restrict data/environment file access to the service owner.

Cloudflare configuration is `deployments/cloudflare/wrangler.jsonc`. Prepare its D1 binding/migrations and private R2, install `SHOWAI_REGISTRATION_KEY`, `SHOWAI_OPERATIONS_KEY` and `SHOWAI_VAULT_KEY`, then follow the frozen D1-to-Durable bootstrap in [Server operations](server-operations.md). Existing deployments must preserve identity, vault key and storage. Deploying the MCP gateway or remote agent is a separate operation.

## Accounts, login and devices

Login supports account/password or existing Token; configured servers also support GitHub, Google and email code. New/changed passwords allow 12–1024 characters and retain leading/trailing spaces. Passwords use salted versioned PBKDF2. Legacy password behavior remains compatible; successful login upgrades its format marker.

Provider login returns a one-time completion code to the initiating ShowAI window before issuing a session. The code allows at most five attempts. Add/remove login methods or generate a personal Token from **Account & devices** after direct sign-in within 15 minutes; peer-restored sessions cannot authorize these changes. Provider-created accounts retain at least one method.

New device sessions expire after 30 days, personal Tokens after one year; at most 100 active sessions per account. The server stores Token digests. Inspect/revoke devices or change passwords in Account & devices. Password changes revoke older sessions. Sign out all devices includes connected bound servers and reports unreachable ones. Removed/revoked accounts require a new login; only naturally expired sessions may restore through linking. Local edits remain available while authentication is recovered.

Configure `SHOWAI_GITHUB_CLIENT_ID`/`SECRET`, `SHOWAI_GOOGLE_CLIENT_ID`/`SECRET`, or `SHOWAI_EMAIL_API_KEY`/`FROM` as appropriate. Provider callbacks are the base URL plus `/api/auth/callback/github` or `/google`.

For Linux with restricted Google egress, a trusted relay can use `SHOWAI_GOOGLE_RELAY_KEY` (64 hexadecimal characters) and `SHOWAI_GOOGLE_RELAY_REDIRECTS`; the restricted service uses the same key/client ID and `SHOWAI_GOOGLE_RELAY_URL`. Only code exchange and public signing keys pass through that relay; final identity checks remain at the initiating server.

## Linked services and model sources

Sign in once to each server and link the intended accounts. Short-lived signed grants issue a separate device session at each peer; original Tokens do not replicate. Unlinking propagates revocation and retains pending requests for offline peers. Treat bound services as trusted authorities for those accounts.

Agent settings show each model source's server/account/address. Server credentials are encrypted with AES-GCM. API sources and ChatGPT authorizations are supplied only to authenticated devices; the owning server controls ChatGPT refresh. An offline source cannot issue fresh credentials. Linux creates a private `vault.key`; Cloudflare needs `SHOWAI_VAULT_KEY`. Restores require the original key.

## Roles and invitations

Administrators manage membership, invitations and archive state; editors write; viewers read/download. Each request checks current permissions. The final administrator cannot leave or demote themselves. Authenticated users can create their own projects within policy limits.

New invitations default to seven days and 25 claims. They can be single-use, targeted, limited or unlimited; API expiry ranges from 1–30 days. Claim limits and invitation registration are transactional. Repeated claims by the same existing member do not consume another slot or change their role. Removed members cannot reuse a previously claimed link. The app defaults to revoking related live invitations when removing a member.

Paste an invite under **Project sync → Join shared project** or use its `showai://join` link. Preview the server/project/role, then sign in or register. Invitation registration needs no separate key. Existing connections use their saved reachable URL and verify server identity; a new device needs to reach the invite's URL. Infrastructure administration and project membership are separate authorities.

## Sync protocol and transport

The current protocol is `showai-project-sync-v2`, with `current-state-v1`. Devices send current Pages, exact component dependencies and assets; device drafts and local credentials stay local. New clients fetch a current snapshot. WebSocket notifications wake receivers and carry bounded small updates; HTTP transfers larger data and reconnect snapshots. The scheduler backs up lost events and coalesces wakeups. Explicit manual sync performs a full check.

`batch-heads-v1` supports up to 400 project IDs per request; older servers keep per-project checks. Unchanged local/project revisions avoid unnecessary scans. Upload concurrency is bounded to two objects and retries use immutable identities. `sync status` reports actual state, errors, remoteHead and process scheduler metrics. Local save completion does not prove server publication.

The server verifies objects/dependencies before conditionally publishing the current head. Offline edits coalesce. Clients keep a baseline, upload receipts and recovery drafts. Snapshot tokens detect concurrent publication; UTF-16 key sorting is locale-independent. Manifests allow 16 MiB, resource objects 64 MiB. Large object reads/writes stream with digest verification. Supporting clients use persistent resumable tasks for objects of at least 5 MiB, scoped by project/uploader with live permission checks.

Older inline Linux manifests can be migrated explicitly:

```sh
node scripts/migrate-server-manifests.mjs --home /absolute/server/data --batch 50
node scripts/migrate-server-manifests.mjs --home /absolute/server/data --project PROJECT_ID --rollback
```

Rollback requires retained inline originals. Full backup/restore is a separate verified operation.

## Quotas, errors and recovery

Default storage is 1 GiB/project, 2 GiB/account and 64 GiB/service. Daily upload budgets are 1 GiB/account, 16 GiB/service and 50,000/250,000 new uploads respectively. Project counts default to 50/account and 10,000/service. `SHOWAI_STORAGE_POLICY` sets projectBytes/accountBytes/serviceBytes, accountDailyBytes/serviceDailyBytes, accountDailyUploads/serviceDailyUploads and accountProjects/serviceProjects. Historical unknown uploaders/creators remain unknown while counting toward applicable totals.

Reservations include unfinished writes. Quota failure preserves local edits. Server maintenance reconciles reservations and verified unreachable objects; application budgets do not impose a provider invoice cap. Request/read budgets are documented in [Server operations](server-operations.md).

Before importing remote changes, the client retains complete recovery inputs and digests. Independent fields merge; incompatible cross-device edits preserve both versions as source-labeled normal Pages and continue sync. `sync retained PROJECT --json` lists records. Delete/edit conflicts retain the edit and deletion origin; non-Page conflicts retain raw inputs and an explanatory Page. Repeated identical conflicts do not create duplicates.

Same-device stale writes fail with `CONFLICT`, saveFailed and recovery/nextStep information. Compare and resolve while retaining the draft; simply refreshing the base token is unsafe. Unresolved local file conflicts pause publication with `save-failed`. App/CLI share project-level synchronization locking and reconcile interrupted upload acknowledgments before continuing.

Import validates project identity, paths, object digests and exact dependencies. Components are stored in the target project's dependency area. Remote payloads cannot write device bindings, other projects, internal sync files or filesystem aliases. Servers with identical project IDs map separately; switching accounts on one server reuses the local project identity.

## Access controls

Login/registration/invitation requests use atomic source/account/global budgets and return 429 with Retry-After. Linux ignores forged forwarded addresses; trusted proxies use matching `SHOWAI_TRUSTED_PROXY_KEY`/`PROXY_KEY`. `SHOWAI_ALLOWED_ORIGINS` permits explicitly named browser origins. Secret-free audit records cover account/session/member/invite changes. HTTPS and current membership protect transport/access; infrastructure operators can read stored content and vault keys. The service does not provide end-to-end encryption.
