# ShowAI Cloud

The official server base URL is **https://showai.renaissancemind.ai/cloud**.

Enter the base URL in ShowAI's existing **Settings → Servers and synchronization → Add server account** flow. Use an existing account or register with your own account name and password.

Initial registration is controlled by an operator-provided registration key; a project invitation can also authorize registration. The base URL includes `/cloud` and excludes `/api`.

## Projects and offline work

After signing in, the existing server project list can add a project to the local library. Existing local projects can select the cloud account in the project storage/synchronization settings. Project administrators manage editor/viewer permissions and invitations through the current project management panel. New projects use the storage account chosen in settings. Local copies support **offline editing**; successful authentication and network recovery let synchronization continue.

## Access and isolation

Accounts and device sessions belong to this server. Production and staging have independent databases, private object buckets, registration credentials, operations credentials and rate-limit namespaces.

The infrastructure operations key is used by backup and recovery tools; it is not an account registration key.

**Project data is protected** by authenticated membership checks and HTTPS. Infrastructure operators can access stored content; the service does not provide end-to-end encryption or general OIDC login.

## Storage and synchronization

The initial storage policy allows 1 GiB per project, 2 GiB of attributed uploads per account and 64 GiB for the service. Uploads reserve capacity before storage and preserve interrupted tasks. Objects are bounded at **64 MiB** and manifests at 16 MiB. Daily upload, request and download budgets control downstream work; reaching a limit preserves local content and returns an explicit error. Full legacy history and individual manifest reads share download-byte budgets, while summary history stays available.

The active client scheduler waits approximately one second after each successful round with jitter. Idle connections back off to approximately one minute, and errors to at most five minutes. Large-file transfer and complete document import can take longer than a project-head observation.

## Operations

Operators deploy from committed code using the production environment in `deployments/cloudflare/wrangler.jsonc`, apply the generated D1 migrations explicitly and install independent secrets through Wrangler. Buckets remain private. [Server operations](server-operations.md) describes consistent freeze/export, protected backups, Linux restore, retained uploads, controlled reconciliation, garbage-collection proof and rollback. A restored server starts frozen; **only the selected replica is reopened**.

The first production user chooses their own credentials through the normal application flow. The production registration key and infrastructure key are kept in protected operator files outside the repository.
