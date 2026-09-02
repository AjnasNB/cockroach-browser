# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json server.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    COCKROACH_BROWSER_ROOT=/data \
    HOME=/tmp/cockroach-browser-home \
    XDG_CACHE_HOME=/tmp/cockroach-browser-cache \
    XDG_CONFIG_HOME=/tmp/cockroach-browser-config \
    XDG_RUNTIME_DIR=/tmp/cockroach-browser-runtime

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && node node_modules/playwright-core/cli.js install --with-deps chromium firefox webkit \
    && apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY server.json README.md SECURITY.md CHANGELOG.md LICENSE THIRD_PARTY_NOTICES.md ./
COPY dashboard ./dashboard
COPY examples ./examples
COPY schemas ./schemas
COPY scripts/docker-entrypoint.mjs ./scripts/docker-entrypoint.mjs

RUN mkdir -p /data \
    && chown -R node:node /data /app /ms-playwright

USER node

VOLUME ["/data"]
EXPOSE 43111

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const fs=require('node:fs'); const t=fs.readFileSync('/data/auth-token','utf8').trim(); fetch('http://127.0.0.1:43110/v1/health',{headers:{authorization:'Bearer '+t}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "scripts/docker-entrypoint.mjs"]
