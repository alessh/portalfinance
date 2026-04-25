/**
 * GET /api/health -- D-24 / OPS-01 ALB + ECS health probe.
 *
 * Plan 01.1-01 -- closes Phase 1 deferred item "production start command".
 *
 * Target group health check (interval 30 s, healthy 2, unhealthy 3) AND
 * ECS container health check both hit this route. Must NOT touch the DB:
 *   1. Phase 1 lazy Drizzle client (src/db/index.ts) would panic if the
 *      entrypoint shim hadn't composed DATABASE_URL yet.
 *   2. Probe latency must stay well under the 5 s Copilot timeout.
 * This endpoint intentionally returns static JSON -- no imports from `@/db`.
 */
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET(): Promise<Response> {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
