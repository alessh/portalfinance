/**
 * Unit test for GET /api/health -- D-24.
 *
 * Plan 01.1-01. Direct-import handler (no HTTP server) following the
 * pattern from tests/integration/webhooks/ses-bounce.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns { status: "ok" } with HTTP 200', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('does not import the DB module', async () => {
    // Import graph smoke test: if the route touched @/db the lazy
    // client would be constructed at module load. Verify by reading
    // the source file -- a runtime import assertion would require
    // spawning a subprocess, which is overkill for a single guard.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/app/api/health/route.ts', 'utf8');
    expect(src).not.toMatch(/from ['"]@\/db/);
  });
});
