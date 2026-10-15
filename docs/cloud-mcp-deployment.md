# ShowAI MCP on Cloudflare

This deploys the MCP gateway entirely on Cloudflare, alongside the existing ShowAI Cloud content server. The runtime uses Workers, a single Container and encrypted R2 checkpoints. It is separate from `deployments/cloudflare/wrangler.jsonc` and does not replace the content server.

In the prepared terminal workflow, Docker on the administrator's computer builds a native verification image, then Wrangler builds and uploads the production AMD64 image. The computer does not host the deployed service. Once deployment and acceptance succeed, the computer can shut down. Cloudflare Workers Builds can also build Dockerfile images from a connected production Git branch, so local Docker is a choice of build workflow rather than a hosting requirement: https://developers.cloudflare.com/containers/guides/deploy/ .

The gateway bundle and reader assets do not depend on the CPU, so the Dockerfile builds them on the build platform; only `npm ci` runs for the `linux/amd64` target, keeping native dependencies such as dugite’s Git and esbuild correct without running Vite under emulation. The image pre-downloads dugite's embedded Git for its actual Linux architecture before `npm ci`. Downloads use bounded retries and temporary files, and only enter `DUGITE_CACHE_DIR` after matching the SHA256 supplied by the locked dugite package. All npm lifecycle scripts remain enabled. The asset metadata is pinned to dugite's package version and npm integrity; refresh it from the exact locked package when upgrading dugite. The final image also executes Git to verify its runtime dependencies. Prepared release deployments verify both their source overlays and the complete Docker COPY input inventory before building and deploying.

## Prerequisites

- A Cloudflare account with the target zone, Workers/Containers/R2 access, and an authenticated Wrangler session.
- A working Docker daemon capable of building `linux/amd64` images.
- Docker Buildx (`docker buildx version` must succeed). Wrangler passes `--load` and `--provenance=false` to `docker build`; the legacy builder cannot handle these flags. For a Homebrew Docker/Colima setup, install `docker-buildx` and include Homebrew's `lib/docker/cli-plugins` in Docker's `cliPluginsExtraDirs`. The deployment script checks this prerequisite before building or touching storage and enables BuildKit only for its child processes.
- Node.js 24 and repository dependencies, or the Docker build environment.
- Existing ShowAI Cloud accounts. GitHub/Google login must be configured on that content server, and each existing user must bind the selected identity to their account.

The proposed public endpoint is `https://agent.showai.renaissancemind.ai/mcp`. It is not an assertion that this endpoint has been published or verified. Change both `SHOWAI_MCP_URL` and the custom-domain route together if a different origin is used.

## Shared Skills through remote MCP

The HTTP gateway provides the workflows from `plugins/showai/skills` through its existing `guide` tool. A ChatGPT web user can add the remote MCP connection without installing a Skill package. The gateway's initialization instructions direct the model to `guide()` for the connection entrypoint and the seven workflow routes. This is tool-delivered guidance; it does not register native Skills in the host.

Use `guide({skill:"show-document"})` to read a workflow, and `guide({skill:"use-showai",file:"references/runtime.md",section:"远程"})` to read a referenced file. Relative Markdown links are returned as callable `guide` references. A section hint identifies a heading in the complete file. Each response includes the original source path and SHA256, the delivered text hash, and the available reference files. Pass `knownHash` only for the exact text already held in the current conversation. The existing `topic` and presentation `stage` parameters still read operation and template guidance; do not combine them with `skill`/`file`.

Workflow responses also identify the exact MCP URL and its exposed tool names. A host may initially load only a subset of those tool definitions. If a required tool is listed, use the host's discovery mechanism scoped to that selected connection before treating it as missing. Tool discovery does not grant OAuth scopes or project permissions; report those errors separately. Multiple installed ShowAI connections remain distinct.

`npm run build:cloud-mcp` generates the import index directly from the canonical Skill and reference files, then embeds those files into the gateway bundle. It does not modify or install the local plugin. The Docker build and release integrity inventory include these source files. Remote context rules select the HTTP/OAuth branches of shared instructions: local library configuration, unavailable tools and shell commands do not become remote capabilities. Scripts are available as reference text; a host without script execution uses the documented manual checks.

Refresh the custom MCP connection in ChatGPT after a gateway update, then start a new chat. Verify the plugin contains only the MCP app, inspect actual tool calls for guide loading, and check read-only lookup, page creation and continuation, selected-block display, component/template workflows and unavailable library/history operations. Installation, model guideline selection, saved content, synchronization and visible presentation require separate evidence.

## Build and verify

```sh
npm run build:cloud-mcp
npm run check
npm run test:cloud-mcp
npx wrangler@4.148.0 deploy --dry-run --config deployments/cloudflare/mcp.wrangler.jsonc
```

A Worker-only configuration check can use `--containers-rollout=none` with `--dry-run`; this does not build or verify the Container image. The complete test suite includes Board image rendering and requires a permitted Chromium runtime.

The Container sets `SHOWAI_BROWSER_EXECUTABLE` to Debian's actual `/usr/lib/chromium/chromium` binary. Its `/usr/bin/chromium` wrapper checks `/proc/cpuinfo`, which can expose the ARM kernel's features when an AMD64 image is run through user-mode emulation on Apple Silicon and report missing SSE3 before starting Chromium. Chromium can also fail under that emulation after the wrapper is avoided. The deployment script queries the Docker daemon's architecture and tests a native `linux/arm64` or `linux/amd64` image instead. It records `container-render-check.log` and `container-render-check.json` in the handoff directory.

Wrangler still builds the production image for Cloudflare's `linux/amd64` runtime. On every gateway startup, the same browser check must render a real screenshot before the MCP server starts listening. `/health` includes `browserRendering` with `passed`, `architecture` and `checkedAt`; deployment acceptance requires `passed: true` and `architecture: "x64"` from that actual production container. A native local check alone cannot establish successful production rendering. Browser startup or screenshot failure keeps the service unready.

## First deployment

Deployments are built from one committed revision, never from the shared working tree. Prepare a new handoff directory outside the repository, then run the deployment in your own terminal:

```sh
node scripts/prepare-cloud-mcp-release.mjs <handoff-directory> <commit>
node scripts/deploy-cloud-mcp.mjs <handoff-directory>
```

The first command exports the commit to `<handoff-directory>/release-source` and records the SHA256 of every Docker COPY input. The deployment script verifies that inventory before building and again before deploying, completes Wrangler login if needed, checks Docker and actual container Chromium rendering, preserves existing state secrets, deploys, waits until a container started after this deployment reports a fresh production browser check (a running instance keeps serving until Cloudflare replaces it), and writes `deployment-result.json` after HTTPS/OAuth/MCP discovery checks. On a first deployment a new key backup is stored under `<handoff-directory>/private`; never share it or lose it. Later deployments reuse the existing Worker secret and bucket. The deployment result is not a substitute for real ChatGPT and social-login acceptance.

Before starting Colima, the script checks an existing default-instance disk lock, confirms the instance is stopped, checks the disk owner and refuses a live host-agent PID before using `limactl disk unlock colima`. Recovery does not depend on logs or file timestamps: the host-agent's final log may appear after Colima exits. It retains the VM and disk data. New startup failures are reported, with a short bounded wait for their error details.

From the repository root:

```sh
npx wrangler@4.148.0 login
npx wrangler@4.148.0 whoami
npx wrangler@4.148.0 r2 bucket create showai-mcp-state
npx wrangler@4.148.0 secret put SHOWAI_MCP_STATE_KEY --config deployments/cloudflare/mcp.wrangler.jsonc
npx wrangler@4.148.0 deploy --config deployments/cloudflare/mcp.wrangler.jsonc
```

For `SHOWAI_MCP_STATE_KEY`, generate 32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters, enter it privately and keep a protected backup. Check whether the bucket and secret already exist before first-deployment commands. Do not regenerate or replace an existing key when updating: it encrypts existing authorization and project recovery checkpoints. Never commit credentials or put them in the plugin.

The content server’s existing GitHub/Google configuration remains authoritative. Its provider callback addresses are `/cloud/api/auth/callback/github` and `/cloud/api/auth/callback/google` on the ShowAI Cloud origin. If these providers are not enabled in `/cloud/api/info`, configure their OAuth apps and the existing `SHOWAI_GITHUB_CLIENT_ID`/`SECRET` and `SHOWAI_GOOGLE_CLIENT_ID`/`SECRET` settings before advertising social login. Follow existing account binding and controlled registration rules.

## Required acceptance before sharing the endpoint

1. Check `/health`, OAuth discovery, client registration and actual MCP tool discovery over the final HTTPS origin.
2. In ChatGPT, connect the endpoint; finish real GitHub and Google login and confirm the intended existing ShowAI account.
3. Select account-wide authorization, including `projects.create`. List projects and verify member roles.
4. Create a project with a retained operationId. Retry it and verify one server project, then create/read/edit a page and verify the synchronized server result.
5. From a separate local ShowAI library, create and synchronize another project under the same server account. Confirm the existing ChatGPT grant discovers it without relinking.
6. Confirm a viewer cannot write, unrelated accounts cannot access projects, revoked membership is enforced, and disconnecting/revoking the OAuth grant blocks later calls.
7. Restart/sleep the Container and verify the authorization, projects, retained recovery data and unexpired preview survive. Verify wrong-key and unavailable-state failures refuse success.
8. Confirm the actual ChatGPT reader and download delivery work. Record the final endpoint and deployed image/Worker identifiers.

## Operations and limitations

The initial deployment serializes requests through one gateway Container. This provides predictable checkpoint ordering; it is not a claim of load-tested scaling. State is checkpointed in encrypted, content-addressed chunks; unreferenced chunks are retained until a separately reviewed garbage collector exists. Do not configure age-based deletion for live state objects.

The state key, R2 bucket and gateway configuration belong together. Retain them when redeploying. A nonempty restoration directory, missing chunk, decryption error or checkpoint failure is a recoverable operational error and must not be bypassed by discarding private state. Server upstream sessions still have their normal expiry; account-wide project authorization does not extend session lifetime.

The remote project creation idempotency receipt is stored with the gateway state. Once a creation response succeeds, reusing the same operationId and name returns that project. A different name with the same operationId is rejected. Check server results after interrupted requests; retain gateway recovery state.
