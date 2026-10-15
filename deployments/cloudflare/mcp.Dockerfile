# Dependencies with native binaries (dugite's Git, esbuild) install for the
# target platform. Under emulation this stage only runs npm ci.
FROM node:24-bookworm-slim AS deps
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV DUGITE_CACHE_DIR=/tmp/showai-dugite-cache
COPY package.json package-lock.json ./
COPY scripts/download-cloud-git.mjs ./scripts/
COPY deployments/cloudflare/dugite-git-assets.json ./deployments/cloudflare/
# Keep npm lifecycle scripts, including dugite's verified Git extraction.
# Pre-fetch atomically because dugite's downloader cannot retry interrupted bodies.
RUN node scripts/download-cloud-git.mjs && npm ci && node scripts/download-cloud-git.mjs --verify-installed && rm -rf /tmp/showai-dugite-cache

# The gateway bundle and reader assets are platform-independent; build them
# natively so an emulated amd64 build does not run Vite under qemu.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV DUGITE_CACHE_DIR=/tmp/showai-dugite-cache
COPY package.json package-lock.json ./
COPY scripts/download-cloud-git.mjs ./scripts/
COPY deployments/cloudflare/dugite-git-assets.json ./deployments/cloudflare/
RUN node scripts/download-cloud-git.mjs && npm ci && rm -rf /tmp/showai-dugite-cache
COPY src ./src
COPY scripts ./scripts
COPY resources ./resources
COPY plugins/showai/skills ./plugins/showai/skills
COPY public ./public
COPY deployments/cloudflare/mcp-worker.mjs deployments/cloudflare/mcp-state-broker.mjs ./deployments/cloudflare/
COPY vite.portable.config.ts tsconfig.json index.html portable.html LICENSE ./
# The CDN reader manifest lets oversized previews fall back to ShowAI's reader source.
RUN npm run build:portable && npm run build:cdn && node scripts/build-cloud-mcp.mjs

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
# Use the actual executable: Debian's /usr/bin wrapper checks /proc/cpuinfo,
# which describes the ARM kernel when this amd64 image runs under qemu-user.
ENV SHOWAI_BROWSER_EXECUTABLE=/usr/lib/chromium/chromium
COPY --from=build /build/dist-cloud-mcp /app
COPY --from=deps /build/node_modules /app/node_modules
RUN mkdir /state && chown node:node /state
USER node
# Project history needs Git; verify the actual runtime binary and shared libraries.
RUN node --input-type=module -e 'import { exec } from "dugite"; const r = await exec(["--version"], "/app"); if (r.exitCode !== 0) throw new Error(r.stderr); console.log(r.stdout);'
# Create, list and search a page with the bundled files, including the content worker.
RUN node /app/scripts/content-check.mjs
EXPOSE 8789
CMD ["node", "/app/scripts/gateway.mjs"]
