/**
 * Cloudflare Turnstile server-side verification (D-07).
 *
 * RESEARCH.md § Plan slice 01-02 item 7. Called from the login handler
 * after the rate-limit counter says "Turnstile required" (>= 2 prior
 * failures in the trailing 15-minute window). The server NEVER trusts
 * the client's failure count — it uses its own counter as the source
 * of truth (T-TURNSTILE-BYPASS).
 *
 * `TURNSTILE_SECRET_KEY` is server-only. Only `NEXT_PUBLIC_CF_TURNSTILE_
 * SITE_KEY` is exposed to the browser bundle (T-TURNSTILE-SECRET-LEAK).
 */
import { env } from '@/lib/env';

const VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  token: string | null | undefined,
  ip?: string | null,
): Promise<boolean> {
  if (!token) return false;
  if (!env.TURNSTILE_SECRET_KEY) {
    // Fail-closed in production; no-op in tests / dev where Turnstile
    // is not configured. The login route gates on env presence first.
    return env.NODE_ENV === 'test' || env.NODE_ENV === 'development';
  }

  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}
