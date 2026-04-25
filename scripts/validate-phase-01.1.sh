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

# Plan 01.1-07 Task 3 APPENDS the following gates below this line:
#   - RDS publicly_accessible=false
#   - SSM secrets all SecureString
#   - CloudWatch log groups retention=30
#   - Cloudflare SSL=strict via API
#   - https://portalfinance.app/api/health returns 200

echo "Remote AWS gates not yet implemented -- see Plan 01.1-07."
echo "All local gates PASSED."
