/**
 * Schema barrel — Drizzle Kit and the runtime client both import the full
 * schema graph from this file (`drizzle.config.ts → schema`,
 * `src/db/index.ts → drizzle(..., { schema })`).
 *
 * Add new tables by creating a new file under `src/db/schema/` and
 * appending its export here. Keep the order stable — Drizzle Kit's
 * generated migrations follow declaration order for forward compatibility.
 *
 * _shared.ts is exported first so Drizzle Kit discovers pgEnum declarations
 * before the table files that reference them.
 */
export * from './_shared';
export * from './users';
export * from './sessions';
export * from './authAdapter';
export * from './consents';
export * from './auditLog';
export * from './adminAccessLog';
export * from './webhookEvents';
export * from './subscriptions';
export * from './dsrRequests';
export * from './authRateLimits';
export * from './accountLocks';
export * from './passwordResetTokens';
export * from './sesSuppressions';
// Phase 2 schemas — declaration order matters for Drizzle Kit migration generation.
// pluggyItems depends on users; accounts depends on users + pluggyItems;
// transactions depends on users + accounts (and has a lazy self-FK).
export * from './pluggyItems';
export * from './accounts';
export * from './transactions';
