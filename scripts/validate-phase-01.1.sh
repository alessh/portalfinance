#!/bin/sh
# validate-phase-01.1.sh -- chained infra gates for Phase 01.1.
#
# Plan 01.1-04 creates the skeleton; Plan 01.1-07 Task 3 appends the
# remote AWS checks (ALB, RDS, SSM, CloudWatch retention, Cloudflare
# SSL mode). Exit 0 on all-pass; non-zero on first failure.
#
# Local-only checks are always safe to run. Remote checks require
# `aws sso login --profile portalfinance-prod` to be active.

set -eu

PROFILE="${AWS_PROFILE:-portalfinance-prod}"
APP="portalfinance"
ENV_NAME="prod"

pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1" >&2; exit 1; }

echo "== Phase 01.1 validation =="

# --- Local file gates (safe without AWS access) ---
echo "Checking local files..."

[ -f Dockerfile ] || fail "Dockerfile missing"
[ -f .dockerignore ] || fail ".dockerignore missing"
[ -f scripts/entrypoint.sh ] || fail "scripts/entrypoint.sh missing"
[ -x scripts/entrypoint.sh ] || fail "scripts/entrypoint.sh not executable"
[ -f copilot/.workspace ] || fail "copilot/.workspace missing"
[ -f copilot/environments/prod/manifest.yml ] || fail "prod env manifest missing"
[ -f copilot/environments/addons/rds-postgres.yml ] || fail "RDS addon missing"
[ -f copilot/web/manifest.yml ] || fail "web manifest missing"
[ -f copilot/worker/manifest.yml ] || fail "worker manifest missing"
[ -f copilot/migrate/manifest.yml ] || fail "migrate manifest missing"
[ -f src/app/api/health/route.ts ] || fail "health route missing"
[ -f tsup.config.ts ] || fail "tsup config missing"
[ -f docs/ops/aws-copilot-setup.md ] || fail "AWS runbook missing"
# Plan 01.1-08 deprecates docs/ops/railway-setup.md. Until 01.1-08 lands,
# the legacy runbook may still exist -- emit a warning (not a fail) so the
# Wave 2 gate passes while Wave 4 docs work is still pending.
if [ -f docs/ops/railway-setup.md ]; then
  echo "  [WARN] Railway runbook still present -- Plan 01.1-08 will deprecate it"
fi
pass "all local files present"

# --- Manifest invariant greps (cheap, pre-deploy) ---
grep -q "PubliclyAccessible: false" copilot/environments/addons/rds-postgres.yml \
  || fail "RDS addon MUST declare PubliclyAccessible: false"
pass "RDS PubliclyAccessible: false"

grep -q "placement: private" copilot/web/manifest.yml \
  || fail "web manifest MUST place tasks in private subnets"
grep -q "placement: private" copilot/worker/manifest.yml \
  || fail "worker manifest MUST place tasks in private subnets"
grep -q "placement: private" copilot/migrate/manifest.yml \
  || fail "migrate manifest MUST place tasks in private subnets"
pass "all services in private subnets"

grep -q 'schedule: "none"' copilot/migrate/manifest.yml \
  || fail "migrate job MUST have schedule: none (manual-only)"
pass "migrate is manual-only"

grep -q "retention: 30" copilot/web/manifest.yml \
  || fail "web manifest MUST set log retention: 30"
grep -q "retention: 30" copilot/worker/manifest.yml \
  || fail "worker manifest MUST set log retention: 30"
grep -q "retention: 30" copilot/migrate/manifest.yml \
  || fail "migrate manifest MUST set log retention: 30"
pass "CloudWatch retention 30 days declared"

# --- Remote checks (AWS CLI) -- skipped until Plan 01.1-07 populates them ---
if [ "${SKIP_REMOTE:-0}" = "1" ]; then
  echo "SKIP_REMOTE=1 -- skipping AWS-side gates"
  echo "All local gates PASSED"
  exit 0
fi

# --- Remote AWS gates (Plan 01.1-07 Task 3) ---
echo "Checking live AWS infrastructure..."

REGION="sa-east-1"

# Disable Git Bash / MSYS path mangling so /copilot/... SSM names survive
# shell-to-AWS-CLI marshalling on Windows. Harmless on real POSIX shells.
export MSYS_NO_PATHCONV=1

# 1. RDS PubliclyAccessible must be false on the prod DB instance.
DB_PUBLIC=$(aws rds describe-db-instances \
  --db-instance-identifier "${APP}-${ENV_NAME}-db" \
  --profile "${PROFILE}" --region "${REGION}" \
  --query 'DBInstances[0].PubliclyAccessible' --output text 2>/dev/null || echo "ERROR")
[ "${DB_PUBLIC}" = "False" ] || fail "RDS instance is publicly accessible (got: ${DB_PUBLIC})"
pass "RDS PubliclyAccessible=false"

# 2. CloudWatch log groups for web / worker / migrate exist with 30-day retention.
for svc in web worker migrate; do
  RET=$(aws logs describe-log-groups \
    --log-group-name-prefix "/copilot/${APP}-${ENV_NAME}-${svc}" \
    --profile "${PROFILE}" --region "${REGION}" \
    --query 'logGroups[0].retentionInDays' --output text 2>/dev/null || echo "ERROR")
  [ "${RET}" = "30" ] || fail "log group /copilot/${APP}-${ENV_NAME}-${svc} retention != 30 (got: ${RET})"
done
pass "CloudWatch log retention 30 days for web + worker + migrate"

# 3. SSM secrets backing the Copilot manifests are all SecureString.
for name in NEXTAUTH_SECRET ENCRYPTION_KEY CPF_HASH_PEPPER SENTRY_DSN TURNSTILE_SECRET_KEY; do
  TYPE=$(aws ssm describe-parameters \
    --parameter-filters "Key=Name,Values=/copilot/${APP}/${ENV_NAME}/secrets/${name}" \
    --profile "${PROFILE}" --region "${REGION}" \
    --query 'Parameters[0].Type' --output text 2>/dev/null || echo "ERROR")
  [ "${TYPE}" = "SecureString" ] || fail "/copilot/${APP}/${ENV_NAME}/secrets/${name} is not SecureString (got: ${TYPE})"
done
pass "SSM secrets are SecureString"

# 4. ACM cert covering portalfinance.app is ISSUED in sa-east-1.
CERT_STATUS=$(aws acm list-certificates \
  --profile "${PROFILE}" --region "${REGION}" \
  --query "CertificateSummaryList[?DomainName=='portalfinance.app'].Status | [0]" --output text 2>/dev/null || echo "ERROR")
[ "${CERT_STATUS}" = "ISSUED" ] || fail "ACM cert for portalfinance.app is not ISSUED (got: ${CERT_STATUS})"
pass "ACM cert ISSUED for portalfinance.app"

# 5. Edge round-trip: https://portalfinance.app/api/health returns 200 via Cloudflare.
#
# Use HEAD (-I) to avoid body-write quirks on Git Bash for Windows where
# `-o /dev/null` can return curl exit 23 even after a successful HTTP 200.
# `|| true` keeps `set -e` happy when curl exits non-zero; we judge from
# the captured status code, not the exit code.
EDGE_STATUS=$(curl -sS -I --max-time 10 -w '%{http_code}' -o /dev/null https://portalfinance.app/api/health 2>/dev/null) || true
[ "${EDGE_STATUS:-000}" = "200" ] || fail "https://portalfinance.app/api/health did not return 200 (got: ${EDGE_STATUS:-<empty>})"
pass "edge round-trip portalfinance.app/api/health = 200"

EDGE_WWW_STATUS=$(curl -sS -I --max-time 10 -w '%{http_code}' -o /dev/null https://www.portalfinance.app/api/health 2>/dev/null) || true
[ "${EDGE_WWW_STATUS:-000}" = "200" ] || fail "https://www.portalfinance.app/api/health did not return 200 (got: ${EDGE_WWW_STATUS:-<empty>})"
pass "edge round-trip www.portalfinance.app/api/health = 200"

# 6. Confirm Cloudflare is fronting the edge (Server: cloudflare header present).
CF_HEADER=$(curl -sS -I --max-time 10 https://portalfinance.app/api/health 2>/dev/null \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="server"{print tolower($2)}')
case "${CF_HEADER}" in
  cloudflare) pass "Cloudflare proxy present (Server: cloudflare)" ;;
  *) fail "expected Server: cloudflare, got: ${CF_HEADER:-<missing>}" ;;
esac

echo "All gates PASSED."
