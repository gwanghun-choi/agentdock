# AgentDock production image — single-server Docker deployment.
#
# Three stages so the runtime carries neither bun nor the build toolchain:
#   deps    installs from the committed lockfile only
#   build   produces .next/standalone via output:'standalone' in next.config.ts
#   runtime node + the traced runtime files, nothing else
#
# No credential is present at any stage. Every route is force-dynamic, so
# `next build` opens no database connection and DATABASE_URL is a runtime-only
# variable supplied by env_file — never an ARG, never an ENV in a layer.

FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder only. next.config.ts's routes are all force-dynamic so nothing
# connects, but src/env.ts parses at import time in some code paths and a
# syntactically valid URL keeps the build from tripping over a shape check.
# It is discarded with this stage and never reaches the runtime image.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# standalone puts server.js plus its traced node_modules at the root; static
# assets are not traced and must be copied alongside it.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
