#!/bin/sh
# Portal Finance container entrypoint -- composes DATABASE_URL.
#
# Plan 01.1-03 / D-06. Docker ENTRYPOINT wrapper for all three services
# (web, worker, migrate). The service CMD is passed as "$@" and exec'd.
#
# Copilot injects from the environment addon outputs (copilot/environments
# /addons/rds-postgres.yml, Plan 01.1-04):
#   DB_ENDPOINT, DB_PORT, DB_NAME, DB_SECRET_ARN, AWS_REGION
#
# The task IAM role holds secretsmanager:GetSecretValue on DB_SECRET_ARN
# via the DBAccessPolicy output (RESEARCH.md Pattern 1 lines 453-464).
#
# Why this shim exists:
#   - RDS master credentials live in Secrets Manager (auto-rotated).
#   - Putting the full DATABASE_URL in SSM would defeat rotation.
#   - src/db/index.ts is a lazy client, so composing DATABASE_URL
#     just before `exec node` is sufficient -- env.ts re-validates
#     at module load, which happens AFTER this shim exports it.

set -eu

# --- Guard: required Copilot-injected env vars ---
: "${AWS_REGION:?AWS_REGION is not set -- Copilot env manifest is broken}"
: "${DB_ENDPOINT:?DB_ENDPOINT is not set -- RDS addon outputs not injected}"
: "${DB_PORT:?DB_PORT is not set -- RDS addon outputs not injected}"
: "${DB_NAME:?DB_NAME is not set -- RDS addon outputs not injected}"
: "${DB_SECRET_ARN:?DB_SECRET_ARN is not set -- RDS addon outputs not injected}"

# --- Fetch RDS master credentials ---
SECRET_JSON=$(aws secretsmanager get-secret-value \
  --region "${AWS_REGION}" \
  --secret-id "${DB_SECRET_ARN}" \
  --query SecretString \
  --output text)

# Parse username + password without jq (value format is stable per
# Pattern 1 GenerateSecretString config).
DB_USER=$(printf '%s' "${SECRET_JSON}" | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
DB_PASS=$(printf '%s' "${SECRET_JSON}" | sed -n 's/.*"password"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -z "${DB_USER}" ] || [ -z "${DB_PASS}" ]; then
  echo "entrypoint: failed to parse DB credentials from Secrets Manager response" >&2
  exit 1
fi

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_ENDPOINT}:${DB_PORT}/${DB_NAME}?sslmode=require"

# Keep the password out of `env` dumps accidentally surfaced in logs.
# DO NOT log DATABASE_URL here -- LGPD + SEC-02.
unset DB_PASS
unset SECRET_JSON

# Hand control to the service CMD (e.g. node .next/standalone/server.js)
exec "$@"
