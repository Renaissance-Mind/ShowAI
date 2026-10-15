FROM node:24-bookworm-slim AS deps
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV DUGITE_CACHE_DIR=/tmp/showai-dugite-cache
COPY package.json package-lock.json ./
COPY scripts/download-cloud-git.mjs ./scripts/
COPY deployments/cloudflare/dugite-git-assets.json ./deployments/cloudflare/
RUN node scripts/download-cloud-git.mjs && npm ci
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV DUGITE_CACHE_DIR=/tmp/showai-dugite-cache
COPY package.json package-lock.json ./
COPY scripts/download-cloud-git.mjs ./scripts/
COPY deployments/cloudflare/dugite-git-assets.json ./deployments/cloudflare/
RUN node scripts/download-cloud-git.mjs && npm ci
COPY src ./src
COPY scripts ./scripts
COPY resources ./resources
COPY plugins/showai ./plugins/showai
COPY public ./public
COPY deployments/cloudflare/agent-worker.mjs ./deployments/cloudflare/
COPY vite.portable.config.ts tsconfig.json portable.html LICENSE ./
RUN npm run build:portable && node scripts/build-remote-agent.mjs
FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates bubblewrap && rm -rf /var/lib/apt/lists/*
ENV SHOWAI_BROWSER_EXECUTABLE=/usr/lib/chromium/chromium
COPY --from=build /build/dist-remote-agent /app
COPY --from=deps /build/node_modules /app/node_modules
RUN mkdir /state /runtime && chown node:node /state /runtime
USER node
RUN node /app/scripts/container.mjs --install-runtime
EXPOSE 8790
CMD ["node","/app/scripts/container.mjs"]
