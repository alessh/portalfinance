# syntax=docker/dockerfile:1.7
#
# Portal Finance container image -- one image, three services.
#
# Plan 01.1-03 / D-09, D-10, D-12. Built ONCE, deployed three times
# by Copilot (web, worker, migrate). The Copilot service manifest
# overrides CMD per service; ENTRYPOINT is shared.
#
# Stages:
#   deps    -- pnpm install --frozen-lockfile (argon2 needs build-essentials)
#   builder -- pnpm build + pnpm build:worker (Next standalone + tsup)
#   runner  -- node:22-alpine + aws-cli + tini + precompiled binaries only

# ---- deps stage --------------------------------------------------------
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# ---- builder stage -----------------------------------------------------
FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Plan 01.1-03 -- builder-only placeholder env vars to satisfy the env.ts
# Zod schema during `next build` "collect page data". These values NEVER
# reach the runner stage (multi-stage isolation) and are NEVER used at
# runtime -- the entrypoint shim composes DATABASE_URL from Secrets Manager
# (D-06) and the runner stage gets real secrets from Copilot SSM.
# OPS-04 refines auto-skip during build via NEXT_PHASE=phase-production-build
# (set by Next.js automatically); the basic schema needs concrete values.
ENV NEXT_PHASE=phase-production-build \
    DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
    NEXTAUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime-xx \
    ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    CPF_HASH_PEPPER=build-time-placeholder-pepper-not-used-at-runtime-xx
# Phase 1 src/db/index.ts is a lazy Drizzle client; Next 16 "collect page
# data" accepts the placeholder DATABASE_URL without opening a connection.
RUN corepack enable \
 && pnpm build \
 && pnpm build:worker

# ---- runner stage ------------------------------------------------------
FROM public.ecr.aws/docker/library/node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

# aws-cli  -- entrypoint.sh needs secretsmanager:GetSecretValue (D-06)
# tini     -- PID 1, propagates SIGTERM to the node process cleanly
# ca-certs -- TLS to RDS + external APIs
RUN apk add --no-cache aws-cli ca-certificates tini \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output (server.js + minimal node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Pre-compiled worker + migrator (from pnpm build:worker)
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

# Entrypoint shim
COPY --chown=nextjs:nodejs scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
# Default CMD is the web server; Copilot worker + migrate manifests
# override this with node dist/jobs/worker.js and node dist/db/migrate.js
# respectively.
CMD ["node", "server.js"]
