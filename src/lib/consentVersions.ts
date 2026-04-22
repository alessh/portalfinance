/**
 * Consent version constants (placeholder for plan 01-03).
 *
 * Plan 01-03 replaces this with hashed values derived from the actual
 * Terms of Use + Privacy Policy markdown files at build time, so a new
 * version of the legal text automatically triggers re-consent.
 *
 * Phase 1 ships placeholder strings so signup can persist a non-null
 * `user_consents.consent_version`. Migrate carefully when plan 01-03
 * lands — the existing Phase 1 rows will keep their placeholder and
 * count as "stale consent" requiring a re-prompt at next login.
 */
export const CONSENT_VERSION_ACCOUNT_CREATION = 'v1-phase1-placeholder';
