import fs from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Drizzle client singleton. Uses the `postgres` driver per RESEARCH.md
 * (preferred over `pg` for Drizzle).
 *
 * Pool sizing per environment:
 * - production: 10 connections (Railway Postgres free tier permits ~20).
 * - all other envs: 1 connection (avoids exhausting local docker /
 *   testcontainers Postgres during integration runs).
 */
// Construct the postgres-js client eagerly (DrizzleAdapter requires a
// real Drizzle instance — a lazy Proxy fails its runtime type check),
// but use a safe placeholder URL when DATABASE_URL is missing. The
// placeholder never connects: it only satisfies the postgres-js
// constructor so build-time "collect page data" can run. Any actual
// query will fail at connect time when DATABASE_URL is unset.
const connection_string =
  process.env.DATABASE_URL ?? 'postgres://placeholder:placeholder@127.0.0.1:5432/placeholder';

// postgres-js ignores libpq-style sslrootcert in connection strings -- we
// must hand it the CA explicitly. The runner image bakes Amazon's RDS root
// bundle at /app/rds-ca-bundle.pem (Dockerfile). When it is present, enable
// full TLS verification; when absent (dev / build-time placeholder), let
// postgres-js infer SSL from the URL.
const ca_path = '/app/rds-ca-bundle.pem';
const ssl_opts = fs.existsSync(ca_path)
  ? { ca: fs.readFileSync(ca_path, 'utf8'), rejectUnauthorized: true as const }
  : undefined;

const pg_client = postgres(connection_string, {
  max: process.env.NODE_ENV === 'production' ? 10 : 1,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: ssl_opts,
});

export const db = drizzle(pg_client, { schema });
export type Db = typeof db;
