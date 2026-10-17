ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_IMAGE} AS deps
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV DUGITE_CACHE_DIR=/tmp/showai-dugite-cache
COPY package.json package-lock.json ./
COPY scripts/download-cloud-git.mjs ./scripts/
COPY deployments/cloudflare/dugite-git-assets.json ./deployments/cloudflare/
RUN --mount=type=cache,target=/root/.npm node scripts/download-cloud-git.mjs && npm ci --maxsockets=4 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=30000
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV DUGITE_CACHE_DIR=/tmp/showai-dugite-cache
COPY package.json package-lock.json ./
COPY scripts/download-cloud-git.mjs ./scripts/
COPY deployments/cloudflare/dugite-git-assets.json ./deployments/cloudflare/
RUN --mount=type=cache,target=/root/.npm node scripts/download-cloud-git.mjs && npm ci --maxsockets=4 --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=30000
COPY src ./src
COPY scripts ./scripts
COPY resources ./resources
COPY plugins/showai ./plugins/showai
COPY public ./public
COPY deployments/cloudflare/agent-worker.mjs ./deployments/cloudflare/
COPY vite.portable.config.ts tsconfig.json portable.html LICENSE ./
RUN npm run build:portable && node scripts/build-remote-agent.mjs
FROM ${NODE_IMAGE}
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates bubblewrap && rm -rf /var/lib/apt/lists/*
ENV SHOWAI_BROWSER_EXECUTABLE=/usr/lib/chromium/chromium
RUN mkdir /state /runtime /download-cache && chown node:node /state /runtime /download-cache
COPY --from=build /build/dist-remote-agent/scripts/install-runtime.mjs /tmp/install-runtime.mjs
USER node
ARG SHOWAI_AGENT_SDK_VERSION=0.162.1
RUN --mount=type=cache,id=showai-agent-sdk-v1,target=/download-cache,uid=1000,gid=1000 SHOWAI_AGENT_SDK_VERSION=${SHOWAI_AGENT_SDK_VERSION} SHOWAI_AGENT_DOWNLOAD_CACHE=/download-cache node /tmp/install-runtime.mjs
COPY --from=deps /build/node_modules /app/node_modules
COPY --from=build /build/dist-remote-agent /app
USER root
RUN find /app -type d ! -perm -005 -exec chmod a+rx {} + && find /app -type f ! -perm -004 -exec chmod a+r {} +
USER node
RUN SHOWAI_CHECK_AGENT_PLUGIN=1 node /app/scripts/content-check.mjs
EXPOSE 8790
CMD ["node","/app/scripts/container.mjs"]
