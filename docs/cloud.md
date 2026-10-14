# ShowAI Cloud

The official server base URL is **https://showai.renaissancemind.ai/cloud**. Enter this address in **Settings → Servers and synchronization → Add server account**. The base URL includes `/cloud` and excludes `/api`.

## Accounts and bound services

Sign in with an existing Token or account/password. Private servers can register an account and issue a personal Token directly. GitHub, Google and email-code login appear when the server operator has configured those providers. Controlled registration requires an operator registration key or the supported project invitation flow.

After GitHub or Google authorization, the browser shows a one-time completion code and an **Open in ShowAI** link. The server resolves the account only after the ShowAI window that started the login returns that code, so a forwarded authorization link cannot sign in another person's account.

To add or remove GitHub, Google or email login on an existing account, open **Account and devices** for that server. Adding or removing a login method and creating a personal Token require a direct sign-in to that server within the last 15 minutes; sessions restored through a bound server cannot do this. Complete verification and, for GitHub or Google, confirm the account binding in the browser and enter the completion code in ShowAI. Subsequent sign-ins use the same account and retain its projects and server bindings. Accounts created through a provider keep at least one login method.

Sign in to each service once, then select the accounts in **Account bindings**. A new device can subsequently sign in to any member and restore the other bound services. Each service issues its own expiring device session from a short-lived, signed authorization; original login Tokens are not distributed between servers. Inspect or revoke sessions in **Account and devices**. **Sign out all devices** also signs out the bound servers this device is connected to and lists any it could not reach. Removing a connection ends its server session. Bound servers never restore an account that was signed out or revoked; only naturally expired sessions are restored. Personal Tokens expire after one year; normal and restored device sessions expire after 30 days.

Binding grants access to the selected accounts, including their projects and model resources. Bind only services you trust to hold this authority. Unbinding revokes device sessions issued through that peer. Offline services retain a pending revocation until they are reachable and authorized again; revocation is complete only after every target confirms it.

## Projects and model resources

Add remote projects from the server project list, or connect an existing local project through its storage/synchronization settings. Administrators manage editor/viewer permissions and invitations in the project panel. Local copies support offline editing and resume synchronization after authentication and network recovery.

**Projects shown on this device** controls the local navigation and recent-page list independently on each device. Hiding a project retains its content and server membership.

In **Settings → Agent**, retrieve server model resources. Each API Key or ChatGPT authorization shows its source server and account. Select a resource to use it, or save an existing local source to a chosen server. The source server encrypts the credential and supplies it to authenticated devices when needed. ChatGPT refresh remains owned by that source server. An unavailable source is reported explicitly; credentials are not replicated across the bound group.

## Storage and synchronization

Clients use SQLite current content with stable nodes, reusable objects, concurrency tokens and local recovery journals. Local saving completes independently of network publication. Connected services push verified project changes over WebSockets, with bounded inline content and HTTP transfer for larger revisions. The scheduler continues as a fallback when the event connection is unavailable. Idle connections and failed requests use bounded backoff; local file changes, foreground activity and network recovery wake synchronization.

Publications and pushed revisions carry only the paths that changed since the current head, so an edit stays small on large projects; the server rebuilds and verifies the complete manifest, and clients fall back to complete snapshots when either side lacks the earlier state. Linux runs the shared server on Node.js 24 with SQLite and disk objects. Cloudflare runs the same protocol with a SQLite Durable Object and private R2, including a bounded hot object store. Objects above 256 KiB stream between the Worker and R2 directly: the Durable Object authorizes and charges each read and admits, commits or aborts each write, but does not carry the bytes. D1 is retained as the source of a controlled migration from older deployments. Production and staging have independent identities, databases, buckets, vault keys and infrastructure credentials.

The default policy permits 1 GiB per project, 2 GiB of attributed uploads per account and 64 GiB per service. Objects are limited to **64 MiB** and manifests to 16 MiB. Uploads reserve capacity and retain interrupted tasks for 24 hours; a reservation left by a crashed request is released after 15 minutes. The service-wide total is sampled once a minute, so it can briefly exceed its ceiling by one minute of uploads; project and account totals are exact. Quota or budget failures preserve local edits and return an explicit error.

## Operations and access

Deploy committed code with `deployments/cloudflare/wrangler.jsonc`. [Server operations](server-operations.md) covers schema migration, consistent export, protected vault-key backups, Linux restore, migration into the Durable Object and rollback. Reopen only the chosen replica after a verified restore.

Content is protected by authenticated project membership and HTTPS. Infrastructure operators can access stored content and the vault key; the service does not provide end-to-end encryption. Account Tokens and infrastructure operations credentials have separate purposes. Keep all deployment credentials outside the repository.
