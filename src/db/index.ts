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
const connection_string = process.env.DATABASE_URL;
if (!connection_string) {
  throw new Error('DATABASE_URL is required');
}

const pg_client = postgres(connection_string, {
  max: process.env.NODE_ENV === 'production' ? 10 : 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(pg_client, { schema });
export type Db = typeof db;
