import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin Turbopack workspace root to this package — avoids false detection
  // of stray lockfiles higher up the directory tree (e.g., in $HOME).
  // Note: root uses POSIX path with forward slashes to avoid Windows path
  // issues in Turbopack (Windows backslashes cause resolution failures).
  turbopack: {
    root: path.resolve(__dirname).replace(/\\/g, '/'),
  },
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
