'use client';
/**
 * TurnstileSlot — Cloudflare Turnstile widget wrapper (UI-SPEC § 2.3).
 *
 * Reads ONLY the public site key (`NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY`).
 * The server-only secret counterpart lives in `src/lib/turnstile.ts`
 * and is never imported into client code.
 *
 * Rendered conditionally by `LoginForm` from the 3rd attempt onward.
 */
import { Turnstile } from '@marsidev/react-turnstile';

export interface TurnstileSlotProps {
  onSuccess: (token: string) => void;
}

export function TurnstileSlot({ onSuccess }: TurnstileSlotProps) {
  const site_key = process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY;
  if (!site_key) {
    // In dev/test the site key may be absent — rendering nothing keeps
    // the form usable without a Cloudflare account. The server-side
    // verifyTurnstile() falls open in NODE_ENV=test/development for the
    // same reason.
    return null;
  }
  return (
    <div className="motion-safe:transition-all duration-300 my-3">
      <Turnstile
        siteKey={site_key}
        onSuccess={onSuccess}
        options={{ size: 'flexible', appearance: 'always' }}
      />
    </div>
  );
}
