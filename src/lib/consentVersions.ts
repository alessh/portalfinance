/**
 * Consent version constants derived from the actual legal document hashes.
 *
 * Plan 01-03 replaces the Phase 1 placeholder with a real SHA-256-based
 * version string computed from the ToS + Privacy Policy markdown files at
 * module load time.
 *
 * **Why file read at load time?**
 * Phase 1 keeps this simple — we read the markdown at module init and
 * compute a 12-char hex prefix. Phase 6 can move to a build-time constant
 * baked into a generated .ts file by a build script, avoiding the fs read
 * in production bundles.
 *
 * **Version format:** `v1.0.0+terms.<12hex>+privacy.<12hex>`
 * This gives us:
 *   - Semantic version for the document set
 *   - Detects when either document changes (separate hashes)
 *   - Fits in a single VARCHAR column (≈ 60 chars)
 *
 * **Stale-consent detection (Phase 6):**
 * On login, compare `user_consents.consent_version` against
 * `versions.ACCOUNT_CREATION`. If different, re-prompt the user before
 * they access the dashboard.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function short_sha(file_path: string): string {
  try {
    const content = readFileSync(resolve(process.cwd(), file_path), 'utf8');
    return createHash('sha256').update(content).digest('hex').slice(0, 12);
  } catch {
    // In environments where the docs/ folder is not available (e.g., some CI
    // build steps), fall back to a deterministic placeholder so the module
    // does not throw at import time. Callers should not ship the fallback
    // value to production — Phase 6 gate enforces the real hash.
    return 'fallback000000';
  }
}

const terms_hash = short_sha('docs/legal/terms-v1.md');
const privacy_hash = short_sha('docs/legal/privacy-v1.md');

export const versions = {
  ACCOUNT_CREATION: `v1.0.0+terms.${terms_hash}+privacy.${privacy_hash}`,
} as const;

export type ConsentVersionKey = keyof typeof versions;
