import path from 'node:path';
import type { NextConfig } from 'next';

// Pin Next/Turbopack workspace root to this package — avoids false detection
// of stray lockfiles higher up the directory tree (e.g., `C:/Users/<user>/package-lock.json`).
// POSIX-style path with forward slashes for Turbopack on Windows.
const project_root = path.resolve(__dirname).replace(/\\/g, '/');

const nextConfig: NextConfig = {
  turbopack: {
    root: project_root,
  },
  // Mirror the same pin for the standalone tracing step, so `output: 'standalone'`
  // does not walk up and treat the parent directory as the workspace root.
  outputFileTracingRoot: project_root,
  // Next.js 16 promoted typedRoutes out of experimental.
  typedRoutes: true,
  // D-10 (Plan 01.1) -- standalone output powers `node .next/standalone/server.js`
  // as the production CMD in Dockerfile runner stage; local `pnpm start:web` matches.
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  // Phase 2: expose PLUGGY_ENV to client bundle so PluggyConnectWidget
  // can set includeSandbox correctly (D-39, UI-SPEC § 3.3).
  // Ops: set NEXT_PUBLIC_PLUGGY_ENV=sandbox in staging; =production in prod.
  env: {
    NEXT_PUBLIC_PLUGGY_ENV: process.env.NEXT_PUBLIC_PLUGGY_ENV ?? '',
  },
};

export default nextConfig;
