/**
 * Schema barrel — Drizzle Kit and the runtime client both import the full
 * schema graph from this file (`drizzle.config.ts → schema`,
 * `src/db/index.ts → drizzle(..., { schema })`).
 *
 * Add new tables by creating a new file under `src/db/schema/` and
 * appending its export here. Keep the order stable — Drizzle Kit's
 * generated migrations follow declaration order for forward compatibility.
 */
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
