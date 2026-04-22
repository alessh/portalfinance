/**
 * argon2id wrappers for password hashing + verification.
 *
 * Parameters per OWASP Password Storage Cheat Sheet (2025):
 *   - timeCost   = 3
 *   - memoryCost = 65536 (64 MiB)
 *   - parallelism = 1
 *
 * RESEARCH.md § Plan slice 01-02 item 3 / AUTH-06.
 *
 * `verifyPassword` accepts `null | undefined` and runs a dummy verify
 * against a fixed argon2id hash so the response timing is not a side-
 * channel for "user exists vs does not exist" — it is the const-time
 * equalisation pair for `Auth.js` Credentials `authorize` (RESEARCH.md
 * § Threat Register T-AUTH-ENUMERATION).
 *
 * If the `argon2` native prebuild ever fails on the Railway container
 * (Pitfall 3), swap to `@node-rs/argon2` — the API surface is the same.
 */
import argon2 from 'argon2';

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 1,
} as const;

/**
 * A precomputed argon2id hash of a random throwaway password. Used by
 * `verifyPassword` when no real hash is provided so the function still
 * spends a similar amount of CPU as a real verify call. Generated once
 * at module load — the input plaintext is not retained.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!hash) {
    // Const-time equalisation: spend roughly the same CPU as a real verify
    // so an attacker cannot enumerate accounts via response-time analysis.
    try {
      await argon2.verify(DUMMY_HASH, plain);
    } catch {
      // Dummy hash may not be a valid encoding on every argon2 release —
      // swallow the error since the only goal here is to spend CPU time.
    }
    return false;
  }
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash should not crash the auth flow — treat as "no match".
    return false;
  }
}
