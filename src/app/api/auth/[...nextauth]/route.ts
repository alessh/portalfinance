/**
 * Auth.js v5 catch-all route — exposes the credentials provider
 * endpoints (`/api/auth/callback/credentials`, `/api/auth/signin`,
 * `/api/auth/signout`, `/api/auth/session`, `/api/auth/csrf`).
 *
 * MUST run on the Node runtime — Auth.js + Drizzle + argon2 cannot
 * execute in the edge runtime (Pitfall 6).
 */
export const runtime = 'nodejs';

import { handlers } from '@/auth';

export const { GET, POST } = handlers;
