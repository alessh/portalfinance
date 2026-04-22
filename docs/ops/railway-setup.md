# Railway Setup Runbook — Portal Finance Phase 1

**Audience:** Developer provisioning the production / staging Railway project.
**Phase:** 01 (Foundation & Identity), plan 01-01.
**Status of automation:** Manual — Railway project provisioning has no public API at this time.

---

## 1. Hard Constraint: Brazilian Territory (LGPD-05)

**ALL data — Postgres rows, container filesystems, build caches — MUST live in `sa-east-1`.** This is non-negotiable: PROJECT.md and the LGPD posture forbid any other region.

**Pre-flight check (do this before clicking anything else):**

1. Open Railway dashboard → **+ New Project** → look at the region selector.
2. Confirm `sa-east-1` (Brazil) is offered for **both** Postgres and standard service deployments.
3. **If `sa-east-1` is NOT offered** → STOP. Do not proceed. There is no compliant fallback in-phase. Escalate per `.planning/STATE.md` blocker `Railway sa-east-1 region availability`.

---

## 2. Service Topology

Three services in **one** Railway project (so they share a private VPC and can reference each other's variables):

| Service    | Type            | Region      | Public Domain | Start Command          | Build Command |
| ---------- | --------------- | ----------- | ------------- | ---------------------- | ------------- |
| `postgres` | Managed Postgres 16 | `sa-east-1` | n/a           | n/a (Railway managed)  | n/a           |
| `web`      | Repo (this repo)| `sa-east-1` | YES           | `pnpm start:web`       | `pnpm build`  |
| `worker`   | Repo (same repo)| `sa-east-1` | NO            | `pnpm start:worker`    | `pnpm build`  |

The web service serves Next.js + API routes. The worker service runs pg-boss workers (no inbound port; pulls jobs from the same Postgres).

### 2.1. Provisioning Steps

1. **Postgres**: Railway dashboard → **+ New** → **Database** → **PostgreSQL**. Region: `sa-east-1`.
2. **Web service**: **+ New** → **GitHub Repo** → select this repo. After creation:
   - Settings → **Region**: `sa-east-1`.
   - Settings → **Build Command**: `pnpm build`.
   - Settings → **Start Command**: `pnpm start:web`.
   - Settings → **Networking** → enable a public domain (e.g., `web-portalfinance.up.railway.app` or a custom apex).
3. **Worker service**: **+ New** → **GitHub Repo** → same repo (yes, deploy the same repo twice). After creation:
   - Settings → **Region**: `sa-east-1`.
   - Settings → **Build Command**: `pnpm build`.
   - Settings → **Start Command**: `pnpm start:worker`.
   - Settings → **Networking**: do **NOT** enable a public domain. The worker has no HTTP listener.

---

## 3. Environment Variables

Set on **both** the `web` and `worker` services. Use the Railway dashboard → Service → **Variables**.

| Variable           | Source / How to Generate                                                                              | Notes |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ----- |
| `DATABASE_URL`     | Railway dashboard: from the `postgres` service, click **Connect** → copy the reference variable expression `${{ postgres.DATABASE_URL }}` and paste into both web + worker. | Reference variables update automatically on rotation. Do NOT hard-code. |
| `NEXTAUTH_SECRET`  | `openssl rand -base64 32`                                                                              | Auth.js v5 session signing key. |
| `ENCRYPTION_KEY`   | `openssl rand -base64 32` — base64 string MUST decode to exactly 32 bytes (256 bits).                  | AES-256-GCM master key for `cpf_enc` (and Phase 2 `pluggy_item_id`). |
| `CPF_HASH_PEPPER`  | `openssl rand -base64 32` — MUST be **distinct** from `ENCRYPTION_KEY` (RESEARCH.md Open Question #3). | HMAC-SHA-256 pepper for `cpf_hash`. Distinct so a key leak doesn't expose lookup digests. |
| `SENTRY_DSN`       | Sentry EU (`https://de.sentry.io`) → **Projects** → **Create Project** → **Next.js** → copy DSN.       | Full SDK wiring lands in plan 01-04. The DSN being set lets schema-setup boot errors surface in Sentry today. |
| `SENTRY_ENV`       | Literal `development` / `staging` / `production` matching `NODE_ENV`.                                   | Used by `Sentry.init({ environment })`. |
| `NODE_ENV`         | `production` on the prod environment; otherwise `development`.                                          | Drives Drizzle pool size (10 in prod, 1 elsewhere). |

### 3.1. Verification

After saving, run from your dev box (replacing `${RAILWAY_PG_URL}`):

```bash
DATABASE_URL="${RAILWAY_PG_URL}" psql -c "SELECT 1"
```

Expect a `1` back. Failures usually mean the IP is not on Railway's allowlist (Railway exposes Postgres publicly with a TLS connection string — no allowlist needed in v1).

---

## 4. Migration Workflow

**Drizzle Kit `push` is BANNED in this project.** It rewrites schema in place without preserving history and is unsafe once migrations are part of deploy state. Only `drizzle-kit generate` (developer machine, commits SQL to git) and `drizzle-kit migrate` via the `pnpm db:migrate` runner (deploy time) are permitted.

### 4.1. Predeploy Hook (web service ONLY)

Web service → Settings → **Pre-Deploy Command**: `pnpm db:migrate`.

The worker service does **NOT** run migrations — only the web service is the migration source-of-truth, so concurrent worker boots cannot race with web on a fresh deploy.

### 4.2. Manual Migration (fallback)

If your Railway plan does not expose a Pre-Deploy hook:

```bash
# From your dev box, with the Railway DATABASE_URL exported:
DATABASE_URL="postgresql://..." pnpm db:migrate
```

The runner is idempotent — it tracks applied migrations in `drizzle.__migrations` and is a no-op on a current schema.

### 4.3. After First Successful Migration

```bash
DATABASE_URL="postgresql://..." psql -c "\dt public.*"
```

Expected output (14 tables):

```
 public | account_locks            | table | ...
 public | accounts_oauth           | table | ...
 public | admin_access_log         | table | ...
 public | audit_log                | table | ...
 public | auth_rate_limits         | table | ...
 public | dsr_requests             | table | ...
 public | password_reset_tokens    | table | ...
 public | ses_suppressions         | table | ...
 public | sessions                 | table | ...
 public | subscriptions            | table | ...
 public | user_consents            | table | ...
 public | users                    | table | ...
 public | verification_tokens      | table | ...
 public | webhook_events           | table | ...
```

There must be **NO** `accounts` table — Phase 2 needs that name for Pluggy bank accounts.

---

## 5. Rollback / Halt Procedures

**If `sa-east-1` becomes unavailable mid-phase:**

- Halt deploy. Do NOT migrate to another region.
- Open a STATE.md blocker, escalate to product / legal.
- Contact Railway support to confirm regional incident vs. permanent removal.
- No fallback exists in-phase — every alternative region (us-east, eu-west, ap-south) violates LGPD-05.

**If a migration fails partially:**

- Drizzle wraps each migration in a transaction; failures roll back. Verify with `psql -c "SELECT * FROM drizzle.__migrations ORDER BY id DESC"`.
- DO NOT manually edit `__migrations`. Either fix the SQL and re-run, or write a corrective migration.

---

## 6. Worker / Web Operational Notes

- **Worker has no HTTP port.** Health checks must be off (Railway tries `GET /` by default — disable for the worker service).
- **pg-boss creates its own `pgboss` schema** lazily on first `boss.start()` (plan 01-03/01-04). The application schema is `public`. Both schemas live in the same Postgres database; the pgboss namespace is isolated.
- **Logs**: Both services emit structured JSON to stdout (plan 01-04 wires the logger). Railway aggregates and offers 7-day retention on the free tier.

---

## 7. Documentation of Manual Steps

When provisioning is complete, capture:

- A screenshot of Railway's services tab showing all 3 services + region badges of `sa-east-1`.
- The output of `psql -c "\dt public.*"` against the Railway DB.

Attach both to `.planning/phases/01-foundation-identity/01-01-SUMMARY.md` so the verifier can confirm Task 3's [BLOCKING] gate without re-running the deploy.
