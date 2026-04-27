# AWS Copilot Setup Runbook - Portal Finance Phase 01.1

> Replaces `docs/ops/railway-setup.md` (Railway has no BR region; see STATE.md 2026-04-24 entry).

**Audience:** Developer provisioning the production Portal Finance AWS environment.
**Phase:** 01.1 (Infra Bootstrap - AWS sa-east-1 via Copilot).
**Status of automation:** Manifest + addon CFN templates are committed under `copilot/`. The remote AWS provisioning steps (env deploy, secret init, svc deploy, ACM + DNS) are operator-driven via the AWS Copilot CLI.

---

## 0. Prerequisites (Wave 0 of Phase 01.1)

The Copilot CLI talks to AWS using the developer's local SSO session. No long-lived IAM access keys are permitted (D-17). Complete sections 0.1 through 0.4 once per developer machine before any later plan in this phase is executed.

### 0.1 Install AWS Copilot CLI (>= v1.34.1)

| OS | Install |
|----|---------|
| macOS | `brew install aws/tap/copilot-cli` |
| Windows | `winget install Amazon.AWSCopilotCLI` or binary from GitHub releases |
| Linux | `curl -Lo /usr/local/bin/copilot https://github.com/aws/copilot-cli/releases/latest/download/copilot-linux && chmod +x /usr/local/bin/copilot` |

Verify: `copilot --version` must print `copilot version: v1.34.X` or newer.

### 0.2 IAM Identity Center SSO (mandatory -- NO long-lived IAM keys per D-17)

1. In the Portal Finance AWS account (the same account holding SES sa-east-1 identity), enable **IAM Identity Center** in region `sa-east-1`.
2. Create a permission set `AdministratorAccess` (AWS-managed policy `AdministratorAccess` attached).
3. Assign the developer user to the Portal Finance account with the `AdministratorAccess` permission set.
4. Copy the **AWS access portal URL** (e.g. `https://d-xxxx.awsapps.com/start`).

### 0.3 Configure local profile `portalfinance-prod`

```sh
aws configure sso
# SSO start URL: <paste portal URL from 0.2.4>
# SSO region: sa-east-1
# Default client region: sa-east-1
# Default output: json
# CLI profile name: portalfinance-prod
```

### 0.4 Daily login

```sh
aws sso login --profile portalfinance-prod
aws sts get-caller-identity --profile portalfinance-prod
```

Expected output: `"Arn": "arn:aws:sts::<account>:assumed-role/AWSReservedSSO_AdministratorAccess_*"`.

**NEVER** store `aws_access_key_id` for this profile in `~/.aws/credentials` -- SSO caches the short-lived session under `~/.aws/sso/cache/` automatically.

---

## 1. Hard Constraint: Brazilian Territory (LGPD-05)

**Every byte of customer data -- Postgres rows, container filesystems, ECR images, CloudWatch logs, S3 backups, Secrets Manager secrets -- MUST live in region `sa-east-1` (São Paulo).** This is non-negotiable; PROJECT.md and the LGPD posture forbid any other region.

Enforcement:

| Surface | Region pin |
|---------|-----------|
| Copilot env (`copilot/environments/prod/manifest.yml`) | `sa-east-1` |
| RDS Postgres instance (`copilot/environments/addons/rds-postgres.yml`) | inherits from env stack |
| ECR repositories | `sa-east-1` (Copilot creates these on `app init`) |
| CloudWatch log groups (`/copilot/portalfinance-prod-*`) | `sa-east-1` |
| Secrets Manager `portalfinance/prod/rds/master` | `sa-east-1` |
| ACM cert for `portalfinance.app` | `sa-east-1` (must match the ALB) |
| Sentry ingestion | `*.de.sentry.io` (EU plane; OPS-04 enforces) |

The validation script `scripts/validate-phase-01.1.sh` includes a remote gate that calls `aws rds describe-db-instances --region sa-east-1` and fails if the DB instance is missing or `PubliclyAccessible: true`. Run it in CI before merging any infra-touching PR.

---

## 2. Service Topology

One Copilot **application** (`portalfinance`) with one **environment** (`prod`) deploying three workloads from a single Docker image:

| Workload | Type | Public | CMD | Manifest |
|----------|------|--------|-----|----------|
| `web` | Load Balanced Web Service | yes (HTTPS via Cloudflare → ALB) | `node server.js` | `copilot/web/manifest.yml` |
| `worker` | Backend Service | no | `node dist/jobs/worker.js` | `copilot/worker/manifest.yml` |
| `migrate` | Scheduled Job (`schedule: none`) | no | `node dist/db/migrate.js` | `copilot/migrate/manifest.yml` |

```
                       Cloudflare (orange-cloud, Full Strict)
                                 │  HTTPS, ACM-signed
                                 ▼
                ┌────── Public ALB (HTTPS:443) ──────┐
                │              host: portalfinance.app   │
                │              host: www.portalfinance.app│
                └────────────────┬────────────────────┘
                                 │  HTTP:8080 (private subnets)
                                 ▼
        ┌────────────┐  ┌────────────┐  ┌────────────────┐
        │ web (1×)   │  │ worker (1×)│  │ migrate (job)  │
        │ Next 16    │  │ pg-boss    │  │ Drizzle        │
        └─────┬──────┘  └─────┬──────┘  └────────┬───────┘
              │  TLS                              │
              └─────────────► RDS Postgres 16 ◄──┘
                              (private, sa-east-1a)
```

VPC layout (`copilot/environments/prod/manifest.yml`, CIDR `10.20.0.0/16`):

- Two public subnets (10.20.0.0/24, 10.20.1.0/24) -- ALB only.
- Two private subnets (10.20.10.0/24, 10.20.11.0/24) -- ECS tasks + RDS.
- One NAT gateway -- egress to Pluggy / ASAAS / Gemini / Sentry / SES.
- VPC endpoints for `ssm`, `ssmmessages`, `secretsmanager`, `ecr.api`, `ecr.dkr`, `sts`, `logs`, `s3` -- AWS-service traffic stays off NAT.

---

## 3. Environment Variables

Three categories, all enforced by the Zod schema in `src/lib/env.ts` at server boot:

### 3.1 Manifest variables (plain text, committed)

Defined inline under `variables:` in each `copilot/<svc>/manifest.yml`:

- `NODE_ENV=production`
- `SENTRY_ENV=production`
- `AWS_REGION=sa-east-1`
- `LOG_LEVEL=info`
- `SERVICE_NAME=web | worker | migrate`
- `SES_FROM_EMAIL=no-reply@portalfinance.app`
- `NEXTAUTH_URL=https://portalfinance.app`
- `TURNSTILE_SITE_KEY` + `NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY` (web only -- public Cloudflare Turnstile site key, safe in source)

### 3.2 SSM SecureString secrets

Created once per environment via `copilot secret init`:

| SSM name | Source |
|----------|--------|
| `/copilot/portalfinance/prod/secrets/NEXTAUTH_SECRET` | `openssl rand -base64 48` |
| `/copilot/portalfinance/prod/secrets/ENCRYPTION_KEY` | `openssl rand -base64 32` (decodes to 32 bytes -- AES-256) |
| `/copilot/portalfinance/prod/secrets/CPF_HASH_PEPPER` | `openssl rand -base64 48` |
| `/copilot/portalfinance/prod/secrets/SENTRY_DSN` | from Sentry EU project settings |
| `/copilot/portalfinance/prod/secrets/TURNSTILE_SECRET_KEY` | from Cloudflare Turnstile dashboard |

### 3.3 DB-bridge SSM parameters (env-addon outputs forwarded to tasks)

The RDS env addon publishes `DbEndpoint`, `DbPort`, `DbName`, `DbSecretArn` as CFN outputs but Copilot does **not** auto-inject env-addon outputs into task containers. The workaround is to read them once and write them as plain `String` SSM parameters that each manifest references via `secrets:`:

```sh
APP=portalfinance
ENV=prod
ARN_PREFIX="arn:aws:ssm:sa-east-1:<account>:parameter"

# Pull the addon outputs.
aws cloudformation describe-stacks \
  --stack-name "${APP}-${ENV}-AddonsStack-XXXXX" \
  --query 'Stacks[0].Outputs' --region sa-east-1 --profile portalfinance-prod

# Write each as an SSM String tagged for Copilot's tag-based IAM.
for kv in DB_ENDPOINT=<endpoint> DB_PORT=5432 DB_NAME=portalfinance DB_SECRET_ARN=<arn>; do
  K="${kv%%=*}"; V="${kv#*=}"
  aws ssm put-parameter --name "/copilot/${APP}/${ENV}/secrets/${K}" \
    --value "${V}" --type String --overwrite \
    --region sa-east-1 --profile portalfinance-prod
  aws ssm add-tags-to-resource --resource-type Parameter \
    --resource-id "/copilot/${APP}/${ENV}/secrets/${K}" \
    --tags "Key=copilot-application,Value=${APP}" \
           "Key=copilot-environment,Value=${ENV}" \
    --region sa-east-1 --profile portalfinance-prod
done
```

The two `copilot-application` / `copilot-environment` tags are critical -- the task execution role's `ssm:GetParameters` policy is tag-conditioned (`ssm:ResourceTag/copilot-environment=prod`). An untagged parameter triggers `AccessDeniedException` at task launch even though `AdministratorAccess` can read it from the CLI.

### 3.4 DATABASE_URL composition

`scripts/entrypoint.sh` reads the four DB-bridge env vars + `DB_SECRET_ARN`, calls `aws secretsmanager get-secret-value` against the master credentials secret (the addon's `DBAccessPolicy` grants the task role this permission), URL-encodes the username + password via `python3` (the runner stage's `aws-cli` package pulls `python3` in transitively), and exports a clean URL with **no** SSL query parameters:

```
postgresql://<encoded-user>:<encoded-pass>@<endpoint>:5432/portalfinance
```

TLS is configured by each client via `ssl: { ca, rejectUnauthorized: true }` reading the RDS global root bundle baked into the runner image at `/app/rds-ca-bundle.pem`. Three call sites: `src/jobs/boss.ts` (pg-boss / pg), `src/db/index.ts` (postgres-js), `src/db/migrate.ts` (postgres-js).

---

## 4. Migration Workflow

Migrations run on a dedicated **Scheduled Job** (`migrate`) with `schedule: none` so they never fire automatically -- always manual.

### 4.1 Author a migration

```sh
pnpm db:generate      # drizzle-kit generate from schema -> src/db/migrations/*.sql
git add src/db/migrations
```

`drizzle-kit push` is BANNED in production -- only `generate` + `migrate`.

### 4.2 Deploy + run

```sh
copilot job deploy --name migrate --env prod    # build + push image, register task def
copilot job run    --name migrate --env prod    # one-shot execution
aws logs tail /copilot/portalfinance-prod-migrate --since 5m \
  --profile portalfinance-prod --region sa-east-1 --follow
```

The first run also issues `CREATE EXTENSION IF NOT EXISTS pgcrypto` (idempotent; required for `gen_random_uuid()`).

### 4.3 Rollback

Drizzle does not generate down-migrations. Rollback procedure:

1. Take an immediate manual RDS snapshot (`aws rds create-db-snapshot ...`).
2. Author a forward-fix migration that reverses the breaking change.
3. Generate + commit + run via the same `copilot job run` flow.
4. If data is corrupt, restore from the most recent automated snapshot (`BackupRetentionPeriod: 7` is set on the addon).

---

## 5. Rollback / Halt Procedures

### 5.1 Roll back a service to a previous task definition

```sh
# List previous active revisions (Copilot keeps the last 10).
aws ecs list-task-definitions --family-prefix portalfinance-prod-web \
  --status ACTIVE --sort DESC --region sa-east-1 --profile portalfinance-prod

# Force-update the service to revision N.
aws ecs update-service --cluster portalfinance-prod-Cluster-XXXX \
  --service portalfinance-prod-web-Service-XXXX \
  --task-definition portalfinance-prod-web:N \
  --force-new-deployment \
  --region sa-east-1 --profile portalfinance-prod
```

Wait for `RUNNING == DESIRED` again before hitting the edge.

### 5.2 Halt the worker (e.g., to drain a poisoned queue)

```sh
aws ecs update-service --cluster portalfinance-prod-Cluster-XXXX \
  --service portalfinance-prod-worker-Service-XXXX \
  --desired-count 0 \
  --region sa-east-1 --profile portalfinance-prod
```

Restore with `--desired-count 1` after the offending job state is purged (`DELETE FROM pgboss.job WHERE name = 'queue.x'`).

### 5.3 Take the site offline (incident isolation)

Disable the Cloudflare DNS records for `portalfinance.app` + `www.portalfinance.app` (set proxy to "DNS only" and delete the record, or flip a Cloudflare maintenance page worker). The ALB stays running. **Do NOT** scale `web` to zero -- ECS will tear down the service and any in-progress requests die without a clean 503.

### 5.4 Emergency RDS recovery

`DeletionPolicy: Snapshot` + `UpdateReplacePolicy: Snapshot` on the DBInstance + `BackupRetentionPeriod: 7` mean any stack delete or replace produces a final snapshot, and PITR restores back 7 days. Use `aws rds restore-db-instance-from-db-snapshot` to spin a parallel instance, then point a new env addon at it.

---

## 6. Worker / Web Operational Notes

### 6.1 Reading logs

| Service | Log group |
|---------|-----------|
| web | `/copilot/portalfinance-prod-web` |
| worker | `/copilot/portalfinance-prod-worker` |
| migrate | `/copilot/portalfinance-prod-migrate` |

```sh
aws logs tail <log-group> --since 10m --follow \
  --region sa-east-1 --profile portalfinance-prod --format short
```

All log groups are 30-day retention (D-23). Adjust via `logging.retention` in the manifest -- never via the console.

### 6.2 Exec into a running container

```sh
copilot svc exec --name worker --env prod --command "sh"
```

Requires the AWS Session Manager plugin installed locally (https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html). All three manifests have `exec: true`.

### 6.3 pg-boss operational gotchas

- pg-boss v10+ requires `boss.createQueue(name)` before `boss.work(name, ...)` or `boss.send(name, ...)`. `getBoss()` in `src/jobs/boss.ts` iterates `Object.values(QUEUES)` and creates each idempotently after `start()` -- both web and worker rely on this.
- The worker is `count: 1` because per-user singleton-key dedup assumes a single replica. Horizontal scaling is deferred to Phase 6.
- Stuck jobs in the `pgboss.job` table can be re-driven by setting `state = 'created'` and `started_on = NULL`.

### 6.4 Web / ALB caveats

- The HTTPS:443 listener uses the ACM cert; the HTTP:80 listener is left open and unused (Copilot manages it). Cloudflare always reaches over HTTPS:443.
- `http.alias` is a YAML list -- `[portalfinance.app, www.portalfinance.app]`. Both names must also be present on the cert (SAN).
- Cloudflare SSL mode must be **Full (strict)** -- anything weaker degrades the security guarantee.

### 6.5 SES sender domain

SES is in `sa-east-1` (LGPD-05). The web/worker tasks use the IAM task role for SES; `src/lib/mailer.ts` does not pass static credentials when `NODE_ENV === 'production'`. The task role gains `ses:SendEmail` via the env addon.

---

## 7. Documentation of Manual Steps

Items that are **not** in CFN or manifests -- track them here so future operators do not re-discover the gotchas.

### 7.1 ACM cert + Cloudflare DNS bootstrap (one-time per environment)

1. Request the ACM cert in `sa-east-1` for `portalfinance.app` with `www.portalfinance.app` as a SAN, DNS validation.
2. Add the two `_xxx.acm-validations.aws` CNAMEs in Cloudflare with **gray cloud / DNS only** -- ACM cannot validate through the proxy.
3. Wait for the cert to flip to `ISSUED` (5-15 min).
4. Paste the cert ARN into `copilot/environments/prod/manifest.yml` under `http.public.certificates`.
5. `copilot env deploy --name prod` -- attaches the cert to the ALB HTTPS:443 listener.
6. Add the apex + www DNS records in Cloudflare (CNAME flattening for the apex), **orange cloud / proxied**.
7. Set Cloudflare SSL to **Full (strict)**.
8. Uncomment / extend `http.alias` in `copilot/web/manifest.yml`.
9. `copilot svc deploy --name web --env prod` -- installs the host-header rule.
10. Run `scripts/validate-phase-01.1.sh` -- the remote gates assert ISSUED + 200 on both edges.

### 7.2 SSM tag-based IAM tagging for DB-bridge parameters

Whenever you `aws ssm put-parameter` a value Copilot needs to read at task launch, you **must** tag it with `copilot-application` + `copilot-environment` (see § 3.3). The Copilot-managed task execution role policy is tag-conditioned. Untagged parameters fail at deploy with `AccessDeniedException` even when the CLI user is `AdministratorAccess`.

### 7.3 RDS master credentials rotation

The RDS master secret (`portalfinance/prod/rds/master`) is generated by `GenerateSecretString` with `ExcludeCharacters: '"@/\?#%&=+ :;,'` -- defense-in-depth so future rotations stay URL-safe. The runtime path (entrypoint.sh -> python3 urllib.parse.quote) handles unsafe chars too, but constraining the generator removes the foot-gun.

To rotate manually:

1. Trigger Secrets Manager rotation (or update the secret value directly).
2. Apply the new password to the DB instance: `aws rds modify-db-instance --master-user-password ...`.
3. Drain + restart all three services so the new credential is read on the next entrypoint invocation -- `copilot svc deploy --force` and `copilot job deploy` cycle the tasks.

### 7.4 Adding a new service or scheduled job

1. Drop a new manifest under `copilot/<name>/manifest.yml`.
2. If the service needs DB access: copy `copilot/web/addons/db-access.yml` to `copilot/<name>/addons/db-access.yml` -- workload-level addon, not env-level. The env-level `DBAccessPolicy` output is **not** auto-attached to per-service task roles in Copilot v1.34; the workload-level addon is the working pattern.
3. If the service needs SES / Pluggy / etc: add a workload-level addon CFN with the right managed policy.
4. `copilot svc init --name <name>` (first time) then `svc deploy`.
5. Append a `for svc in ... do` line in `scripts/validate-phase-01.1.sh` so the log-retention gate covers the new service.

### 7.5 Known gotchas (failures encountered during the Phase 01.1 bootstrap, kept here so they are not re-learned the hard way)

- **Env-addon `Fn::ImportValue` race.** A nested env addon stack is created during the parent env stack's CREATE_IN_PROGRESS, but `Fn::ImportValue` cannot resolve exports from a stack still in progress. Workaround: deploy the env stack without the RDS addon first, then add the addon and re-deploy. Once the env stack is `CREATE_COMPLETE`, all subsequent addon updates resolve normally.
- **Copilot `From: env` allowlist (v1.34).** `VpcId` is **not** on the allowlist, so an env addon cannot accept it via `Properties.VpcId.From: env`. Use `Fn::ImportValue: !Sub '${App}-${Env}-VpcId'` instead.
- **`PrivateSubnets` is a single export, comma-separated.** Use `Fn::Split` with `,` on the import. There is no `PrivateSubnet1` / `PrivateSubnet2` export.
- **postgres-js forwards URL query params.** `?sslmode=...` or `?sslrootcert=...` in `DATABASE_URL` end up as Postgres startup GUCs; the server returns `unrecognized configuration parameter`. Strip them from the URL and configure `ssl` via the postgres options object.
- **pg-connection-string v2 alias-then-fail.** `sslmode=require` is now an alias for `verify-full`. Without an explicit CA, Node's default trust store cannot validate Amazon's RDS chain -> `self-signed certificate in certificate chain`. Bake the global RDS bundle into the image and pass it as `ssl: { ca, rejectUnauthorized: true }`.
- **Generated RDS passwords with `?` characters.** Without URL-encoding, the first `?` terminates the userinfo, the rest is parsed as a query string, and `pg` resolves the dbname (`portalfinance`) as the host -> `getaddrinfo ENOTFOUND portalfinance`. Fix at two layers: (a) tighten `ExcludeCharacters` in the addon, (b) URL-encode user + password in the entrypoint shim.
- **Git Bash `MSYS_NO_PATHCONV=1`.** `/copilot/...` SSM parameter paths get mangled into `C:/Program Files/Git/copilot/...` on Windows Git Bash. Set `MSYS_NO_PATHCONV=1` for any AWS CLI command that takes such a path. PowerShell users are unaffected.
