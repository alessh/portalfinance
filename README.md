# Portal Finance — Web

Brazilian personal-finance PWA built on Open Finance (Pluggy), targeting the Brazilian middle class.

## Tech stack

- **Framework:** Next.js 16 (App Router) + TypeScript 5.7 + Tailwind 4 + shadcn/ui
- **Data:** PostgreSQL 16 + Drizzle ORM 0.45
- **Auth:** Auth.js v5 (Credentials provider) — email + CPF + password
- **Hosting:** Railway `sa-east-1` (web + worker + Postgres — Brazilian territory)
- **Observability:** Sentry EU (`de.sentry.io`) + pino structured logger

## Prerequisites

- **Node.js** >= 22 (use `nvm use` or check `.nvmrc`)
- **pnpm** >= 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker Desktop** — for local Postgres

## Local development

### 1. Clone and install

```bash
git clone https://github.com/your-org/PortalFinance
cd PortalFinance/web
pnpm install
```

### 2. Start Postgres

```bash
docker compose up -d
```

This starts a Postgres 16 container on port 5432.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Minimum required variables for local dev:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/portalfinance

# Auth (generate with: openssl rand -hex 32)
NEXTAUTH_SECRET=your-32-char-or-longer-secret
NEXTAUTH_URL=http://localhost:3000

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=your-64-char-hex-key
CPF_HASH_PEPPER=your-64-char-hex-pepper

# Cloudflare Turnstile (use test keys for local dev)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

# Sentry (optional for local dev)
SENTRY_DSN=https://your-key@de.ingest.sentry.io/your-project
NEXT_PUBLIC_SENTRY_DSN=https://your-key@de.ingest.sentry.io/your-project
SENTRY_ENV=development
```

See `.env.example` for the full variable list.

### 4. Apply database schema

```bash
pnpm db:push
```

> **Never run `drizzle-kit push` in production.** Use `drizzle-kit generate` to
> produce migration files, then apply with `drizzle-kit migrate`. The `db:push`
> command is for local dev only and bypasses the migration history.

### 5. Start the dev server

```bash
pnpm dev
```

App available at `http://localhost:3000`.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Start production server (requires `pnpm build` first) |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm test:run` | Run all tests once (CI mode) |
| `pnpm test:watch` | Watch mode |
| `pnpm db:push` | Apply schema to local DB (dev only) |
| `pnpm db:generate` | Generate migration files from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Open Drizzle Studio (local DB browser) |

## Testing

```bash
# Run all unit tests
pnpm test:run

# Run a specific test file
pnpm vitest run tests/unit/observability/sentry-scrubber.test.ts

# Run integration tests (requires DATABASE_URL)
pnpm vitest run tests/integration/
```

Integration tests require a running Postgres instance. Set `DATABASE_URL` to a test
database (separate from your local dev database) or use the Docker Compose test target.

## Project structure

```
src/
  app/           Next.js App Router pages + API routes
  components/    React components (ui/, demo/, banners/, auth/)
  db/            Drizzle schema + migrations
  jobs/          pg-boss workers (sesBounceWorker, etc.)
  lib/           Shared utilities (auth, crypto, logger, sentry, etc.)
tests/
  unit/          Fast, in-process unit tests
  integration/   Tests that hit the real DB / HTTP layer
  fixtures/      Shared test fixtures
docs/
  ops/           Operational runbooks (deployment, key rotation, SES, etc.)
  adr/           Architecture Decision Records
```

## Key conventions

- **IDOR guard:** Every Drizzle query that reads user data MUST include
  `AND user_id = $userId` from `requireSession()`.
- **Never log PII:** pino logger auto-scrubs CPF, email, and other PII via
  `src/lib/piiScrubber.ts`. Do not bypass this.
- **Never run GROUP BY on transactions at request time.** Read from
  `monthly_summaries` and `category_monthly_totals` (pre-aggregated).
- **drizzle-kit push is banned in production.** Use `db:generate` + `db:migrate`.

## Ops runbooks

- [SES production access](docs/ops/ses-production-access.md) — request SES
  production access and wire SNS bounce notifications.
- [Encryption key rotation](docs/ops/encryption-key-rotation.md) — rotate
  `ENCRYPTION_KEY` and `CPF_HASH_PEPPER` safely.
- [Railway setup](docs/ops/railway-setup.md) — deploy web + worker to Railway.
