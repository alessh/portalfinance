# Local Development Setup

This runbook is the canonical answer to: "I just cloned `web/`. How do I run the
dev server?"

## 1. Prerequisites

- Node.js 24.x (see `package.json` engines).
- pnpm 9.15.x.
- Docker Desktop with the WSL2 backend (Windows) — required for integration
  tests that boot a Postgres testcontainer. NOT required to run `pnpm dev`.
- A local Postgres 16 instance OR a Docker container exposing 5432 — required
  for `pnpm dev` and `pnpm start:worker`. Easiest path is the bundled compose
  service, which matches the user / password / DB baked into the default
  `.env.local`:
  ```
  pnpm db:up      # docker compose up -d postgres (named volume: portal_pg_data)
  pnpm db:logs    # tail Postgres logs
  pnpm db:down    # stop the container (data persists in the volume)
  ```
  Equivalent one-shot if you prefer ad-hoc:
  ```
  docker run --rm -d --name portal-pg -p 5432:5432 \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=portal_finance_dev postgres:16-alpine
  ```

## 2. Environment files

| File             | Committed? | Loaded by                                |
|------------------|------------|------------------------------------------|
| `.env.example`   | YES        | reference only — never read at runtime   |
| `.env.local`     | NO (gitignored) | `pnpm dev`, `pnpm start:worker`, `npm run test:e2e` (initial load) |
| `.env`           | NO         | optional fallback after `.env.local`     |
| Per-test env     | n/a        | `npm run test:integration` sets `process.env.*` per test; ignores `.env.local` |
| AWS SSM SecureString | n/a    | production (Copilot Fargate task def)    |

Bootstrap your local file:
```
cp .env.example .env.local
```

Fill the blanks. Generate secrets with `openssl`:
```
# 32-byte AES-256-GCM key, base64-encoded:
openssl rand -base64 32     # -> ENCRYPTION_KEY

# 32+ char HMAC peppers and Auth.js secret:
openssl rand -base64 48     # -> NEXTAUTH_SECRET, CPF_HASH_PEPPER,
                            #    PLUGGY_ITEM_ID_HASH_PEPPER, PLUGGY_WEBHOOK_SECRET
```

`PLUGGY_SANDBOX_CLIENT_ID` and `PLUGGY_SANDBOX_CLIENT_SECRET` come from the
Pluggy dashboard (https://dashboard.pluggy.ai). They are required to exercise
the `/connect` flow against the sandbox; without them, `pnpm dev` still boots
but Pluggy Connect will fail at token-issue time.

## 3. Boot the dev server

```
pnpm install
pnpm db:up          # boot local Postgres 16 via docker compose (one-time per session)
pnpm db:migrate     # apply Drizzle migrations to your local Postgres
pnpm dev            # Next.js 16 with Turbopack; reads .env.local automatically
```

To inspect the database in a browser:
```
pnpm db:studio      # drizzle-kit studio; loads .env.local via Node's --env-file-if-exists
```

In a second terminal, start the worker:
```
pnpm start:worker   # tsx with --env-file-if-exists=.env.local
```

Visit http://localhost:3000 and sign up.

## 4. What `next dev` loads

Next.js 16 auto-loads `.env.local`, then `.env.development`, then `.env`
(later files do NOT override earlier ones). NODE_ENV is set automatically to
`'development'`. Public-prefixed vars (`NEXT_PUBLIC_*`) are inlined into the
client bundle at build time; everything else stays server-only.

The env validator at `src/lib/env.ts` is `import 'server-only'`-guarded
(plan 02-07), so any client-side import attempt fails the build with a clear
error message. If you see a runtime ZodError on `/connect`, the most likely
cause is a missing variable in `.env.local` — confirm with:
```
node -e "require('dotenv').config({path:'.env.local'}); ['DATABASE_URL','NEXTAUTH_SECRET','ENCRYPTION_KEY','CPF_HASH_PEPPER','PLUGGY_ITEM_ID_HASH_PEPPER','PLUGGY_WEBHOOK_SECRET'].forEach(k=>console.log(k, !!process.env[k]));"
```

## 5. Running tests

```
npm run test:unit          # vitest unit project — no Docker required
npm run test:integration   # vitest integration project — Docker REQUIRED (testcontainers)
npm run test:e2e           # Playwright + testcontainers — Docker REQUIRED
```

Integration tests do NOT read `.env.local`; each suite assigns the env vars it
needs in its `beforeAll` (see `tests/integration/observability/env-assert.test.ts`
for the pattern). If a fixture drifts from `src/lib/env.ts`, the OPS-04
boot-assertion good-path test catches it.

## 6. Production

Production runs on AWS Copilot Fargate in `sa-east-1`. Secrets live in SSM
SecureStrings; the entrypoint script composes `DATABASE_URL` from RDS host +
Secrets Manager creds. See `docs/ops/aws-copilot-setup.md` for the full
Copilot/IAM Identity Center bootstrap.

NEVER commit a real production secret to this repository, even in a comment.
