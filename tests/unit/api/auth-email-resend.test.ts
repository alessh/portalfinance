/**
 * Regression test for POST /api/auth/email/resend (D-02 stub).
 *
 * Before this stub existed, requests fell through to the [...nextauth]
 * catch-all and Auth.js v5 returned 400 for the unknown `email/resend`
 * action -- producing noise in Sentry on every banner click. The stub
 * must return 501 Not Implemented until Phase 2 wires the real flow.
 *
 * Debug session: .planning/debug/email-resend-400.md
 */
import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/auth/email/resend/route';

describe('POST /api/auth/email/resend', () => {
  it('returns 501 Not Implemented (Phase 1 stub)', async () => {
    const res = await POST();
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'not_implemented' });
  });
});
