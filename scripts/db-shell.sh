#!/bin/sh
# Portal Finance DB inspection helper for `copilot svc exec` sessions.
#
# `copilot svc exec` opens a new shell whose env has DB_ENDPOINT / DB_PORT /
# DB_NAME / DB_SECRET_ARN but NOT DATABASE_URL — the entrypoint shim
# composes that only for the CMD process tree. This helper re-runs the
# composition and either runs a one-shot SQL query or drops into a node
# REPL with `sql` (postgres-js client) pre-bound.
#
# Usage (inside `copilot svc exec`):
#   /app/scripts/db-shell.sh
#       Interactive node REPL. Try: await sql`SELECT count(*) FROM users`
#
#   /app/scripts/db-shell.sh "SELECT email FROM users LIMIT 5"
#       One-shot query, JSON output to stdout.
#
# RDS TLS verification uses /app/rds-ca-bundle.pem when present (always
# baked into the runner image; absent in dev shells).

set -eu

: "${AWS_REGION:?AWS_REGION not set}"
: "${DB_ENDPOINT:?DB_ENDPOINT not set}"
: "${DB_PORT:?DB_PORT not set}"
: "${DB_NAME:?DB_NAME not set}"
: "${DB_SECRET_ARN:?DB_SECRET_ARN not set}"

if [ -z "${DATABASE_URL:-}" ]; then
  SECRET_JSON=$(aws secretsmanager get-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$DB_SECRET_ARN" \
    --query SecretString \
    --output text)

  DB_USER=$(printf '%s' "$SECRET_JSON" | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  DB_PASS=$(printf '%s' "$SECRET_JSON" | sed -n 's/.*"password"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

  if [ -z "$DB_USER" ] || [ -z "$DB_PASS" ]; then
    echo "db-shell: failed to parse DB credentials from Secrets Manager" >&2
    exit 1
  fi

  DB_USER_ENC=$(printf '%s' "$DB_USER" | python3 -c 'import sys,urllib.parse; sys.stdout.write(urllib.parse.quote(sys.stdin.read(), safe=""))')
  DB_PASS_ENC=$(printf '%s' "$DB_PASS" | python3 -c 'import sys,urllib.parse; sys.stdout.write(urllib.parse.quote(sys.stdin.read(), safe=""))')

  export DATABASE_URL="postgresql://${DB_USER_ENC}:${DB_PASS_ENC}@${DB_ENDPOINT}:${DB_PORT}/${DB_NAME}"

  unset DB_PASS DB_PASS_ENC SECRET_JSON
fi

if [ "$#" -gt 0 ]; then
  # One-shot mode: pass the joined args as raw SQL via env var (avoids
  # all argv quoting issues across sh -> node -e -> JS string boundary).
  DB_SHELL_QUERY="$*"
  export DB_SHELL_QUERY
  exec node -e "
    const postgres = require('postgres');
    const fs = require('fs');
    const ssl = fs.existsSync('/app/rds-ca-bundle.pem')
      ? { ca: fs.readFileSync('/app/rds-ca-bundle.pem','utf8'), rejectUnauthorized: true }
      : 'require';
    const sql = postgres(process.env.DATABASE_URL, { ssl, max: 1 });
    sql.unsafe(process.env.DB_SHELL_QUERY)
      .then((r) => { console.log(JSON.stringify(r, null, 2)); return sql.end(); })
      .catch((e) => { console.error(e.message); return sql.end().then(() => process.exit(1)); });
  "
fi

# Interactive REPL.
exec env DB_SHELL_QUERY="" node -e "
  const repl = require('repl');
  const postgres = require('postgres');
  const fs = require('fs');
  const ssl = fs.existsSync('/app/rds-ca-bundle.pem')
    ? { ca: fs.readFileSync('/app/rds-ca-bundle.pem','utf8'), rejectUnauthorized: true }
    : 'require';
  const sql = postgres(process.env.DATABASE_URL, { ssl, max: 2 });
  console.log('db-shell — postgres-js client bound to \\\`sql\\\`.');
  console.log('  await sql\\\`SELECT count(*) FROM users\\\`');
  console.log('  .exit to quit');
  const r = repl.start({ prompt: 'db> ', useGlobal: true });
  r.context.sql = sql;
  r.on('exit', () => { sql.end().then(() => process.exit(0)); });
"
